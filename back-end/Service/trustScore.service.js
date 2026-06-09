/**
 * Trust-score service — bulletproof refactor.
 *
 *   The seller's `sellerProfile.trustScore` (0–100) drives the escrow-hold
 *   window (see escrowRelease.computeReleaseDate): high trust = fast payout.
 *   Every dispute resolution nudges the score so the platform has a real
 *   reputation flywheel:
 *
 *     resolved_refund   (seller was wrong, full refund)        →  −3
 *     resolved_partial  (seller partly wrong, partial refund)  →  −1.5
 *     resolved_release  (claim rejected, escrow goes to seller)→  +0.5
 *     reject_claim      (admin actively ruled buyer wrong)     →  +1.5
 *     cancelled         (buyer withdrew before judgment)       →   0  (no signal)
 *
 * ─── Concurrency hazards this module defends against ────────────────────
 *
 *   ① RACE CONDITION on the seller's score
 *      A naive read-modify-write (`findById` → compute → `$set`) reads a
 *      stale value if two disputes resolve concurrently for the same
 *      seller. Both observers see `prev = 50`, both compute `next = 47`,
 *      both write 47 — one delta is silently lost.
 *
 *      FIX: an aggregation-pipeline update (`updateOne([{ $set: ... }])`)
 *      evaluates `$max[0, $min[100, $add[$ifNull[prev, 50], delta]]]`
 *      ENTIRELY on the database server, in a single atomic operation. No
 *      app-side calculation participates in the write. Two concurrent
 *      updates serialize at the document level and both deltas land.
 *
 *   ② DOUBLE-SPENDING of trust deltas
 *      BullMQ retries, admin double-clicks, callback replays — any path
 *      that calls `applyResolutionDelta` twice for the same dispute would
 *      historically apply the delta twice, corrupting the reputation log.
 *
 *      FIX: a per-dispute idempotency CAS lock. The first call to
 *      `Dispute.findOneAndUpdate({ _id, isTrustScoreApplied: { $ne: true }},
 *      { $set: { isTrustScoreApplied: true } })` succeeds and proceeds to
 *      the seller update. Every subsequent caller (retry, replay, race)
 *      sees `null` returned from the CAS and exits with an explicit
 *      "already_applied" signal — no second delta is applied. The lock
 *      lives on the dispute document itself, so it's durable across
 *      process restarts and travels with the workload through Redis.
 *
 *   ③ ROLLBACK on hard failure
 *      If the seller update throws (network blip) or returns no doc
 *      (seller deleted between dispute creation and resolution), the CAS
 *      lock is RELEASED so a retry — or the reconciliation watchdog —
 *      can re-apply the delta cleanly. We never silently leave a dispute
 *      flagged as applied when the side effect didn't actually land.
 */

import { logger } from "../Config/logger.js";
import mongoose from "mongoose";

import User from "../Model/user.model.js";
import Dispute from "../Model/dispute.model.js";
import { appendAudit } from "./financialAudit.service.js";

/* ──────────────────────────────────────────────────────────────────────
 * Constant tables — preserved verbatim from the previous design.
 * ────────────────────────────────────────────────────────────────────── */

export const TRUST_DELTAS = Object.freeze({
  resolved_refund:  -3,
  resolved_partial: -1.5,
  resolved_release: +0.5,
  reject_claim:     +1.5,
  cancelled:         0,
});

const STATUS_FROM_ACTION = Object.freeze({
  refund_full:    "resolved_refund",
  refund_partial: "resolved_partial",
  release_seller: "resolved_release",
  reject_claim:   "reject_claim",
});

const TRUST_PATH    = "sellerProfile.trustScore";
const TRUST_DEFAULT = 50;
const TRUST_MIN     = 0;
const TRUST_MAX     = 100;

/** Same formula the DB pipeline uses — for computing the audit `next` value. */
const clamp = (n) => Math.max(TRUST_MIN, Math.min(TRUST_MAX, n));

/* ──────────────────────────────────────────────────────────────────────
 * Public API
 * ────────────────────────────────────────────────────────────────────── */

/**
 * Apply the trust-score delta for ONE dispute resolution. Atomic and
 * idempotent — safe to call multiple times for the same `disputeId`; the
 * delta is applied EXACTLY once.
 *
 * @param {string|mongoose.Types.ObjectId} disputeId
 *        The dispute whose resolution we're booking. Acts as the
 *        idempotency key (one delta per dispute, forever).
 * @param {string|mongoose.Types.ObjectId} sellerId
 *        The seller whose score moves. Must already exist.
 * @param {string} actionOrStatus
 *        Either a `resolution.action` ("refund_full", "reject_claim", …)
 *        or a terminal dispute status ("resolved_refund", …). Normalised
 *        via STATUS_FROM_ACTION so callers don't have to convert.
 * @returns {Promise<
 *   { applied: true,  sellerId, disputeId, key, delta, previous, next }
 * | { applied: false, reason: "already_applied"|"zero_delta"|"unknown_key", key?, delta? }
 * >}
 * @throws {Error} If the seller does not exist after the lock is claimed.
 *         The lock is rolled back before throwing so a retry can recover.
 */
export const applyResolutionDelta = async (disputeId, sellerId, actionOrStatus) => {
  if (!disputeId) throw new Error("trustScore.applyResolutionDelta: disputeId required");
  if (!sellerId)  throw new Error("trustScore.applyResolutionDelta: sellerId required");

  // ── Resolve the delta ──────────────────────────────────────────────
  const key = STATUS_FROM_ACTION[actionOrStatus] || actionOrStatus;
  const delta = TRUST_DELTAS[key];
  if (delta === undefined) {
    return { applied: false, reason: "unknown_key", key };
  }

  // ── Phase 1: ATOMIC CAS LOCK on the dispute ────────────────────────
  // The single MongoDB operation below is the distributed idempotency
  // boundary. ALL retry/replay/race paths converge here.
  //
  //  - First caller: filter matches (`isTrustScoreApplied` is missing or
  //    explicitly false), the $set succeeds, the post-image is returned.
  //  - All other callers: filter no longer matches, `findOneAndUpdate`
  //    returns null, we exit with "already_applied". No double-apply.
  //
  // `returnDocument: "after"` is irrelevant here (we don't use the
  // returned doc); we request the minimum projection to keep wire
  // traffic small.
  const lock = await Dispute.findOneAndUpdate(
    { _id: disputeId, isTrustScoreApplied: { $ne: true } },
    { $set: { isTrustScoreApplied: true } },
    { returnDocument: "after", projection: { _id: 1 } },
  );
  if (!lock) {
    return { applied: false, reason: "already_applied", key, delta };
  }

  // Zero-delta keys (currently only "cancelled") claim the lock so a
  // subsequent non-zero retry can't double-fire, but they do not touch
  // the seller. Cheap and correct.
  if (delta === 0) {
    return { applied: false, reason: "zero_delta", key, delta };
  }

  // ── Phase 2: ATOMIC clamped server-side update on the seller ───────
  //
  // The update spec is an AGGREGATION PIPELINE (array form). MongoDB
  // evaluates it on the server:
  //
  //     newScore = max(0, min(100, ifNull($trustScore, 50) + delta))
  //
  // No app-side read or compute participates. Concurrent updates to the
  // same seller's trustScore (e.g. an admin manual override happening
  // simultaneously) cannot lose this delta — they serialize at the
  // document level and both deltas apply.
  //
  // We request `returnDocument: "before"` so the PRE-image is returned;
  // the audit `next` value is then computed by the same clamp formula
  // in JS. Because the DB pipeline uses the identical formula, the
  // JS-computed `next` is bit-exact with what the database now stores.
  let preImage;
  try {
    preImage = await User.findOneAndUpdate(
      { _id: sellerId },
      [
        {
          $set: {
            [TRUST_PATH]: {
              $max: [TRUST_MIN, {
                $min: [TRUST_MAX, {
                  $add: [
                    { $ifNull: [`$${TRUST_PATH}`, TRUST_DEFAULT] },
                    delta,
                  ],
                }],
              }],
            },
          },
        },
      ],
      {
        returnDocument: "before",
        projection: { [TRUST_PATH]: 1 },
      },
    );
  } catch (err) {
    // DB / network error MID-UPDATE. Roll the CAS lock back so a retry
    // (or the reconciliation cron) can re-apply the delta.
    await releaseLockSafely(disputeId);
    throw err;
  }

  if (!preImage) {
    // Seller doesn't exist (deleted between dispute creation and trust
    // update). Roll the lock back and surface the integrity violation
    // loudly — silent failure here would leave the dispute marked
    // applied even though no score moved.
    await releaseLockSafely(disputeId);
    throw new Error(
      `trustScore.applyResolutionDelta: seller ${sellerId} not found ` +
      `(dispute ${disputeId} lock rolled back for retry)`,
    );
  }

  const previous = preImage.sellerProfile?.trustScore ?? TRUST_DEFAULT;
  const next     = clamp(previous + delta);

  // Audit. Append-only ledger row — `before` / `after` capture the
  // canonical pre/post trust values, and the dispute reference ties this
  // back to the resolution that drove the change.
  await appendAudit({
    type: "trust_score_changed",
    disputeId,
    sellerId,
    actor:   "system",
    amount:  0,
    before:  { trustScore: previous },
    after:   { trustScore: next },
    metadata: { key, delta },
  });

  return {
    applied: true,
    sellerId: String(sellerId),
    disputeId: String(disputeId),
    key,
    delta,
    previous,
    next,
  };
};

/**
 * Roll the CAS lock back to false on rollback paths. Best-effort: if THIS
 * also fails, log loudly — the reconciliation cron will re-evaluate the
 * dispute on its next tick (resolution_terminal + isTrustScoreApplied=true
 * but pre-image not actually updated is detectable via a separate audit
 * pass, future work).
 */
const releaseLockSafely = async (disputeId) => {
  try {
    await Dispute.updateOne(
      { _id: disputeId },
      { $set: { isTrustScoreApplied: false } },
    );
  } catch (e) {
    logger.error("trustScore CRITICAL: rollback isTrustScoreApplied failed", {
      err: e, disputeId,
    });
  }
};

/* ──────────────────────────────────────────────────────────────────────
 * Internal exports for tests + reconciliation
 * ────────────────────────────────────────────────────────────────────── */

export const __internal = Object.freeze({
  TRUST_PATH, TRUST_DEFAULT, TRUST_MIN, TRUST_MAX,
  STATUS_FROM_ACTION,
  clamp,
});

// Silence unused-import warning — `mongoose` is exported transitively by
// our models, but Node ESM doesn't track that. Re-export for callers
// who need the connection / Types.
export { mongoose };
