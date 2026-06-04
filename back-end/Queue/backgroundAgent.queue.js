/**
 * Background Agent scheduler — Phase L.
 *
 * Pattern intentionally mirrors Queue/reconciliation.queue.js:
 *
 *   setInterval ticks every AI_BG_AGENT_INTERVAL_MS (default 24h) →
 *   enqueues one BullMQ job that calls runAllBackgroundChecks().
 *
 *   • setInterval in dev (no Redis) → still ticks; job runs inline
 *     via the jobQueue sync fallback.
 *   • One-shot BullMQ jobs get retries + dead-letter handling for free.
 *   • In a multi-replica deployment, scheduler ticks on EVERY replica,
 *     but the job itself is queued — BullMQ serialises execution, and
 *     per-(check, recipient) cooldown enforced in the service makes
 *     duplicate ticks harmless.
 *
 * Knobs:
 *   AI_BG_AGENT_INTERVAL_MS    default 86,400,000 (24h)
 *   AI_BG_AGENT_BOOT_DELAY_MS  default 60,000 (1 min — give DB time)
 *   AI_BG_AGENT_DISABLED       "true" to opt out entirely (e.g. test env)
 */

import chalk from "chalk";
import { register, enqueue } from "../Service/jobQueue.service.js";
import { runAllBackgroundChecks } from "../Service/backgroundAgent.service.js";

export const BACKGROUND_AGENT_QUEUE = "background-agent";

const DEFAULT_INTERVAL_MS = Number(process.env.AI_BG_AGENT_INTERVAL_MS)   || 24 * 60 * 60 * 1000;
const BOOT_DELAY_MS       = Number(process.env.AI_BG_AGENT_BOOT_DELAY_MS) || 60 * 1000;
const SCHEDULER_DISABLED  = String(process.env.AI_BG_AGENT_DISABLED || "").toLowerCase() === "true";

// ── BullMQ job handler ─────────────────────────────────────────────


register(BACKGROUND_AGENT_QUEUE, async (job) => {
  const summary = await runAllBackgroundChecks();
  if (summary.totalSent > 0 || summary.errored.length > 0) {
    console.log(chalk.magenta(
      `[bg-agent] reason=${job.data?.reason || "tick"} sent=${summary.totalSent} ` +
      `errors=${summary.errored.length} ` +
      `breakdown=${JSON.stringify(summary.perCheck)}`,
    ));
  }
  return summary;
});

// ── Scheduler handles (so tests can stop ticks) ───────────────────
let intervalHandle = null;
let bootHandle = null;

/**
 * Start the daily scheduler. Idempotent — calling twice is a no-op.
 *
 * Returns:
 *   true   on success
 *   false  if already running OR opt-out env set
 */
export const startBackgroundAgentScheduler = ({
  intervalMs   = DEFAULT_INTERVAL_MS,
  bootDelayMs  = BOOT_DELAY_MS,
} = {}) => {
  if (SCHEDULER_DISABLED) {
    console.log(chalk.gray("Background-agent scheduler disabled via AI_BG_AGENT_DISABLED=true"));
    return false;
  }
  if (intervalHandle) return false;

  // Boot run — give DB connections a minute to settle, then fire.
  bootHandle = setTimeout(() => {
    enqueue(BACKGROUND_AGENT_QUEUE, { reason: "boot" }).catch((e) =>
      console.warn(chalk.yellow(`[bg-agent] boot enqueue failed: ${e.message}`)));
  }, bootDelayMs);
  if (bootHandle.unref) bootHandle.unref();

  intervalHandle = setInterval(() => {
    enqueue(BACKGROUND_AGENT_QUEUE, { reason: "tick" }).catch((e) =>
      console.warn(chalk.yellow(`[bg-agent] tick enqueue failed: ${e.message}`)));
  }, intervalMs);
  if (intervalHandle.unref) intervalHandle.unref();

  console.log(chalk.green.bold(
    `Background-agent scheduler started — boot+${bootDelayMs}ms, then every ${intervalMs}ms ` +
    `(${Math.round(intervalMs / 3600000)}h)`,
  ));
  return true;
};

/** Stop the scheduler — used for clean shutdown / tests. */
export const stopBackgroundAgentScheduler = () => {
  if (bootHandle)     { clearTimeout(bootHandle);  bootHandle = null; }
  if (intervalHandle) { clearInterval(intervalHandle); intervalHandle = null; }
};
