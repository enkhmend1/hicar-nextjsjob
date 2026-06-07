/**
 * Data-platform worker entrypoint (separate process from the API so CPU-heavy
 * ingestion never blocks request latency). Run with `npm run dp:worker`.
 *
 *   dp:import    file → raw_products (+ enqueue normalize), then delete temp file
 *   dp:normalize raw → normalized   (M1 stub; real pipeline in M2)
 */

import "dotenv/config";

import { unlink } from "node:fs/promises";
import { connectMongo } from "./shared/mongo.js";
import { makeWorker } from "./shared/queues.js";
import { logger } from "./shared/logger.js";
import { env } from "./shared/env.js";
import { IMPORT_QUEUE, type ImportJobData } from "./modules/ingestion/import.queue.js";
import { processImportFile } from "./modules/ingestion/ingestion.service.js";
import { NORMALIZE_QUEUE, type NormalizeJobData } from "./modules/normalization/normalize.queue.js";
import { runNormalize } from "./modules/normalization/normalize.worker.js";
import { INDEX_QUEUE, type IndexJobData } from "./modules/search/index.queue.js";
import { runIndex } from "./modules/search/indexer.worker.js";
import { ensureCollection } from "./modules/search/typesense.client.js";

async function main(): Promise<void> {
  await connectMongo();
  await ensureCollection(); // idempotent; no-op when search is disabled

  makeWorker<ImportJobData>(
    IMPORT_QUEUE,
    async (job) => {
      try {
        await processImportFile(job.data);
      } finally {
        await unlink(job.data.filePath).catch(() => {}); // best-effort temp cleanup
      }
    },
    env.importConcurrency,
  );

  makeWorker<NormalizeJobData>(
    NORMALIZE_QUEUE,
    async (job) => {
      await runNormalize(job.data.rawProductId);
    },
    env.normalizeConcurrency,
  );

  makeWorker<IndexJobData>(
    INDEX_QUEUE,
    async (job) => {
      await runIndex(job.data.normalizedProductId);
    },
    4,
  );

  logger.info("dp.workers.started", {
    import: env.importConcurrency,
    normalize: env.normalizeConcurrency,
    index: 4,
  });
}

main().catch((err) => {
  logger.error("dp.workers.boot_failed", { err: (err as Error).message });
  process.exit(1);
});
