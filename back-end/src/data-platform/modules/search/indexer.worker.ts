/**
 * Indexer worker body — thin adapter over indexNormalized, called by the
 * dp:index BullMQ processor in workers.ts.
 */

import { indexNormalized } from "./indexer.service.js";

export async function runIndex(normalizedProductId: string): Promise<void> {
  await indexNormalized(normalizedProductId);
}
