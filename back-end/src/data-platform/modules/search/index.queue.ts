/**
 * Producer for the search-index queue. The normalization pipeline (and the
 * correction service) enqueue here after writing a normalized product; the
 * indexer worker syncs that listing into Typesense. BullMQ gives us the
 * outbox guarantees — durable, retried, decoupled from Typesense uptime.
 */

import { makeQueue } from "../../shared/queues.js";

export const INDEX_QUEUE = "dp:index";

export interface IndexJobData {
  normalizedProductId: string;
}

export const indexQueue = makeQueue<IndexJobData>(INDEX_QUEUE);

export async function enqueueIndex(normalizedProductId: string): Promise<void> {
  await indexQueue.add("index", { normalizedProductId }, { jobId: `idx:${normalizedProductId}` });
}
