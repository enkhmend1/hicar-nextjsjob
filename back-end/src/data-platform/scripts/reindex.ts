/**
 * Rebuild the Typesense search index from MongoDB (the source of truth).
 * Indexes every publishable normalized listing. Safe to re-run. Run with
 * `npm run dp:reindex` (requires Mongo + Typesense up).
 */

import dotenv from "dotenv";
dotenv.config();

import { connectMongo, disconnectMongo } from "../shared/mongo.js";
import { ensureCollection, searchEnabled } from "../modules/search/typesense.client.js";
import { indexNormalized } from "../modules/search/indexer.service.js";
import { NormalizedProductModel } from "../modules/normalization/normalizedProduct.model.js";
import { logger } from "../shared/logger.js";

async function main(): Promise<void> {
  if (!searchEnabled()) {
    logger.warn("reindex.skipped", { reason: "search disabled (TYPESENSE_API_KEY not set)" });
    return;
  }
  await connectMongo();
  await ensureCollection();

  const cursor = NormalizedProductModel.find({ status: { $in: ["auto_approved", "needs_review"] } })
    .select("_id")
    .lean()
    .cursor();

  let n = 0;
  for await (const doc of cursor) {
    await indexNormalized(String(doc._id));
    n += 1;
    if (n % 100 === 0) logger.info("reindex.progress", { indexed: n });
  }

  logger.info("reindex.done", { indexed: n });
  await disconnectMongo();
}

main().catch((err) => {
  logger.error("reindex.failed", { err: (err as Error).message });
  process.exit(1);
});
