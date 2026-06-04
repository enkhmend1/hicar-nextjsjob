/**
 * Normalization worker body (M2).
 *
 * Thin adapter: the BullMQ processor calls this, which runs the rules-based
 * pipeline. Kept as its own module so the worker entry doesn't import pipeline
 * internals directly and so M4 can swap/extend the runner cleanly.
 */

import { normalizeRawProduct } from "./normalization.pipeline.js";

export async function runNormalize(rawProductId: string): Promise<void> {
  await normalizeRawProduct(rawProductId);
}
