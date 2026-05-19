/**
 * Escrow-release queue.
 *
 * Job payload: { orderId }
 * Scheduled with a `delay` matching the order's compute-hold-window. When
 * the delay fires, the worker calls escrowRelease.releaseEscrow which is
 * idempotent and safety-checked (won't fire if a dispute is open).
 *
 * The job ID is stored on the order (`escrowReleaseJobId`) so the dispute
 * flow can cancel a pending release the moment a buyer files a complaint.
 */

import { register, enqueue, cancelJob } from "../Service/jobQueue.service.js";
import { releaseEscrow, computeHoldForOrder } from "../Service/escrowRelease.service.js";
import Order from "../Model/order.model.js";
import chalk from "chalk";

export const ESCROW_RELEASE_QUEUE = "escrow-release";

register(ESCROW_RELEASE_QUEUE, async (job) => {
  const { orderId } = job.data;
  const result = await releaseEscrow(orderId);
  if (!result.released) {
    // Not an error — common case is "dispute opened in the meantime".
    console.log(chalk.gray(`[escrow-release] order=${orderId} skipped: ${result.reason}`));
  } else {
    console.log(chalk.green(
      `[escrow-release] order=${orderId} released ₮${result.amount} to ${result.sellers.length} seller(s)`));
  }
  return result;
}, { concurrency: 4 });

/**
 * Schedule a delayed release for a freshly-delivered order.
 *
 * Stores the job id back on the order so we can cancel it later if a
 * dispute opens. Re-schedules if there's already a pending one — that
 * happens when an admin manually re-marks an order delivered.
 */
export const scheduleRelease = async (order) => {
  const { releaseAt } = await computeHoldForOrder(order);
  const delay = Math.max(0, releaseAt.getTime() - Date.now());

  // Cancel any existing scheduled release before booking a new one.
  if (order.escrowReleaseJobId) {
    await cancelJob(ESCROW_RELEASE_QUEUE, order.escrowReleaseJobId).catch(() => {});
  }

  const job = await enqueue(ESCROW_RELEASE_QUEUE, { orderId: String(order._id) }, {
    delay,
    attempts: 5,
    backoff: { type: "exponential", delay: 60_000 },
  });

  await Order.updateOne(
    { _id: order._id },
    {
      $set: {
        escrowReleaseScheduledAt: releaseAt,
        escrowReleaseJobId: job.id,
      },
    },
  );
  return { jobId: job.id, releaseAt };
};

/**
 * Cancel a pending release (called from dispute.service when a dispute is
 * filed). Safe to call when none is scheduled.
 */
export const cancelScheduledRelease = async (order) => {
  if (!order.escrowReleaseJobId) return false;
  const removed = await cancelJob(ESCROW_RELEASE_QUEUE, order.escrowReleaseJobId);
  await Order.updateOne(
    { _id: order._id },
    { $unset: { escrowReleaseJobId: "" }, $set: { escrowReleaseScheduledAt: null } },
  );
  return removed;
};
