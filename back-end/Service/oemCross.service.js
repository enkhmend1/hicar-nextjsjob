/**
 * OEM cross-reference service.
 *
 * lookupCross(oem)
 *   → returns the equivalence class for an OEM (primary OR equivalent),
 *     so any party number maps to the canonical bag {oem, brand, partName}.
 *
 * expandOemBag(oems)
 *   → given a list of OEMs, returns the union of all equivalence classes
 *     they belong to (used by the compatibility engine to widen the OEM
 *     match space when looking for marketplace products).
 *
 * upsertCross(payload)
 *   → admin-side write; normalises OEM strings.
 *
 * The reads are cached in Redis for 5 minutes — OEM cross-refs are stable.
 */

import OemCross from "../Model/oemCross.model.js";
import { cacheGet, cacheSet, cacheInvalidate } from "../Config/redis.js";

const norm = (s) => String(s || "").trim().toUpperCase();
const CACHE_TTL = 300;

export const lookupCross = async (oemRaw) => {
  const oem = norm(oemRaw);
  if (!oem) return null;
  const key = `oemx:${oem}`;
  const cached = await cacheGet(key);
  if (cached) return cached;
  const row = await OemCross.findOne({
    $or: [{ primaryOem: oem }, { "equivalents.oem": oem }],
  }).lean();
  if (row) await cacheSet(key, row, CACHE_TTL);
  return row;
};

/**
 * Expand a list of OEMs into the full set of equivalent OEMs.
 * Output is deduped, uppercase.
 */
export const expandOemBag = async (oems) => {
  const bag = new Set();
  const seenRows = new Set();
  for (const o of oems) {
    const n = norm(o);
    if (!n) continue;
    bag.add(n);
    const row = await lookupCross(n);
    if (!row || seenRows.has(String(row._id))) continue;
    seenRows.add(String(row._id));
    bag.add(norm(row.primaryOem));
    for (const e of row.equivalents || []) bag.add(norm(e.oem));
  }
  return [...bag];
};

export const upsertCross = async (payload, addedBy = null) => {
  const doc = {
    primaryOem:   norm(payload.primaryOem),
    primaryBrand: String(payload.primaryBrand || "").trim(),
    partName:     String(payload.partName || "").trim(),
    category:     String(payload.category || "").trim().toLowerCase(),
    source:       payload.source || "manual",
    equivalents:  (payload.equivalents || []).map((e) => ({
      brand: String(e.brand || "").trim(),
      oem:   norm(e.oem),
      note:  String(e.note || "").trim(),
    })),
    addedBy,
  };
  if (!doc.primaryOem) throw new Error("primaryOem required");

  const saved = await OemCross.findOneAndUpdate(
    { primaryOem: doc.primaryOem },
    { $set: doc },
    { returnDocument: "after", upsert: true, runValidators: true },
  );

  // Invalidate cached lookups (the full pattern is cheaper than enumeration)
  await cacheInvalidate("oemx:*");
  return saved;
};

/**
 * Self-learning recall booster. Given a set of OEMs known to be
 * cross-references of one another (e.g. the bag a parts API returned for a
 * single part), merge them into ONE equivalence class so any future lookup
 * of any member expands to all of them.
 *
 * Safe + idempotent:
 *   • anchors on the first existing class a member already belongs to, so we
 *     GROW classes rather than spawn competing ones;
 *   • never downgrades a manually-curated row — it only ADDS new equivalents;
 *   • no-ops (no write, no cache bust) when it would add nothing.
 *
 * NOTE: only feed this TRUSTED cross-refs (a real parts-catalogue hit), not
 * raw LLM guesses — over-linking hurts precision.
 *
 * @param {{ oems?: string[], brand?: string, partName?: string, category?: string, source?: string }} input
 */
export const learnEquivalence = async ({ oems = [], brand = "", partName = "", category = "", source = "auto" } = {}) => {
  const set = [...new Set((oems || []).map(norm).filter(Boolean))];
  if (set.length < 2) return null;
  if (set.length > 24) set.length = 24; // bound pathological inputs

  // Anchor on the first existing class any member already belongs to.
  let anchor = null;
  for (const o of set) {
    const row = await lookupCross(o);
    if (row) { anchor = row; break; }
  }

  const primary = anchor ? norm(anchor.primaryOem) : set[0];
  const existingEquivs = anchor?.equivalents || [];
  const known = new Set([primary, ...existingEquivs.map((e) => norm(e.oem))]);
  const additions = set.filter((o) => !known.has(o));
  if (anchor && additions.length === 0) return anchor; // nothing new

  const safeBrand = (b) => String(b || "").trim() || "Auto";
  const mergedEquivalents = [
    ...existingEquivs.map((e) => ({ brand: safeBrand(e.brand), oem: norm(e.oem), note: e.note || "" })),
    ...additions.map((o) => ({ brand: safeBrand(brand), oem: o, note: `auto:${source}` })),
  ];

  const isManual = anchor?.source === "manual";
  const setFields = {
    primaryOem: primary,
    equivalents: mergedEquivalents,
    // Preserve manually-curated metadata; only fill it for auto/empty rows.
    ...(isManual ? {} : {
      primaryBrand: anchor?.primaryBrand || safeBrand(brand),
      partName:     anchor?.partName || String(partName || "").trim(),
      category:     anchor?.category || String(category || "").trim().toLowerCase(),
      source:       anchor?.source || source,
    }),
  };

  const saved = await OemCross.findOneAndUpdate(
    { primaryOem: primary },
    { $set: setFields },
    { returnDocument: "after", upsert: true, runValidators: true },
  );
  await cacheInvalidate("oemx:*");
  return saved;
};

export const removeCross = async (id) => {
  const r = await OemCross.findByIdAndDelete(id);
  await cacheInvalidate("oemx:*");
  return r;
};

export const listCross = async ({ q, category, limit = 50, skip = 0 } = {}) => {
  const filter = {};
  if (category) filter.category = String(category).toLowerCase();
  if (q) {
    const n = norm(q);
    filter.$or = [
      { primaryOem: { $regex: n, $options: "i" } },
      { "equivalents.oem": { $regex: n, $options: "i" } },
      { partName: { $regex: q, $options: "i" } },
    ];
  }
  const [items, total] = await Promise.all([
    OemCross.find(filter).sort({ updatedAt: -1 }).skip(Number(skip)).limit(Math.min(200, Number(limit))).lean(),
    OemCross.countDocuments(filter),
  ]);
  return { items, total };
};
