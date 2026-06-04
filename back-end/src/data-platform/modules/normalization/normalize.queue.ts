/**
 * Producer side of the normalization queue. The ingestion layer enqueues a
 * job per newly-inserted raw_product; the normalize worker (M1 stub → M2 real
 * pipeline) consumes it. `jobId` is keyed on the raw id so the same raw row is
 * never double-queued.
 */

import { makeQueue } from "../../shared/queues.js";

export const NORMALIZE_QUEUE = "dp:normalize";

export interface NormalizeJobData {
  rawProductId: string;
}

export const normalizeQueue = makeQueue<NormalizeJobData>(NORMALIZE_QUEUE);

export async function enqueueNormalize(rawProductId: string): Promise<void> {
  await normalizeQueue.add("normalize", { rawProductId }, { jobId: `norm:${rawProductId}` });
}
