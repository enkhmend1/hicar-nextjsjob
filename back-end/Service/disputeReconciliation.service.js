/**
 * Dispute / escrow reconciliation service.
 *
 * The dispute + escrow flows are designed to be self-healing through atomic
 * transitions and rollbacks. But software runs on hardware that occasionally
 * crashes mid-write, on Redis instances that get restarted, and against
 * upstream APIs that take 30 seconds to time out. Reconciliation is the
 * safety net: it scans for the THREE shapes of inconsistency we know can
 * arise, and heals each idempotently.
 *
 *   ① ORPHANED LOCK
 *     Order is in paymentStatus = "DISPUTED" but there is no live dispute.
 *     Most often caused by createDispute crashing AFTER locking the order
 *     but BEFORE the rollback finished. Heal: restore paymentStatus from
 *     refundedAmount, clear hasOpenDispute.
 *
 *   ② MISSED DEADLINE
 *     Dispute is in awaiting_seller or awaiting_buyer past
 *     responseDeadline + grace. The BullMQ deadline job should have fired
 *     — but if Redis was down or the worker crashed, the dispute is stuck.
 *     Heal: call handleDeadlineExpired() programmatically.
 *
 *   ③ LOST RELEASE SCHEDULE
 *     Order is PAID + delivered + no open dispute + no
 *     escrowReleaseScheduledAt. The release-on-delivery hook didn't fire
 *     (or BullMQ lost the job). Heal: re-call scheduleRelease().
 *
 * All three checks are safe to run repeatedly — idempotent at the data layer.
 * Running this every 5 minutes adds ~3-4 indexed queries to the DB; cheap.
 *
 * Returns a summary object so the cron can log structured findings rather
 * than scrolling through individual heal log lines.
 */

import { logger } from "../Config/logger.js";

import Order from "../Model/order.model.js";
import Dispute from "../Model/dispute.model.js";
import { handleDeadlineExpired } from "./dispute.service.js";
import { scheduleRelease } from "../Queue/escrowRelease.queue.js";

/** Grace period before we treat an inconsistency as "stuck". */
const ORPHAN_LOCK_GRACE_MS  = Number(process.env.RECON_ORPHAN_GRACE_MS)  || 5  * 60 * 1000;  // 5 min
const DEADLINE_OVERDUE_MS   = Number(process.env.RECON_DEADLINE_GRACE_MS) || 60 * 60 * 1000; // 1 hour
const DELIVERED_NO_SCHEDULE_GRACE_MS = Number(process.env.RECON_DELIVERED_GRACE_MS) || 30 * 60 * 1000; // 30 min

/** Bound how many findings we process per tick — prevents a runaway cron. */
const MAX_PER_RUN = 100;

/**
 * Find + heal orphaned DISPUTED locks. An order is "orphaned" when
 * paymentStatus is DISPUTED but no non-terminal dispute references it.
 * Usually a crash between Order.findOneAndUpdate (lock) and Dispute.create.
 */
export const reconcileOrphanLocks = async () => {
  const cutoff = new Date(Date.now() - ORPHAN_LOCK_GRACE_MS);
  const candidates = await Order
    .find({ paymentStatus: "DISPUTED", updatedAt: { $lt: cutoff } })
    .limit(MAX_PER_RUN);

  const healed = [];
  for (const order of candidates) {
    const openCount = await Dispute.countDocuments({
      order: order._id,
      status: { $nin: ["resolved_refund", "resolved_release", "resolved_partial", "cancelled"] },
    });
    if (openCount > 0) continue; // There IS a live dispute — not orphaned.

    const refunded = order.refundedAmount || 0;
    const escrow   = order.escrowAmount   || 0;
    const nextStatus =
        refunded <= 0      ? "PAID"
      : refunded >= escrow ? "REFUNDED"
      :                       "PARTIAL_REFUND";

    // Conditional write — only heal if the order is still in DISPUTED.
    // (Another flow might've already fixed it between our read and write.)
    const result = await Order.updateOne(
      { _id: order._id, paymentStatus: "DISPUTED" },
      { $set: { paymentStatus: nextStatus, hasOpenDispute: false } },
    );
    if (result.modifiedCount === 1) {
      healed.push({ orderId: String(order._id), from: "DISPUTED", to: nextStatus });
    }
  }
  return healed;
};

/**
 * Find disputes whose response deadline is past + grace and force the
 * deadline transition. The dispute service's deadline worker should have
 * done this, but if Redis was unavailable when the timeout fired, the
 * dispute sits stuck.
 *
 * handleDeadlineExpired itself is idempotent (it checks `expectedStatus`),
 * so calling it on a dispute that has since moved on is a no-op.
 */
export const reconcileMissedDeadlines = async () => {
  const cutoff = new Date(Date.now() - DEADLINE_OVERDUE_MS);
  const stuck = await Dispute
    .find({
      status: { $in: ["awaiting_seller", "awaiting_buyer"] },
      responseDeadline: { $lt: cutoff },
    })
    .limit(MAX_PER_RUN);

  const healed = [];
  for (const d of stuck) {
    const result = await handleDeadlineExpired(String(d._id), d.status);
    if (result?.transitioned) {
      healed.push({
        disputeId: String(d._id),
        from: d.status,
        to: result.newStatus,
      });
    }
  }
  return healed;
};

/**
 * Find delivered orders that should have a scheduled escrow release but
 * don't. Causes: BullMQ lost the job (replica reset, queue purged), the
 * delivery transition was made via direct DB write that skipped the
 * controller hook, or scheduleRelease threw at the moment of delivery.
 *
 * Re-scheduling is cheap and idempotent — scheduleRelease cancels any
 * existing job before booking a new one.
 */
export const reconcileLostSchedules = async () => {
  const cutoff = new Date(Date.now() - DELIVERED_NO_SCHEDULE_GRACE_MS);
  const candidates = await Order
    .find({
      paymentStatus: { $in: ["PAID", "PARTIAL_REFUND"] },
      status: "delivered",
      hasOpenDispute: false,
      escrowReleaseScheduledAt: null,
      escrowReleasedAt: null,
      deliveredAt: { $lt: cutoff },
    })
    .limit(MAX_PER_RUN);

  const healed = [];
  for (const order of candidates) {
    try {
      const { jobId, releaseAt } = await scheduleRelease(order);
      healed.push({ orderId: String(order._id), jobId, releaseAt });
    } catch (e) {
      logger.warn("reconcile schedule failed", { err: e, orderId: order._id });
    }
  }
  return healed;
};

/**
 * Run all three checks. Returns a structured summary suitable for logging.
 *
 * Order matters: orphan-locks first (frees stuck money), then deadlines
 * (drives stuck disputes to resolution which may rewrite paymentStatus),
 * then lost schedules (cleans up any now-eligible orders).
 */
export const reconcileAll = async () => {
  const ranAt = new Date();
  const orphanLocks    = await reconcileOrphanLocks();
  const missedDeadlines = await reconcileMissedDeadlines();
  const lostSchedules  = await reconcileLostSchedules();

  const total = orphanLocks.length + missedDeadlines.length + lostSchedules.length;
  return {
    ranAt,
    total,
    orphanLocks,
    missedDeadlines,
    lostSchedules,
  };
};
