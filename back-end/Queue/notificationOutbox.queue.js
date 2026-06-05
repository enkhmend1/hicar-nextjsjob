/**
 * Notification outbox worker.
 *
 * Architecture mirrors the reconciliation queue: a setInterval-driven
 * scheduler enqueues a one-shot BullMQ job each tick, which runs
 * `deliverBatch()`. Why setInterval+BullMQ instead of BullMQ's
 * built-in repeatable jobs?
 *
 *   • setInterval ticks even when Redis is disabled (dev/CI).
 *   • The actual delivery work runs inside a BullMQ job → retries,
 *     dead-letter, observability all come for free.
 *   • Multi-replica deployments tick on every replica but the worker is
 *     concurrency=1 and the row claim is atomic, so duplicate ticks are
 *     harmless.
 *
 * Tuning:
 *   OUTBOX_TICK_MS    — how often we drain (default 5s)
 *   OUTBOX_BOOT_MS    — wait this long after boot before first tick (default 5s)
 */

import { logger } from "../Config/logger.js";

import { register, enqueue } from "../Service/jobQueue.service.js";
import { deliverBatch } from "../Service/notificationOutbox.service.js";

export const NOTIFICATION_OUTBOX_QUEUE = "notification-outbox";

const TICK_MS = Number(process.env.OUTBOX_TICK_MS) || 5_000;
const BOOT_MS = Number(process.env.OUTBOX_BOOT_MS) || 5_000;

register(NOTIFICATION_OUTBOX_QUEUE, async () => {
  const result = await deliverBatch();
  if (result.delivered + result.failed + result.deadLettered > 0) {
    logger.info("outbox drain", {
      delivered: result.delivered,
      failed: result.failed,
      deadLettered: result.deadLettered,
    });
  }
  return result;
}, { concurrency: 1 });

let intervalHandle = null;
let bootHandle = null;

/** Start the periodic drain. Idempotent — safe to call multiple times. */
export const startOutboxWorker = ({
  intervalMs = TICK_MS,
  bootDelayMs = BOOT_MS,
} = {}) => {
  if (intervalHandle) return false;

  bootHandle = setTimeout(() => {
    enqueue(NOTIFICATION_OUTBOX_QUEUE, { reason: "boot" }).catch((e) =>
      logger.warn("outbox boot enqueue failed", { err: e }));
  }, bootDelayMs);
  if (bootHandle.unref) bootHandle.unref();

  intervalHandle = setInterval(() => {
    enqueue(NOTIFICATION_OUTBOX_QUEUE, { reason: "tick" }).catch((e) =>
      logger.warn("outbox tick enqueue failed", { err: e }));
  }, intervalMs);
  if (intervalHandle.unref) intervalHandle.unref();

  logger.info("Notification outbox worker started", { intervalMs });
  return true;
};

export const stopOutboxWorker = () => {
  if (bootHandle)     { clearTimeout(bootHandle);  bootHandle = null; }
  if (intervalHandle) { clearInterval(intervalHandle); intervalHandle = null; }
};
