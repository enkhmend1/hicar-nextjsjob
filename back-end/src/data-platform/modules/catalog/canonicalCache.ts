/**
 * Cached list of canonical part names — used to CONSTRAIN the AI enrich stage
 * so the model can only choose an existing part type, never invent one. Small,
 * slow-changing reference data; a short TTL cache is plenty.
 */

import { CanonicalPartModel } from "./canonicalPart.model.js";

let names: string[] | null = null;
let loadedAt = 0;
const TTL_MS = 5 * 60 * 1000;
let loadingPromise: Promise<string[]> | null = null;

export async function getCanonicalPartNames(limit = 500): Promise<string[]> {
  if (names && Date.now() - loadedAt < TTL_MS) return names;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const parts = await CanonicalPartModel.find().select("canonicalPartName").limit(limit).lean();
    names = parts.map((p) => p.canonicalPartName);
    loadedAt = Date.now();
    loadingPromise = null;
    return names;
  })();

  return loadingPromise;
}

export function invalidateCanonicalCache(): void {
  names = null;
  loadedAt = 0;
  loadingPromise = null;
}
