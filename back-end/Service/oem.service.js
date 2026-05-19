/**
 * OEM training utilities — query expansion + search logging.
 *
 * Query expansion: the admin-curated `OemMapping` table provides a list of
 * substrings (Mongolian slang, brand+model phrases, generation codes, etc.)
 * that map to a category and optional OEM-prefix hint. We scan the user's
 * query for the longest matching keyword and:
 *   • set `category` if not already provided
 *   • prepend the OEM hint to the search text so the SKU substring match
 *     catches it as well
 *
 * We deliberately keep this *cheap* and in-memory: the table will be
 * small (<1k rows) and refreshed periodically.
 */

import OemMapping from "../Model/oemMapping.model.js";
import SearchLog from "../Model/searchLog.model.js";

// In-process cache. Invalidated when admin mutates a mapping.
let mappingsCache = null;
let mappingsLoadedAt = 0;
const CACHE_TTL_MS = 60 * 1000;

const loadMappings = async () => {
  if (mappingsCache && Date.now() - mappingsLoadedAt < CACHE_TTL_MS) return mappingsCache;
  const rows = await OemMapping.find({ enabled: true }).lean();
  // Longest keyword first so multi-word phrases beat single words
  rows.sort((a, b) => b.keyword.length - a.keyword.length);
  mappingsCache = rows;
  mappingsLoadedAt = Date.now();
  return mappingsCache;
};

/** Force-reload on next call. */
export const invalidateMappingCache = () => {
  mappingsCache = null;
  mappingsLoadedAt = 0;
};

/**
 * Expand a user query using OEM mappings.
 *
 * @param {string} rawQuery
 * @returns {Promise<{ query: string; category: string | ""; hits: Array<{ keyword: string; id: string }> }>}
 */
export const expandQueryWithMappings = async (rawQuery) => {
  const q = (rawQuery || "").trim();
  if (!q) return { query: q, category: "", hits: [] };
  const lower = q.toLowerCase();
  const rows = await loadMappings();

  let category = "";
  const hits = [];
  const oemHints = [];

  for (const r of rows) {
    if (!r.keyword) continue;
    if (lower.includes(r.keyword)) {
      hits.push({ keyword: r.keyword, id: String(r._id) });
      if (!category && r.category) category = r.category;
      if (r.oemHint) oemHints.push(r.oemHint);
    }
  }

  // Best-effort: prepend OEM hint(s) so substring search can also hit OEM
  const enriched = oemHints.length > 0 ? `${q} ${oemHints.join(" ")}`.trim() : q;

  // Bump usage counters (fire-and-forget)
  if (hits.length > 0) {
    const ids = hits.map((h) => h.id);
    OemMapping.updateMany({ _id: { $in: ids } }, { $inc: { usageCount: 1 } }).catch(() => {});
  }

  return { query: enriched, category, hits };
};

/** Log a search; never throws. */
export const logSearch = async (payload) => {
  try {
    await SearchLog.create({
      query: payload.query,
      expandedQuery: payload.expandedQuery || "",
      category: payload.category || "",
      resultCount: payload.resultCount || 0,
      source: payload.source || "ai",
      user: payload.user || null,
      locale: payload.locale || "mn",
    });
  } catch { /* swallow */ }
};
