/**
 * Smart Search orchestrator.
 *
 * The single function exported here is the brain of the parts marketplace:
 *
 *   Vehicle context  +  Mongolian user query
 *           │                   │
 *           ▼                   ▼
 *      ┌──────────────────────────────┐
 *      │  AI Translator (LLM/fallback)│  → search plan
 *      └──────────────┬───────────────┘
 *                     │ api_english_name + AI's OEM seeds
 *                     ▼
 *      ┌──────────────────────────────┐
 *      │  External Parts API          │  → real OEMs + items
 *      │  (PartsSouq | Amayama | …)   │
 *      └──────────────┬───────────────┘
 *                     │ union of (AI OEMs ∪ external OEMs ∪ cross-refs)
 *                     ▼
 *      ┌──────────────────────────────┐
 *      │  Product matcher             │
 *      │   1. Exact OEM match         │
 *      │   2. Tag / text fallback     │
 *      │   3. Compatibility ranker    │
 *      └──────────────┬───────────────┘
 *                     ▼
 *      Ranked product list ready for the seller marketplace
 *
 * Crucially, every stage is independently fault-tolerant:
 *   • OpenAI down → fallback plan (slang dict + OemMapping table)
 *   • Parts API down → use AI OEMs only
 *   • DB has no exact OEM matches → text/tag fallback
 *
 * The orchestrator NEVER throws — it returns a partial response with
 * `meta.warnings[]` so the frontend can show diagnostic info if it likes.
 */

import Product from "../Model/product.model.js";
import { translateSearchQuery } from "./aiTranslator.service.js";
import { lookupParts } from "./partsGateway.service.js";
import { findCompatibleParts } from "./compatibility.service.js";
import { learnEquivalence } from "./oemCross.service.js";

const cleanCode = (s) => String(s || "").trim().toUpperCase().replace(/\s+/g, "");
const uniq = (arr) => [...new Set(arr)];
const escapeRx = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const buildVehicleContext = (v) => ({
  manuname:   v.snapshot?.manuname  || v.manuname  || "",
  modelname:  v.snapshot?.modelname || v.modelname || "",
  generation: v.snapshot?.generation || v.generation || "",
  motorcode:  v.snapshot?.motorcode || v.motorcode || "",
  motortype:  v.snapshot?.motortype || v.motortype || "",
  carname:    v.snapshot?.carname   || v.carname   || "",
});

/**
 * Main entry. Always returns a structured response — never throws.
 *
 * @param {{
 *   vehicle: object,                  // Vehicle Mongoose doc OR plain snapshot
 *   query:   string,                  // "урд наклад"
 *   limit?:  number,                  // default 24
 *   freshAi?: boolean,                // bypass AI cache
 *   freshParts?: boolean,             // bypass parts cache
 * }} args
 */
export const smartSearch = async (args) => {
  const started = Date.now();
  const warnings = [];
  const limit = Math.min(60, Math.max(1, Number(args.limit) || 24));
  const vehicleCtx = buildVehicleContext(args.vehicle || {});

  // ── Step 1: AI translator (always returns a plan, even on failure) ──
  const ai = await translateSearchQuery(args.query, vehicleCtx).catch((e) => ({
    plan: { standard_category: "", api_english_name: args.query, search_keywords: [args.query], possible_oem_codes: [], possible_cross_codes: [] },
    source: "fallback",
    tookMs: 0,
    error: e.message,
  }));
  if (ai.error) warnings.push(`ai:${ai.error}`);

  const plan = ai.plan;
  const aiOemSeeds = uniq([...plan.possible_oem_codes, ...plan.possible_cross_codes].map(cleanCode));

  // ── Step 2: External parts API (provides real OEMs for this exact vehicle) ──
  const external = await lookupParts({
    vehicle:    vehicleCtx,
    englishName: plan.api_english_name || args.query,
    oemSeeds:   aiOemSeeds.slice(0, 10),
  }, { fresh: args.freshParts });
  if (external.error) warnings.push(`parts:${external.error.code}`);

  // ── Step 3: Merge + dedupe the OEM bag ──
  const externalOems = (external.oems || []).map(cleanCode).filter(Boolean);
  const oemBag = uniq([
    ...aiOemSeeds,
    ...externalOems,
  ]);

  // Self-learning OEM recall: when the parts catalogue returned a real
  // cross-reference set for this exact part, remember it so future lookups of
  // any member expand to the whole class. Fire-and-forget — never block or
  // fail the response on the learn step, and learn ONLY from the trusted
  // external set (never the LLM's guessed OEM seeds).
  if (external.hit && externalOems.length >= 2) {
    learnEquivalence({
      oems:     externalOems,
      partName: plan.api_english_name || args.query,
      category: plan.standard_category || "",
      source:   "auto",
    }).catch(() => {});
  }

  // ── Step 4: Match against our DB ──
  //   a) exact OEM match (the strongest signal)
  //   b) tag / text fallback using the AI's search_keywords if no OEM hits
  let items = [];
  if (oemBag.length > 0) {
    items = await Product.find({
      status: "approved",
      oem:    { $in: oemBag },
    })
      .populate("seller", "name sellerProfile.shopName sellerProfile.rating")
      .limit(limit)
      .lean();
  }

  let usedFallbackSearch = false;
  if (items.length === 0 && plan.search_keywords.length > 0) {
    usedFallbackSearch = true;
    const rxParts = plan.search_keywords.slice(0, 8).map(escapeRx).join("|");
    const rx = new RegExp(rxParts, "i");
    items = await Product.find({
      status: "approved",
      $or: [{ name: rx }, { tags: rx }, { brand: rx }],
    })
      .populate("seller", "name sellerProfile.shopName sellerProfile.rating")
      .limit(limit)
      .lean();
  }

  // ── Step 5: Compatibility ranker (uses vehicle to score each product) ──
  // findCompatibleParts already accepts seedOems; we feed our bag so the
  // ranking respects the merged OEM list.
  let ranked = items;
  try {
    if (args.vehicle?._id) {
      const r = await findCompatibleParts(args.vehicle, {
        limit,
        seedOems: oemBag,
      });
      // Merge: prefer ranker's output (has _matchScore) but include text-only
      // hits at the bottom so we never strand the user with zero results.
      const seen = new Set(r.items.map((p) => String(p._id)));
      const tail = items.filter((p) => !seen.has(String(p._id))).slice(0, Math.max(0, limit - r.items.length));
      ranked = [...r.items, ...tail];
    }
  } catch (e) {
    warnings.push(`ranker:${e.message}`);
  }

  return {
    query: args.query,
    vehicle: vehicleCtx,
    ai: {
      plan,
      source: ai.source,
      tookMs: ai.tookMs,
      ...(ai.model ? { model: ai.model } : {}),
    },
    external: {
      provider:  external.provider,
      hit:       external.hit,
      oems:      external.oems || [],
      itemsPreview: (external.items || []).slice(0, 12),
      tookMs:    external.tookMs,
      ...(external.proxyUsed ? { proxyUsed: external.proxyUsed } : {}),
    },
    oemBag,
    items:     ranked,
    fallbackSearch: { used: usedFallbackSearch, keywords: plan.search_keywords },
    meta: {
      totalMs:   Date.now() - started,
      itemCount: ranked.length,
      warnings,
    },
  };
};
