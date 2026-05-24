import mongoose from "mongoose";

/**
 * Background-agent fire log — Phase L.
 *
 * Each row: "We ran check X for recipient Y at time T". The
 * background-agent scheduler reads this BEFORE firing a notification
 * to enforce the check's cooldown ("don't spam the seller with a
 * deadstock alert more than once per week").
 *
 * Why a dedicated collection:
 *   • Lets us bump a check's cooldown / change semantics without
 *     touching User or Notification documents.
 *   • TTL index drops stale rows automatically — after 60 days, we
 *     assume the cooldown is irrelevant and the row can roll off.
 *   • Compound index on (checkName, recipient) gives O(log n) lookup
 *     per (check, recipient) pair, regardless of total row count.
 *
 * Compound uniqueness: there is ONE row per (checkName, recipient).
 * Re-firing the same check upserts `lastRunAt` rather than appending.
 * Audit history of EVERY fire would explode in size — we keep just
 * the latest timestamp here; full fire history lives in the
 * Notification collection (one notification per fire).
 */

const backgroundAgentLogSchema = new mongoose.Schema(
  {
    /** Stable identifier from backgroundAgent.service CHECKS registry. */
    checkName: { type: String, required: true, trim: true, maxlength: 60, index: true },

    /**
     * Who the notification was sent to. For per-seller / per-admin
     * checks, this is the recipient's User._id. For platform-wide
     * checks that go to ALL admins (e.g. weekly digest), we still
     * write one row per admin so the cooldown stays per-person.
     */
    recipient: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

    /** Wall-clock time the notification was created. Used as the
        cooldown anchor (lastRunAt + cooldownMs > now → skip). */
    lastRunAt: { type: Date, required: true, default: Date.now },

    /**
     * Tiny payload describing what we sent — for ops dashboards
     * ("how many alerts went out yesterday, with what severity").
     * Free-form Mixed so checks can stash whatever they want without
     * a schema migration. Keep small.
     */
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

// One row per (check, recipient).
backgroundAgentLogSchema.index({ checkName: 1, recipient: 1 }, { unique: true });

// TTL — drop rows after 60 days; cooldowns longer than that don't make
// product sense.
backgroundAgentLogSchema.index({ lastRunAt: 1 }, { expireAfterSeconds: 60 * 24 * 60 * 60 });

export default mongoose.model("BackgroundAgentLog", backgroundAgentLogSchema);
