/**
 * Thin BullMQ wrapper with sync fallback.
 *
 * Why an abstraction?
 *   • In production we want vehicle lookups + bulk imports to be async,
 *     throttled, retry-able and observable. BullMQ on Redis is the
 *     industry default for that.
 *   • In dev / when Redis is disabled we should still be able to call
 *     the same `enqueue()` and have it execute inline — no second code
 *     path for tests.
 *
 * Each "queue" registers a name + a worker function. Producers call
 * `enqueue(name, payload)` and receive a job id. Consumers call
 * `getJob(name, id)` to poll status. Inline mode immediately runs the
 * worker and returns a synthetic "completed" job.
 */

import chalk from "chalk";

const REDIS_URL = process.env.REDIS_URL;
let queueCtor = null;
let workerCtor = null;
let connection = null;

if (REDIS_URL) {
  const { Queue, Worker } = await import("bullmq");
  const IORedis = (await import("ioredis")).default;
  queueCtor = Queue;
  workerCtor = Worker;
  connection = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null, // required by BullMQ
    enableReadyCheck: false,
  });
  console.log(chalk.green.bold(`BullMQ enabled — ${REDIS_URL.replace(/:[^:@]*@/, ":***@")}`));
} else {
  console.log(chalk.yellow("BullMQ disabled (no REDIS_URL) — jobs run inline"));
}

const registry = new Map(); // name → { queue?, worker?, runner }

/**
 * Register a queue and its worker. Call once at boot.
 *   register("vehicle-lookup", async (job) => { ... })
 */
export const register = (name, runner, opts = {}) => {
  if (registry.has(name)) return registry.get(name);

  if (queueCtor && workerCtor && connection) {
    const queue  = new queueCtor(name, { connection });
    const worker = new workerCtor(
      name,
      async (job) => runner(job),
      { connection, concurrency: opts.concurrency || 5 },
    );
    worker.on("failed", (job, err) =>
      console.warn(chalk.red(`[queue:${name}] job ${job?.id} failed: ${err?.message}`)));
    registry.set(name, { queue, worker, runner });
  } else {
    registry.set(name, { runner }); // sync mode
  }
  return registry.get(name);
};

/**
 * Enqueue a job. Returns { id, status }.
 *   id      — Redis job id, or a synthetic id in sync mode
 *   status  — "queued" | "completed" | "failed"
 */
export const enqueue = async (name, data, opts = {}) => {
  const entry = registry.get(name);
  if (!entry) throw new Error(`Queue "${name}" not registered`);

  if (entry.queue) {
    const job = await entry.queue.add(name, data, {
      attempts: opts.attempts ?? 3,
      backoff: opts.backoff ?? { type: "exponential", delay: 500 },
      removeOnComplete: { count: 1000, age: 24 * 60 * 60 },
      removeOnFail:     { count: 5000, age: 7 * 24 * 60 * 60 },
      ...opts,
    });
    return { id: job.id, status: "queued" };
  }

  // sync mode — run immediately, swallow errors into the result envelope
  const syntheticId = `inline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    const result = await entry.runner({ id: syntheticId, name, data });
    return { id: syntheticId, status: "completed", result };
  } catch (err) {
    return { id: syntheticId, status: "failed", error: err.message };
  }
};

/**
 * Cancel a queued/delayed job. Only meaningful in BullMQ mode — inline jobs
 * have already run. Returns true if the job was actually removed, false if
 * it was already past the cancellable state or didn't exist.
 *
 * Used by the escrow flow: when a dispute opens we cancel the delayed
 * release job so the worker doesn't pay the seller while we investigate.
 */
export const cancelJob = async (name, id) => {
  if (!id) return false;
  const entry = registry.get(name);
  if (!entry?.queue) return false;
  try {
    const job = await entry.queue.getJob(id);
    if (!job) return false;
    const state = await job.getState();
    // Only cancellable while still queued / delayed / waiting.
    if (!["waiting", "delayed", "paused", "waiting-children"].includes(state)) return false;
    await job.remove();
    return true;
  } catch {
    return false;
  }
};

/**
 * Fetch a job's status by id (Redis-only — sync jobs are already done).
 */
export const getJob = async (name, id) => {
  const entry = registry.get(name);
  if (!entry?.queue) return { id, status: "completed", inline: true };
  const job = await entry.queue.getJob(id);
  if (!job) return null;
  const state = await job.getState();
  return {
    id: job.id,
    status: state,
    progress: job.progress,
    result: state === "completed" ? job.returnvalue : undefined,
    error:  state === "failed"    ? job.failedReason : undefined,
    attemptsMade: job.attemptsMade,
  };
};

export const queueEnabled = Boolean(queueCtor);
