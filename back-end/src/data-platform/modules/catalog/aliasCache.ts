/**
 * In-memory alias dictionary cache. The deterministic stage-3 lookup hits this
 * on the hot path, so we load all aliases once and refresh on a TTL (or when
 * explicitly invalidated after a seed / correction). In production this would
 * be backed by Redis and invalidated via pub/sub; for M2 a process-local cache
 * with a short TTL is sufficient and dependency-free.
 */

import { PartAliasModel } from "./partAlias.model.js";
import { CanonicalPartModel } from "./canonicalPart.model.js";
import { normalizeText } from "../../shared/text.js";
import { logger } from "../../shared/logger.js";

export interface AliasEntry {
  canonicalPartId: string;
  canonicalName: string;
  weight: number;
  lang: string;
}

let cache: Map<string, AliasEntry> | null = null;
let loadedAt = 0;
const TTL_MS = 5 * 60 * 1000;
// Single in-flight promise guard: concurrent callers share one DB round-trip
// instead of each firing their own query (thundering herd on cache expiry).
let loadingPromise: Promise<Map<string, AliasEntry>> | null = null;

export async function getAliasMap(force = false): Promise<Map<string, AliasEntry>> {
  if (!force && cache && Date.now() - loadedAt < TTL_MS) return cache;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
  const [aliases, parts] = await Promise.all([
    PartAliasModel.find().lean(),
    CanonicalPartModel.find().select("_id canonicalPartName").lean(),
  ]);

  const nameById = new Map(parts.map((p) => [String(p._id), p.canonicalPartName]));
  const map = new Map<string, AliasEntry>();
  for (const a of aliases) {
    const key = normalizeText(a.alias);
    if (!key) continue;
    const entry: AliasEntry = {
      canonicalPartId: String(a.canonicalPartId),
      canonicalName: nameById.get(String(a.canonicalPartId)) ?? "",
      weight: a.weight,
      lang: a.lang,
    };
    const existing = map.get(key);
    // On collision, keep the highest-precision mapping.
    if (!existing || entry.weight > existing.weight) map.set(key, entry);
  }

    cache = map;
    loadedAt = Date.now();
    loadingPromise = null;
    logger.info("alias.cache.loaded", { entries: map.size });
    return map;
  })();

  return loadingPromise;
}

export function invalidateAliasCache(): void {
  cache = null;
  loadedAt = 0;
  loadingPromise = null;
}
