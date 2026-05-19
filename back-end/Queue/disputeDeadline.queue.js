/**
 * Dispute-deadline queue.
 *
 * Job payload: { disputeId, expectedStatus }
 *   - disputeId — which dispute to act on
 *   - expectedStatus — only act if the dispute is STILL in this status when
 *     the deadline fires. If it has moved on (seller responded early, buyer
 *     accepted, admin escalated), the deadline is moot and we skip.
 *
 * Two scenarios this drives:
 *   1. Status = `awaiting_seller`, deadline fires → seller never responded
 *      → automatic FULL refund to buyer (the buyer-protection guarantee).
 *   2. Status = `awaiting_buyer`, deadline fires → buyer never accepted the
 *      seller's offer → escalate to admin.
 *
 * Both transitions live in dispute.service.handleDeadlineExpired() so the
 * worker stays a thin shell.
 */

import { register, enqueue, cancelJob } from "../Service/jobQueue.service.js";
import chalk from "chalk";

export const DISPUTE_DEADLINE_QUEUE = "dispute-deadline";

// Default windows. Configurable via env so we can tighten/loosen without
// a code deploy.
export const SELLER_RESPONSE_WINDOW_MS =
  Number(process.env.DISPUTE_SELLER_WINDOW_MS) || 48 * 60 * 60 * 1000;
export const BUYER_RESPONSE_WINDOW_MS =
  Number(process.env.DISPUTE_BUYER_WINDOW_MS) || 48 * 60 * 60 * 1000;

register(DISPUTE_DEADLINE_QUEUE, async (job) => {
  // Lazy import to dodge the circular dep with dispute.service (which
  // imports this file to enqueue deadlines).
  const { handleDeadlineExpired } = await import("../Service/dispute.service.js");
  const { disputeId, expectedStatus } = job.data;
  const result = await handleDeadlineExpired(disputeId, expectedStatus);
  if (result?.transitioned) {
    console.log(chalk.cyan(`[dispute-deadline] dispute=${disputeId} ${expectedStatus} → ${result.newStatus}`));
  }
  return result;
}, { concurrency: 4 });

export const scheduleDeadline = async (dispute, windowMs) => {
  // Cancel an existing one for this dispute first — we only ever want a
  // single live deadline job per dispute.
  if (dispute.deadlineJobId) {
    await cancelJob(DISPUTE_DEADLINE_QUEUE, dispute.deadlineJobId).catch(() => {});
  }
  const job = await enqueue(DISPUTE_DEADLINE_QUEUE,
    { disputeId: String(dispute._id), expectedStatus: dispute.status },
    { delay: windowMs, attempts: 3, backoff: { type: "exponential", delay: 30_000 } },
  );
  return { jobId: job.id, deadlineAt: new Date(Date.now() + windowMs) };
};

export const cancelDeadline = async (dispute) => {
  if (!dispute?.deadlineJobId) return false;
  return cancelJob(DISPUTE_DEADLINE_QUEUE, dispute.deadlineJobId);
};
