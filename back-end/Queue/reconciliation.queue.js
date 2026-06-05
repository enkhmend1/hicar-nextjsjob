/**
 * Reconciliation queue — periodic self-healing for stuck disputes / escrow.
 *
 * Architecture choice: we use a setInterval-driven SCHEDULER that enqueues
 * one-shot jobs onto BullMQ. Not BullMQ's built-in repeat-cron, because:
 *
 *   • setInterval in dev (no Redis) → still ticks; reconciliation runs
 *     inline via the jobQueue sync fallback.
 *   • One-shot BullMQ jobs get retries + dead-letter handling for free.
 *   • In a multi-replica deployment, the scheduler ticks on every replica
 *     but the JOB itself is queued — BullMQ serializes execution, and
 *     reconcileAll is idempotent so duplicate ticks are harmless.
 *
 * Knobs:
 *   RECON_INTERVAL_MS  — how often to run (default 5 min).
 *   RECON_BOOT_DELAY_MS — wait this long after boot before the first tick
 *                          (default 30s — gives connections time to settle).
 */

import { logger } from "../Config/logger.js";

import { register, enqueue } from "../Service/jobQueue.service.js";
import { reconcileAll } from "../Service/disputeReconciliation.service.js";

export const RECONCILIATION_QUEUE = "dispute-reconciliation";

const DEFAULT_INTERVAL_MS = Number(process.env.RECON_INTERVAL_MS) || 5 * 60 * 1000;
const BOOT_DELAY_MS       = Number(process.env.RECON_BOOT_DELAY_MS) || 30 * 1000;

register(RECONCILIATION_QUEUE, async (job) => {
  const summary = await reconcileAll();
  if (summary.total > 0) {
    logger.info("reconcile run", {
      reason: job.data?.reason || "tick",
      healed: summary.total,
      orphanLocks: summary.orphanLocks.length,
      missedDeadlines: summary.missedDeadlines.length,
      lostSchedules: summary.lostSchedules.length,
    });
  }
  return summary;
}, { concurrency: 1 });

let intervalHandle = null;
let bootHandle = null;

/**
 * Start the periodic scheduler.
 *
 * Fires:
 *   • once at boot+30s (catch anything that broke while the process was down)
 *   • then every RECON_INTERVAL_MS
 *
 * Safe to call multiple times — second call is a no-op.
 */
export const startReconciliationScheduler = ({
  intervalMs = DEFAULT_INTERVAL_MS,
  bootDelayMs = BOOT_DELAY_MS,
} = {}) => {
  if (intervalHandle) return false;

  // Fire-and-forget boot run.
  bootHandle = setTimeout(() => {
    enqueue(RECONCILIATION_QUEUE, { reason: "boot" }).catch((e) =>
      logger.warn("reconcile boot enqueue failed", { err: e }));
  }, bootDelayMs);
  if (bootHandle.unref) bootHandle.unref();

  // Recurring tick.
  intervalHandle = setInterval(() => {
    enqueue(RECONCILIATION_QUEUE, { reason: "tick" }).catch((e) =>
      logger.warn("reconcile tick enqueue failed", { err: e }));
  }, intervalMs);
  // Don't block process exit on this timer.
  if (intervalHandle.unref) intervalHandle.unref();

  logger.info("Reconciliation scheduler started", { bootDelayMs, intervalMs });
  return true;
};

/** Stop the scheduler. Useful for clean shutdown / tests. */
export const stopReconciliationScheduler = () => {
  if (bootHandle)     { clearTimeout(bootHandle);  bootHandle = null; }
  if (intervalHandle) { clearInterval(intervalHandle); intervalHandle = null; }
};
