/**
 * Compatibility engine.
 *
 * Given an identified Vehicle, find marketplace Products that fit it.
 *
 * Scoring (highest wins, ties broken by rating then recency):
 *   100  exact OEM bag hit                   (engine-OEM cross-ref hit)
 *    80  engine code match (e.g. 2GR-FSE)
 *    60  exact model + manufacturer match
 *    40  manufacturer match (catch-all)
 *
 * A product can hit multiple criteria — we take the max so the same
 * product isn't duplicated. The engine returns the top N products
 * ranked by score with explanations.
 *
 *   findCompatibleParts(vehicle, { limit, category, seedOems? })
 *     → { items: Product[], counts: { byTier: {...} } }
 *
 * `seedOems` is optional: callers can pre-compute a list of likely OEMs
 * (e.g. from prior queries or AI) and the engine widens the search via
 * the OEM cross-reference table.
 */

import mongoose from "mongoose";
import Product from "../Model/product.model.js";
import { expandOemBag } from "./oemCross.service.js";

// TEXT_* tiers rank free-text "compatible"/"tags" hits BELOW the matching
// structured tier (a typed model ref is more trustworthy than a free-text
// model name) but a free-text MODEL hit still beats a structured MAKE-only
// hit, since model-level is more specific than make-level.
const TIER = { OEM: 100, ENGINE: 80, MODEL: 60, TEXT_MODEL: 55, MANUFACTURER: 40, TEXT_MAKE: 35 };

const oid = (v) => (v instanceof mongoose.Types.ObjectId ? v : new mongoose.Types.ObjectId(v));

// Vehicle make/model display names (snapshot first, then top-level fallback).
const vehMake  = (v) => String(v.snapshot?.manuname  || v.manuname  || "").trim();
const vehModel = (v) => String(v.snapshot?.modelname || v.modelname || "").trim();
const escapeRx = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Case-insensitive substring test against any element of a string array.
const textIncludes = (arr, needle) => {
  const n = String(needle || "").toLowerCase();
  if (!n) return false;
  return (arr || []).some((s) => String(s || "").toLowerCase().includes(n));
};

const projectMatch = (matchScore, why) => ({
  $addFields: { _matchScore: { $literal: matchScore }, _matchReason: { $literal: why } },
});

/**
 * Build the disjunction filter from the vehicle's normalized refs.
 *
 * @returns {object} mongo filter
 */
const baseFilter = (vehicle, expandedOemBag) => {
  const or = [];

  if (expandedOemBag.length > 0) {
    or.push({ "compatibility.oemBag": { $in: expandedOemBag } });
    or.push({ oem: { $in: expandedOemBag } });
  }
  if (vehicle.snapshot?.motorcode) {
    or.push({ "compatibility.engineCodes": vehicle.snapshot.motorcode });
  }
  if (vehicle.engine) {
    or.push({ "compatibility.engines": oid(vehicle.engine) });
  }
  if (vehicle.model) {
    or.push({ "compatibility.models": oid(vehicle.model) });
  }
  if (vehicle.manufacturer) {
    or.push({ "compatibility.manufacturers": oid(vehicle.manufacturer) });
  }

  // Free-text fallback so seller-entered "тохирох машин" is actually
  // searchable. Sellers + bulk import fill the free-text `compatible`
  // array (and vehicle terms leak into `tags`), but nothing populates the
  // structured `compatibility.*` refs — so without this a part is findable
  // ONLY by exact OEM. Match the vehicle make/model name against both.
  const makeName = vehMake(vehicle);
  const modelName = vehModel(vehicle);
  if (modelName) {
    const rx = new RegExp(escapeRx(modelName), "i");
    or.push({ compatible: rx }, { tags: rx });
  }
  if (makeName) {
    const rx = new RegExp(escapeRx(makeName), "i");
    or.push({ compatible: rx }, { tags: rx });
  }

  return {
    status: "approved",
    inStock: true,
    ...(or.length > 0 ? { $or: or } : {}),
  };
};

/**
 * Pure scoring — given a fetched product and the vehicle context, return
 * the max-tier reason. Runs in JS after the DB query so we can attach
 * human-readable explanations.
 */
const scoreProduct = (p, vehicle, oemBag) => {
  const oemBagSet = new Set(oemBag);
  if (p.oem && oemBagSet.has(String(p.oem).toUpperCase())) {
    return { score: TIER.OEM, reason: `OEM match (${p.oem})` };
  }
  if ((p.compatibility?.oemBag || []).some((x) => oemBagSet.has(String(x).toUpperCase()))) {
    return { score: TIER.OEM, reason: `OEM cross-reference match` };
  }
  const ec = vehicle.snapshot?.motorcode;
  if (ec && (p.compatibility?.engineCodes || []).map((x) => String(x).toUpperCase()).includes(ec)) {
    return { score: TIER.ENGINE, reason: `Engine code ${ec}` };
  }
  if (vehicle.engine && (p.compatibility?.engines || []).some((id) => String(id) === String(vehicle.engine))) {
    return { score: TIER.ENGINE, reason: `Engine ref match` };
  }
  if (vehicle.model && (p.compatibility?.models || []).some((id) => String(id) === String(vehicle.model))) {
    return { score: TIER.MODEL, reason: `Model match` };
  }
  // Free-text fallback (compatible[] + tags[]) — ranked just under the
  // structured equivalents.
  const makeName = vehMake(vehicle);
  const modelName = vehModel(vehicle);
  const hay = [...(p.compatible || []), ...(p.tags || [])];
  if (modelName && textIncludes(hay, modelName)) {
    return { score: TIER.TEXT_MODEL, reason: `Compatible-list model (${modelName})` };
  }
  if (vehicle.manufacturer && (p.compatibility?.manufacturers || []).some((id) => String(id) === String(vehicle.manufacturer))) {
    return { score: TIER.MANUFACTURER, reason: `Manufacturer match` };
  }
  if (makeName && textIncludes(hay, makeName)) {
    return { score: TIER.TEXT_MAKE, reason: `Compatible-list make (${makeName})` };
  }
  return { score: 0, reason: "no-match" };
};

export const findCompatibleParts = async (vehicle, opts = {}) => {
  const { limit = 24, category = null, seedOems = [] } = opts;

  // Build the OEM equivalence cloud.
  // Start with the seed OEMs caller provided + any OEM hints we know
  // about the engine (none in DB today but reserved for future).
  const oemBag = await expandOemBag(seedOems);

  const filter = baseFilter(vehicle, oemBag);
  if (category) filter.category = String(category).toLowerCase();

  // Pull a generous superset (capped) to allow JS-side ranking.
  const candidates = await Product.find(filter)
    .limit(Math.max(limit * 3, 60))
    .populate("seller", "name sellerProfile.shopName sellerProfile.rating")
    .lean();

  const scored = candidates
    .map((p) => {
      const { score, reason } = scoreProduct(p, vehicle, oemBag);
      return { ...p, _matchScore: score, _matchReason: reason };
    })
    .filter((p) => p._matchScore > 0)
    .sort((a, b) =>
      b._matchScore - a._matchScore ||
      (b.rating ?? 0) - (a.rating ?? 0) ||
      (new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    )
    .slice(0, limit);

  const counts = scored.reduce(
    (acc, p) => {
      const tier =
        p._matchScore === TIER.OEM          ? "oem" :
        p._matchScore === TIER.ENGINE       ? "engine" :
        p._matchScore === TIER.MODEL        ? "model" :
        p._matchScore === TIER.TEXT_MODEL   ? "text_model" :
        p._matchScore === TIER.MANUFACTURER ? "manufacturer" :
        p._matchScore === TIER.TEXT_MAKE    ? "text_make" : "other";
      acc[tier] = (acc[tier] || 0) + 1;
      return acc;
    },
    {},
  );

  return { items: scored, counts, oemBagSize: oemBag.length };
};
