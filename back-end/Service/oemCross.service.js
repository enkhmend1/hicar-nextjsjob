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
    { new: true, upsert: true, runValidators: true },
  );

  // Invalidate cached lookups (the full pattern is cheaper than enumeration)
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
