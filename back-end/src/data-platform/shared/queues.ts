/**
 * BullMQ wiring. One shared ioredis connection (BullMQ requires
 * `maxRetriesPerRequest: null`). Queues are created lazily and reused.
 *
 * Job options bake in production defaults: retries with exponential backoff
 * and bounded retention so completed/failed jobs don't grow unbounded.
 */

import { Queue, Worker, type Processor, type JobsOptions } from "bullmq";
import { Redis } from "ioredis";
import { env } from "./env.js";
import { logger } from "./logger.js";

let connection: Redis | null = null;

export function getRedisConnection(): Redis {
  if (!env.redisUrl) {
    throw new Error("REDIS_URL is not set — data-platform queues require Redis");
  }
  if (!connection) {
    connection = new Redis(env.redisUrl, { maxRetriesPerRequest: null });
    connection.on("error", (e: Error) => logger.error("redis.error", { err: e.message }));
  }
  return connection;
}

const defaultJobOptions: JobsOptions = {
  attempts: 5,
  backoff: { type: "exponential", delay: 2000 },
  removeOnComplete: { count: 1000 },
  removeOnFail: { count: 5000 },
};

export function makeQueue<DataT = unknown>(name: string): Queue<DataT> {
  return new Queue<DataT>(name, { connection: getRedisConnection(), defaultJobOptions });
}

export function makeWorker<DataT = unknown>(
  name: string,
  processor: Processor<DataT>,
  concurrency = 4,
): Worker<DataT> {
  const worker = new Worker<DataT>(name, processor, {
    connection: getRedisConnection(),
    concurrency,
  });
  worker.on("failed", (job, err) =>
    logger.error("worker.job.failed", { queue: name, jobId: job?.id, err: err.message }),
  );
  worker.on("error", (err) => logger.error("worker.error", { queue: name, err: err.message }));
  worker.on("completed", (job) =>
    logger.debug("worker.job.completed", { queue: name, jobId: job.id }),
  );
  return worker;
}

export async function closeRedis(): Promise<void> {
  if (connection) {
    await connection.quit();
    connection = null;
  }
}
