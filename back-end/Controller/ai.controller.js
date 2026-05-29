/**
 * HiCar AI Gateway — Role-Based Controller (Phase A)
 *
 * Single endpoint  POST /api/ai/chat  routed by req.user.role into one of
 * three personas (User / Seller / Admin), each with strict data
 * boundaries and a tightly-scoped tool list.
 *
 * Trust boundary:
 *
 *   ① deriveAiRole(req.user)              → role
 *   ② buildRoleScope(role, req.user)      → { allowedTools, productFilter, … }
 *   ③ Filter TOOLS[] by scope.allowedTools BEFORE sending to LLM
 *   ④ Every tool handler accepts (args, runtime) where runtime carries
 *      the scope, so handlers can't widen access through args.
 *   ⑤ All product output flows through sanitizeProduct(scope) before
 *      reaching the wire.
 *
 * Defensive layers (unchanged from the original hardened controller):
 *
 *   • respondWithError() — cleanup contract for orphan Cloudinary uploads
 *   • validateUserIntent() — reject empty / trivially-short prompts
 *   • Tool-loop guards — maxRounds / maxToolCalls / token budget /
 *     wall-clock / duplicate-signature detection
 *   • mapUpstreamError() — SDK status → stable HTTP contracts
 *
 * Response shape — single discriminated envelope so the frontend renderer
 * is a clean switch (see Service/aiResponse.service.js):
 *
 *   { reply, layout, payload, suggestions?, diagnostics }
 */

import fs from "fs/promises";
import { aiConfig, isAiEnabled } from "../Config/openai.js";
import { cloudinary, cloudinaryEnabled } from "../Config/cloudinary.js";
import Product from "../Model/product.model.js";
import Order from "../Model/order.model.js";
import OemCross from "../Model/oemCross.model.js";
import Vehicle from "../Model/vehicle.model.js";

import { logSearch, expandQueryWithMappings } from "../Service/oem.service.js";
import {
  transliterate, formatHint,
  TRANSLIT_INSTRUCTION_EN, TRANSLIT_INSTRUCTION_MN,
} from "../Service/latinMongolian.service.js";
import { smartSearch } from "../Service/smartSearch.service.js";
import { fetchByPlate, isPlateValid, normalizePlate as garageNormalizePlate } from "../Service/garage.service.js";
import { normalizeAndPersist } from "../Service/vehicleNormalizer.service.js";
import * as aiMemory from "../Service/aiMemory.service.js";
import { detectMongolianPlate } from "../Service/plateDetector.service.js";
import {
  findDeadstock, findShelfLocations, generateQuotation,
} from "../Service/sellerInsights.service.js";
import {
  getFinancialMetrics, getDemandForecast, getMarketGaps,
} from "../Service/adminInsights.service.js";

import {
  deriveAiRole, buildRoleScope, sanitizeProducts,
  scopeFilter, isToolAllowed, detectWrongPersonaCommand,
} from "../Service/aiRole.service.js";
import { buildSystemPrompt } from "../Service/aiPrompts.service.js";
import { buildEnvelope, vagueQueryFormFor } from "../Service/aiResponse.service.js";
import { securityGate } from "../Service/aiSecurity.service.js";
import {
  reflectOnToolCalls, buildEscalation, confidenceBand,
} from "../Service/aiReflection.service.js";
import {
  normalizeVehicleReference, expandQueryWithVehicle,
} from "../Service/vehicleKnowledge.service.js";
import { diagnoseSymptom, isSymptomShaped } from "../Service/diagnostic.service.js";
import { chatWithFallback, buildTextFallbackChain } from "../Service/aiFallback.service.js";
import { getMaintenanceHints, formatMaintenanceHints } from "../Service/maintenanceHints.service.js";

// ────────────────────────────────────────────────────────────────────
// TOOL CATALOGUE — registered once, filtered per-request by role scope
// ────────────────────────────────────────────────────────────────────
const TOOLS = [
  {
    type: "function",
    function: {
      name: "search_products",
      description:
        "Search the marketplace catalogue by name / OEM / brand / category. " +
        "Auto-scoped: User sees approved listings only; Seller sees own inventory; Admin sees everything. " +
        "Understands Mongolian slang (тоормос=brake, фар=lighting, амортизатор=suspension).",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Free-form keywords or OEM code" },
          category: { type: "string", description: "Optional category id (e.g. brake, engine)" },
          limit: { type: "integer", description: "Max results (1-20)", default: 5 },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_vehicle_parts",
      description:
        "Vehicle-aware search powered by external parts API + AI translator + OEM matcher. " +
        "Call this WHENEVER vehicleContext is set — it returns parts known to fit the user's " +
        "exact car. Returns OEMs validated against the manufacturer database.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Mongolian or English part name" },
          limit: { type: "integer", description: "Max results (default 8)", default: 8 },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cross_reference_oem",
      description:
        "Look up aftermarket equivalents (CTR, 555, Febi, Aisin, Sankei, Bosch, NSK, Denso, …) " +
        "for an OEM code. Use this when the OEM part is expensive or out of stock — present " +
        "the cheaper alternative alongside the OEM.",
      parameters: {
        type: "object",
        properties: { oem: { type: "string", description: "OEM part number" } },
        required: ["oem"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "identify_part_from_image",
      description:
        "Use this when the user uploaded an image and is asking what the part is. " +
        "Returns best-guess (category, English keywords, part name) — then call search_products.",
      parameters: {
        type: "object",
        properties: {
          guessName: { type: "string" },
          category:  { type: "string" },
          keywords:  { type: "string" },
          confidence:{ type: "string", enum: ["low", "medium", "high"] },
        },
        required: ["guessName", "category", "keywords"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "disambiguate_vague_query",
      description:
        "Call this when the user typed a BARE category word with no specifics " +
        "(e.g. just \"фар\" / \"тоормос\" / \"амортизатор\" / \"масло\"). " +
        "Returns a structured form (year/model/side/position) for the UI to render.",
      parameters: {
        type: "object",
        properties: { keyword: { type: "string", description: "The vague keyword the user typed" } },
        required: ["keyword"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "diagnose_symptom",
      description:
        "Use this when the user describes a SYMPTOM ('тог тог дуу', 'мотор чичирэх', " +
        "'тоормосны педал зөөлөн', 'хэт халалт') instead of asking for a specific part. " +
        "Returns a ranked list of candidate parts WITH ONE clarifying question. " +
        "ALWAYS call this BEFORE search_products on symptom-shaped input — the " +
        "spec rule is \"diagnose before selling\".",
      parameters: {
        type: "object",
        properties: {
          symptom: { type: "string", description: "The user's symptom description verbatim" },
        },
        required: ["symptom"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "lookup_vehicle_by_plate",
      description:
        "Look up a Mongolian-format license plate (4 digits + 3 Cyrillic letters, e.g. " +
        "\"1234УБА\") via the Garage.mn provider. Returns the matched vehicle (make/model/" +
        "generation/engine) WITHOUT changing the active vehicle — the AI should ask the " +
        "user to confirm, then call switch_active_vehicle. Use this when the user types " +
        "a plate in the chat or explicitly asks to look up a plate.",
      parameters: {
        type: "object",
        properties: {
          plate: { type: "string", description: "Plate in 1234УБА or 1234 уба form" },
        },
        required: ["plate"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "switch_active_vehicle",
      description:
        "Set the user's active vehicle (writes to cross-session memory). Use AFTER the user " +
        "confirms a vehicle from lookup_vehicle_by_plate or selects one from their history. " +
        "Once switched, every subsequent search_vehicle_parts / search_products call uses " +
        "the new vehicle context.",
      parameters: {
        type: "object",
        properties: {
          vehicleId: { type: "string", description: "Mongo _id of the Vehicle doc to activate" },
        },
        required: ["vehicleId"],
      },
    },
  },
  // ── SELLER-scoped inventory tools (Phase B) ───────────────────────
  {
    type: "function",
    function: {
      name: "get_deadstock",
      description:
        "SELLER. Returns the merchant's slow-moving inventory — products with " +
        "zero sales in the past N months AND stock on hand. Each row carries " +
        "trapped capital (costPrice × stockQty) and a suggested liquidation " +
        "discount. Use this when the seller asks about deadstock, slow movers, " +
        "ажилгүй бараа, or capital tied up in inventory.",
      parameters: {
        type: "object",
        properties: {
          monthsSilent: { type: "integer", description: "Sales-silent window in months (default 6)", default: 6 },
          limit:        { type: "integer", description: "Max rows (default 20)", default: 20 },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "find_shelf_location",
      description:
        "SELLER. Look up the warehouse coordinate of a SKU. Call this when " +
        "the seller asks 'where is X' / 'X хаана байна' — accepts OEM, name, " +
        "or partial keyword. Returns shelf code + remaining stock per match.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "OEM, part name, or keyword" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_quotation",
      description:
        "SELLER. Compose a plain-text B2B quotation for a buyer. Use when the " +
        "seller asks for a quote, үнийн санал, прайс, or pricing letter. Each " +
        "line item can be referenced by productId, OEM, or part name.",
      parameters: {
        type: "object",
        properties: {
          buyer: {
            type: "object",
            description: "Buyer info — at least name or company",
            properties: {
              name:    { type: "string" },
              company: { type: "string" },
              phone:   { type: "string" },
              email:   { type: "string" },
            },
          },
          items: {
            type: "array",
            description: "Line items — supply OEM or name plus qty",
            items: {
              type: "object",
              properties: {
                oem:       { type: "string" },
                name:      { type: "string" },
                productId: { type: "string" },
                qty:       { type: "integer", default: 1 },
              },
            },
          },
          validDays:       { type: "integer", description: "Validity window (default 14)", default: 14 },
          vatPercent:      { type: "number",  description: "VAT %, e.g. 10 for Mongolia (default 0)", default: 0 },
          discountPercent: { type: "number",  description: "Bulk discount %, 0–100", default: 0 },
          notes:           { type: "string",  description: "Optional footer note" },
        },
        required: ["items"],
      },
    },
  },

  // ── ADMIN/SELLER shared tools ─────────────────────────────────────
  {
    type: "function",
    function: {
      name: "get_low_stock",
      description: "ADMIN/SELLER. Returns SKUs at or below stock threshold.",
      parameters: {
        type: "object",
        properties: { threshold: { type: "integer", default: 5 } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_sales_summary",
      description:
        "ADMIN sees platform-wide revenue. SELLER sees their own sales " +
        "(orders that include items they sold). Aggregates revenue / order " +
        "count / AOV for today|week|month|all.",
      parameters: {
        type: "object",
        properties: { period: { type: "string", enum: ["today", "week", "month", "all"] } },
      },
    },
  },

  // ── ADMIN-only BI tools (Phase C) ─────────────────────────────────
  {
    type: "function",
    function: {
      name: "get_financial_metrics",
      description:
        "ADMIN. Compute revenue, cost of goods, gross margin, margin %, " +
        "top brands by revenue, status breakdown, and week-over-week (or " +
        "month-over-month) growth rate for a time window. Use this whenever " +
        "the admin asks about margins, profitability, top brands, growth, " +
        "санхүүгийн үзүүлэлт, ашиг.",
      parameters: {
        type: "object",
        properties: {
          period: { type: "string", enum: ["today", "week", "month", "quarter", "all"], default: "week" },
          topN:   { type: "integer", description: "Top brands to surface", default: 5 },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_demand_forecast",
      description:
        "ADMIN. Predict next month's per-SKU demand using rolling N-month " +
        "sales velocity multiplied by a seasonal factor derived from the same " +
        "calendar month last year. Use when the admin asks about forecasting, " +
        "stocking up, эрэлт хэрэгцээ, нөөцийн төлөвлөгөө.",
      parameters: {
        type: "object",
        properties: {
          monthsLookback: { type: "integer", description: "Lookback window for velocity (default 3)", default: 3 },
          limit:          { type: "integer", description: "Top SKUs returned (default 10)", default: 10 },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_market_gaps",
      description:
        "ADMIN. Cluster the past N days of search queries that returned ZERO " +
        "results, sorted by occurrence. Each cluster is a missing-inventory " +
        "opportunity. Use when admin asks about market gaps, missing products, " +
        "цоорхой, олдоогүй бараа, ямар ангилал хайдаг.",
      parameters: {
        type: "object",
        properties: {
          daysLookback:   { type: "integer", description: "Window in days (default 30)", default: 30 },
          minOccurrences: { type: "integer", description: "Cluster size threshold (default 2)", default: 2 },
          limit:          { type: "integer", description: "Max clusters returned (default 15)", default: 15 },
        },
      },
    },
  },
];

// ────────────────────────────────────────────────────────────────────
// Tool handlers — all receive (args, runtime) where runtime carries:
//   { user, role, scope, vehicleContext, locale }
// Handlers MUST honour `scope.productFilter` on every DB query.
// ────────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────────
// Phase AK — Mongolian price/quality intent parser
//
// Buyers often hint at sort/filter intent in NATURAL language rather
// than using the explicit form: "хямд нь юу вэ?", "200мянгаас доош",
// "сайн чанартай нь". The LLM tries its best but is inconsistent —
// so we PRE-EXTRACT a structured hint and pass it as both a sort
// directive to runScopedProductSearch AND a system-prompt note so
// the LLM's prose alignment matches what we sorted by.
//
// Returns `{ sortBy, priceMax, priceMin, minRating, preferTrustedBrand }`
// with whichever fields the text expressed. Unknown → empty.
// ────────────────────────────────────────────────────────────────────
const TRUSTED_BRANDS = new Set([
  "aisin", "denso", "ctr", "555", "febi", "sankei", "bosch", "nsk",
  "koyo", "ntn", "akebono", "advics", "tokico", "kyb", "monroe", "ngk",
]);

const parsePriceIntent = (text) => {
  const s = String(text || "").toLowerCase();
  const out = {};
  if (!s) return out;

  // NOTE: JS `\b` is ASCII-only — Cyrillic letters are \W from regex's POV,
  // so `\bхямд\b` NEVER matches "хямд тоормос". We use a Unicode-friendly
  // boundary: (?:^|[^а-яёөүa-z]) AND (?:[^а-яёөүa-z]|$). This treats both
  // Cyrillic + Latin letters as part of a "word" while still requiring
  // proper word boundaries on either side.
  const word = (w) => new RegExp(`(?:^|[^а-яёөүa-z])(${w})(?:[^а-яёөүa-z]|$)`, "iu");

  // Cheap / cheapest signals
  if (word("хямд|cheap|cheapest|хамгийн\\s*хямд").test(s)) out.sortBy = "price_asc";
  // Expensive / premium
  if (word("үнэтэй|expensive|premium|тансаг").test(s)) out.sortBy = "price_desc";

  // Quality / good
  if (word("сайн\\s*чанартай|чанартай|good\\s*quality|top\\s*quality").test(s)) {
    out.minRating = 4;
    out.preferTrustedBrand = true;
  }
  if (word("хамгийн\\s*сайн|best").test(s)) {
    out.minRating = 4;
    out.preferTrustedBrand = true;
    out.sortBy = out.sortBy || "rating_desc";
  }

  // Price ceiling — supports "200мянга хүртэл", "200к доош", "≤ 200000",
  // "200000-аас доош", "max 200000".
  const ceilMatch = s.match(
    /(?:max\s*|хүртэл\s*|доош\s*|≤\s*|under\s*)?(\d[\d,\s]*)\s*(?:мянга|k|к|тг|₮)?\s*(?:хүртэл|доош|or less|or below)/i,
  );
  if (ceilMatch) {
    const raw = ceilMatch[1].replace(/[,\s]/g, "");
    let n = Number(raw);
    if (/мянга|k|к/i.test(ceilMatch[0]) && n < 100000) n *= 1000;
    if (Number.isFinite(n) && n > 0) out.priceMax = n;
  }

  // Price floor — "200мянгаас дээш", "from 100000"
  const floorMatch = s.match(
    /(?:from\s*|дээш\s*|over\s*|≥\s*)?(\d[\d,\s]*)\s*(?:мянга|k|к|тг|₮)?\s*(?:дээш|or more|or above|from)/i,
  );
  if (floorMatch) {
    const raw = floorMatch[1].replace(/[,\s]/g, "");
    let n = Number(raw);
    if (/мянга|k|к/i.test(floorMatch[0]) && n < 100000) n *= 1000;
    if (Number.isFinite(n) && n > 0) out.priceMin = n;
  }

  return out;
};

// ────────────────────────────────────────────────────────────────────
// Phase AK — smart product ranking.
//
// Mongo regex search returns matches in insertion order — useless for
// "most relevant first" UX. Score each candidate on multiple axes and
// re-sort. The scorer is intentionally explicit (not ML-driven) so
// behaviour is debuggable + tweakable per category later.
//
// Score components (0..100 each, weighted then summed):
//   • exactMatch      45%  — query word appears in name AND in OEM
//   • vehicleFit      25%  — product.fitments include user's vehicle
//   • brandTrust      15%  — TRUSTED_BRANDS contains product.brand
//   • sellerRating    10%  — seller.sellerProfile.rating / 5
//   • priceTier        5%  — non-zero price (free = suspicious filler)
//
// `intent.sortBy === "price_asc"` overrides — score is ignored and we
// sort by price ascending. Same for "price_desc" and "rating_desc".
// ────────────────────────────────────────────────────────────────────
const rankProducts = (items, { query, vehicleContext, intent = {} } = {}) => {
  if (!Array.isArray(items) || items.length === 0) return items;

  // Hard sort overrides — used when intent explicitly asks for it.
  if (intent.sortBy === "price_asc") {
    return [...items].sort((a, b) => (a.price || Infinity) - (b.price || Infinity));
  }
  if (intent.sortBy === "price_desc") {
    return [...items].sort((a, b) => (b.price || 0) - (a.price || 0));
  }
  if (intent.sortBy === "rating_desc") {
    return [...items].sort((a, b) => (b.rating || 0) - (a.rating || 0));
  }

  const words = String(query || "")
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length >= 3);

  const score = (p) => {
    let s = 0;
    const name  = String(p.name  || "").toLowerCase();
    const oem   = String(p.oem   || "").toLowerCase();
    const brand = String(p.brand || "").toLowerCase();

    // exactMatch: how many query words appear in name AND OEM
    if (words.length) {
      const inName = words.filter((w) => name.includes(w)).length;
      const inOem  = words.filter((w) => oem.includes(w)).length;
      s += 45 * (Math.max(inName, inOem) / words.length);
    }

    // vehicleFit
    if (vehicleContext && Array.isArray(p.fitments)) {
      const want = `${vehicleContext.manufacturer || ""} ${vehicleContext.model || ""}`.toLowerCase().trim();
      const hit = p.fitments.some((f) => {
        const fit = `${f.manufacturer || ""} ${f.model || ""}`.toLowerCase();
        return want && fit.includes(want);
      });
      if (hit) s += 25;
    }

    // brandTrust
    if (TRUSTED_BRANDS.has(brand)) s += 15;
    else if (intent.preferTrustedBrand) s -= 10;  // penalty when user wants quality

    // sellerRating
    const r = Number(p.seller?.sellerProfile?.rating || p.rating || 0);
    if (r > 0) s += 10 * Math.min(1, r / 5);

    // priceTier — non-zero price means actual listing
    if (Number(p.price) > 0) s += 5;

    return s;
  };

  return [...items]
    .map((p) => ({ ...p, _score: Math.round(score(p)) }))
    .sort((a, b) => b._score - a._score);
};

/**
 * Lightweight inline product search — scope-aware.
 *
 * Query handling: input is split into individual words (3+ chars each)
 * and OR'd as separate regexes. This is critical because the
 * transliteration pass expands "тоормос" → "тоормос brake" — passing
 * THAT as a single phrase regex `/тоормос brake/i` would never match
 * since no product name literally contains "тоормос brake" together.
 * Splitting + OR-ing means any product matching EITHER word lands.
 *
 * Words under 3 chars are dropped to prevent regex from matching too
 * broadly on noise like single letters.
 *
 * Phase AK: also accepts `intent` (from parsePriceIntent) to apply
 * priceMin/priceMax/minRating filters at the DB layer when present.
 */
const runScopedProductSearch = async ({ query, category, limit = 5, intent = {} }, scope) => {
  const base = scopeFilter(scope);
  const filter = { ...base };
  if (category) filter.category = category;
  if (query) {
    const escape = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Split on whitespace + non-word punctuation; keep alphanumerics (incl.
    // Cyrillic). Drop tokens under 3 chars to avoid noise.
    const words = String(query)
      .split(/[\s,;.!?\-]+/u)
      .map((w) => w.trim())
      .filter((w) => w.length >= 3);
    if (words.length === 0) return [];
    const regexes = words.map((w) => new RegExp(escape(w), "i"));
    // For each field, match if ANY word matches. Cross-field OR via $or.
    filter.$or = regexes.flatMap((rx) => ([
      { name: rx }, { oem: rx }, { brand: rx }, { tags: rx },
    ]));
  }
  // Phase AK: apply price/rating filters from parsed intent so the LLM
  // doesn't have to re-filter client-side.
  if (intent.priceMin) filter.price = { ...(filter.price || {}), $gte: intent.priceMin };
  if (intent.priceMax) filter.price = { ...(filter.price || {}), $lte: intent.priceMax };
  if (intent.minRating) filter.rating = { $gte: intent.minRating };

  // Fetch slightly more than `limit` so the ranker has options to choose
  // from. Hard ceiling = 60 to keep server-side memory bounded.
  //
  // We DON'T populate("seller") here because:
  //   (a) some smoke-test contexts don't load the User schema → throws
  //   (b) rankProducts can score on product.rating directly without
  //       seller details (Phase AK seller score fallback)
  //   (c) the tool result's `items` will be sanitized by sanitizeProduct
  //       which already strips/keeps the right fields per scope
  // If a future caller needs seller info, do `Product.populate` outside
  // this helper.
  const fetchN = Math.max(limit, Math.min(60, limit * 4));
  return Product.find(filter).limit(fetchN).lean();
};

// ────────────────────────────────────────────────────────────────────
// Phase AL — bundle / related-product suggestions.
//
// When a buyer searches for ONE category, we know certain other categories
// are routinely bought together (brake pad → brake fluid, engine → oil
// filter, suspension → wheel bearing). Surfacing those as a small "Хамт
// ихэвчлэн авдаг" strip below the main results is the same pattern
// Amazon's "Frequently bought together" uses to lift cart size.
//
// We KEEP this map small + opinionated rather than learning it from order
// data because:
//   (a) we don't have enough order volume to train anything reliable yet
//   (b) static map is debuggable / editable per-category as the team
//       learns what actually correlates
//   (c) when order data matures, the call site stays the same — just
//       swap the implementation behind `findRelatedProducts`
// ────────────────────────────────────────────────────────────────────
const RELATED_CATEGORIES = Object.freeze({
  // Brakes naturally pair with their fluid + the rotating disc + wheels.
  brake:           ["oils", "wheels_tires", "wheel"],
  // Engine work usually entails oil + filter swap.
  engine:          ["oils", "filters"],
  // Cooling work → check coolant + thermostat in same category.
  cooling_system:  ["oils", "filters"],
  // Suspension work touches bearings + sometimes steering tie-rods.
  suspension:      ["bearings", "steering", "wheel", "wheels_tires"],
  steering:        ["suspension"],
  // Electrical → battery + relevant sensors.
  electric:        ["battery", "sensors"],
  ignition_system: ["filters", "fuel_system"],
  fuel_system:     ["filters"],
  // Air intake / exhaust pair with each other.
  air_intake:      ["filters", "exhaust_system"],
  exhaust_system:  ["filters"],
  // Filters of any kind benefit from showing oils.
  filters:         ["oils"],
  // Battery + starter often replaced together.
  battery:         ["electric"],
  // Wheels / tires often pair with brake work.
  wheel:           ["brake", "suspension"],
  wheels_tires:    ["brake", "suspension"],
});

/**
 * Phase AL — build a regex that matches ANY DB category id whose root
 * normalises to the given bucket. e.g. bucket="brake" matches
 * "brake", "brake_pads", "rear_brake_pads", "brake_fluid", etc.
 * Falls back to literal bucket match for unknown buckets.
 */
const bucketCategoryRegex = (bucket) => {
  const patterns = {
    brake:           "brake",
    engine:          "engine|motor",
    suspension:      "suspension|shock|strut|spring",
    steering:        "steer",
    electric:        "electric|wiring|harness",
    ignition_system: "ignition|spark|coil",
    fuel_system:     "fuel|injector",
    air_intake:      "intake|maf",
    exhaust_system:  "exhaust|muffler|catalytic",
    filters:         "filter",
    battery:         "battery|akkumul",
    cooling_system:  "cool|radiator|coolant",
    wheel:           "wheel|tire|tyre|rim",
    wheels_tires:    "wheel|tire|tyre|rim",
    oils:            "oils|oil|grease|lubricant",
    bearings:        "bearing",
    sensors:         "sensor",
  };
  const pat = patterns[bucket] || bucket;
  return new RegExp(pat, "i");
};

/**
 * Phase AL — normalise a category id to a "root bucket" so seller-
 * authored variants like "rear_brake_pads" / "front_brake_pads" /
 * "brake_pads" / "brake_fluid" all bucket back to "brake" for the
 * bundle-suggestion lookup. Falls back to the original id.
 */
const categoryRoot = (catId) => {
  if (!catId) return catId;
  const s = String(catId).toLowerCase();
  if (/brake/.test(s)) return "brake";
  if (/engine|motor/.test(s)) return "engine";
  if (/suspension|shock|strut|spring/.test(s)) return "suspension";
  if (/steer/.test(s)) return "steering";
  if (/electric|wiring|harness/.test(s)) return "electric";
  if (/ignition|spark|coil/.test(s)) return "ignition_system";
  if (/fuel|injector/.test(s)) return "fuel_system";
  if (/intake|maf/.test(s)) return "air_intake";
  if (/exhaust|muffler|catalytic/.test(s)) return "exhaust_system";
  if (/filter/.test(s)) return "filters";
  if (/battery|akkumul/.test(s)) return "battery";
  if (/cool|radiator|coolant/.test(s)) return "cooling_system";
  if (/wheel|tire|tyre|rim/.test(s)) return "wheel";
  return s;
};

/**
 * Find up to N "frequently bought together" candidates for a given
 * product. Strategy:
 *   1. Look up RELATED_CATEGORIES[product.category]
 *   2. For each related category, fetch the SINGLE highest-rated
 *      approved product, sorted by rating then price-asc
 *   3. Dedupe by _id (in case categories overlap)
 *   4. Cap at `limit` total
 *
 * Returns []  if no related categories OR no approved candidates.
 * Honours scope (e.g. seller scope = own inventory only).
 */
const findRelatedProducts = async (anchor, scope, limit = 3) => {
  if (!anchor?.category) return [];

  // Try the exact category first, then fall back to the normalised root
  // bucket. This lets seller-authored category ids like "rear_brake_pads"
  // still trigger the brake → oils + wheels suggestions.
  const exactRelated = RELATED_CATEGORIES[anchor.category];
  const rootRelated  = RELATED_CATEGORIES[categoryRoot(anchor.category)];
  const related = exactRelated || rootRelated;
  if (!related || related.length === 0) return [];

  const base = scopeFilter(scope);
  const excludeId = anchor._id || anchor.id;

  // For each related root-bucket, also accept ANY category whose root
  // resolves to that bucket (so related: ["brake"] matches DB rows
  // categorised as "brake_pads" / "rear_brake_pads"). We do this by
  // building one regex per bucket.
  const promises = related.slice(0, limit).map((bucket) => {
    // Build the matching set: exact bucket id + any category whose
    // normalised root resolves to this bucket.
    const rx = bucketCategoryRegex(bucket);
    return Product.find({
      ...base,
      category: { $regex: rx },
      ...(excludeId ? { _id: { $ne: excludeId } } : {}),
    })
      .sort({ rating: -1, price: 1 })
      .limit(1)
      .lean();
  });
  const buckets = await Promise.all(promises);

  // Flatten + dedupe by _id
  const seen = new Set();
  const out = [];
  for (const bucket of buckets) {
    for (const p of bucket) {
      const k = String(p._id);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(p);
      if (out.length >= limit) break;
    }
    if (out.length >= limit) break;
  }
  return out;
};

const TOOL_HANDLERS = {
  async search_products(args, runtime) {
    const { query, category, limit = 5 } = args;
    const { scope, user, vehicleContext } = runtime;

    // Phase I: chassis-code normalisation. "P30 тоормос" → enriches
    // the query with "Toyota Prius ZVW30" so the marketplace catalogue
    // (which stores the canonical form) actually matches. The original
    // colloquial token stays in the query string too, so we never
    // narrow harder than the user did.
    const vehicleEnriched = expandQueryWithVehicle(query);
    const queryAfterVehicle = vehicleEnriched.query;

    // Belt-and-suspenders Latin→Mongolian deterministic dictionary pass.
    const translit = transliterate(queryAfterVehicle);
    const seedQuery = translit.hasHits ? translit.expandedQuery : queryAfterVehicle;
    const seedCategory = category || translit.bestCategory;

    const expanded = await expandQueryWithMappings(seedQuery);
    const finalCategory = seedCategory || expanded.category;
    const finalQuery = expanded.query;

    // Phase AK: parse price/quality intent from the ORIGINAL query
    // (preserved Mongolian/Latin keywords). Applies as DB filters +
    // hard sort overrides where present.
    const intent = parsePriceIntent(query);

    const raw = await runScopedProductSearch({
      query: finalQuery, category: finalCategory, limit, intent,
    }, scope);

    // Phase AK: rank by relevance + vehicle fit + brand trust before
    // slicing to `limit`. Without this, Mongo returns insertion order
    // which is essentially random for the user.
    const ranked = rankProducts(raw, { query: finalQuery, vehicleContext, intent });
    const items = sanitizeProducts(ranked.slice(0, limit), scope);

    // Phase AL: fetch related bundle suggestions for the TOP item.
    // Frontend renders these as a "Хамт ихэвчлэн авдаг" strip. Failure
    // is non-fatal — we just return [] so the main results still ship.
    const anchor = ranked[0];
    const relatedRaw = anchor
      ? await findRelatedProducts(anchor, scope, 3).catch(() => [])
      : [];
    const related = sanitizeProducts(relatedRaw, scope);

    logSearch({
      query, expandedQuery: finalQuery, category: finalCategory,
      resultCount: items.length, source: "ai", user: user?._id,
    }).catch(() => {});

    return {
      query: finalQuery,
      category: finalCategory,
      count: items.length,
      items,
      // Phase AL: cross-category bundle suggestions (max 3). Empty when
      // anchor's category has no related-categories mapping or no
      // approved matches were found.
      related,
      // Phase AK: surface the applied intent so the LLM's prose can
      // align ("Хямдыг нь эхэнд...", "200мянгаас доош 3 тааруу")
      // instead of saying generic "I found 5 parts."
      intent: Object.keys(intent).length ? intent : null,
      transliterated: translit.hasHits
        ? translit.hits.map((h) => ({ surface: h.surface, mn: h.mn, en: h.en }))
        : [],
    };
  },

  async search_vehicle_parts(args, runtime) {
    const { query, limit = 8 } = args;
    const { scope, vehicleContext, user } = runtime;

    // No vehicle? Tell the model so it falls back to plain search.
    if (!vehicleContext) {
      return { error: "vehicleContext not set — use search_products instead", items: [] };
    }

    // Resolve the canonical Vehicle doc. We accept either a hydrated
    // vehicle from the frontend or a Vehicle._id to look up.
    let vehicle = vehicleContext;
    if (vehicleContext.id) {
      const v = await Vehicle.findById(vehicleContext.id).lean();
      if (v) vehicle = { ...v, ...vehicleContext, _id: v._id };
    }

    const result = await smartSearch({
      vehicle, query, limit,
    });

    const items = sanitizeProducts(result.items || [], scope);
    logSearch({
      query,
      expandedQuery: result.ai?.plan?.api_english_name || query,
      category:      result.ai?.plan?.standard_category || "",
      resultCount:   items.length,
      source: "ai-vehicle",
      user: user?._id,
    }).catch(() => {});

    return {
      query,
      count: items.length,
      items,
      plan: {
        englishName: result.ai?.plan?.api_english_name,
        category:    result.ai?.plan?.standard_category,
      },
      oemBag: result.oemBag,
      fallbackUsed: Boolean(result.fallbackSearch?.used),
    };
  },

  async cross_reference_oem(args /*, runtime */) {
    const { oem } = args;
    if (!oem) return { error: "oem required" };
    const clean = String(oem).trim().toUpperCase();

    // Match either primary OR any equivalent so the AI doesn't need to
    // know whether the input is a "main" OEM or a cross-ref already.
    const row = await OemCross.findOne({
      $or: [{ primaryOem: clean }, { "equivalents.oem": clean }],
    }).lean();

    if (!row) return { primaryOem: clean, equivalents: [], found: false };

    // Reformat for the wire — collapse primary + equivalents into one list
    // and tag which one is the OEM.
    const all = [
      { oem: row.primaryOem, brand: row.primaryBrand, role: "oem" },
      ...row.equivalents.map((e) => ({ oem: e.oem, brand: e.brand, role: "aftermarket", note: e.note })),
    ];
    return {
      primaryOem: row.primaryOem,
      partName: row.partName,
      category: row.category,
      equivalents: all,
      found: true,
    };
  },

  async identify_part_from_image(args, runtime) {
    const { keywords, category, guessName, confidence } = args;
    const { scope, user } = runtime;
    const raw = await runScopedProductSearch({ query: keywords, category, limit: 6 }, scope);
    const items = sanitizeProducts(raw, scope);
    logSearch({
      query: keywords, expandedQuery: keywords, category,
      resultCount: items.length, source: "image", user: user?._id,
    }).catch(() => {});
    return { guessName, category, keywords, confidence, count: items.length, items };
  },

  async disambiguate_vague_query(args, runtime) {
    const { keyword } = args;
    const form = vagueQueryFormFor(keyword);
    if (!form) return { partType: keyword, fields: [], note: "" };

    // If we already know the car, drop the car-basics rows from the form
    // so the user only fills in part-specific details.
    const note = runtime.vehicleContext
      ? `${runtime.vehicleContext.manufacturer || ""} ${runtime.vehicleContext.model || ""}`.trim()
      : "";
    return { partType: form.partType, fields: form.fields, note };
  },

  // ── Phase I: symptom → candidate parts diagnostic ─────────────────
  async diagnose_symptom({ symptom }, _runtime) {
    if (!symptom) return { error: "symptom required" };
    const dx = diagnoseSymptom(symptom);
    if (!dx) {
      return {
        symptom,
        patternId: null,
        candidates: [],
        clarifyingQuestions: [
          "Дугуйнаас, хөдөлгүүрээс, тоормосноос, аль хэсгээс шалтгаалж байгааг бичээрэй.",
        ],
        urgency: "low",
        matchStrength: 0,
        note: "Бид энэ шинж тэмдгийг таних боломжгүй — нарийвчлан тайлбарлана уу.",
      };
    }
    return dx;
  },

  // ── Phase G: vehicle switcher tools (USER role) ──────────────────
  async lookup_vehicle_by_plate({ plate }, runtime) {
    if (!plate) return { error: "plate required" };
    if (!isPlateValid(plate)) {
      return { error: "Plate format буруу — 4 тоо + 3 кирилл (1234УБА)" };
    }
    const norm = garageNormalizePlate(plate);

    // Cache hit — Vehicle already in DB. No external roundtrip.
    let vehicle = await Vehicle.findOne({ plate: norm }).lean();
    let isFromCache = Boolean(vehicle);

    if (!vehicle) {
      try {
        const lookup = await fetchByPlate(norm);
        const persisted = await normalizeAndPersist(lookup, {
          userId: runtime.user?._id || null,
        });
        vehicle = persisted.vehicle;
      } catch (e) {
        return { error: `Дугаар олдсонгүй: ${e.message}`, plate: norm };
      }
    }

    // Surface the standard frontend-friendly shape — same keys
    // useCarStore.activeVehicle expects, so the chat widget can swap
    // in the vehicle without an extra fetch.
    // Phase AE: also expose `displacement` and `carname` so the /garage
    // "save recent → garage entry" pre-fill knows engine capacity, and
    // so the AI can mention "2.5L Hybrid" instead of bare codes when
    // engineCode is empty for older listings.
    return {
      vehicleId:    String(vehicle._id),
      plate:        vehicle.plate,
      manufacturer: vehicle.snapshot?.manuname  || "",
      model:        vehicle.snapshot?.modelname || "",
      generation:   vehicle.snapshot?.generation || "",
      engineCode:   vehicle.snapshot?.motorcode  || "",
      engineType:   vehicle.snapshot?.motortype  || "",
      displacement: vehicle.snapshot?.displacement || "",
      carname:      vehicle.snapshot?.carname || "",
      isFromCache,
    };
  },

  async switch_active_vehicle({ vehicleId }, runtime) {
    if (!vehicleId) return { error: "vehicleId required" };
    if (!runtime.user?._id) {
      return { error: "Машин хадгалахын тулд нэвтэрсэн байх ёстой" };
    }

    const vehicle = await Vehicle.findById(vehicleId).lean();
    if (!vehicle) return { error: "Машин олдсонгүй", vehicleId };

    const payload = {
      vehicleId:    String(vehicle._id),
      plate:        vehicle.plate,
      manufacturer: vehicle.snapshot?.manuname  || "",
      model:        vehicle.snapshot?.modelname || "",
      generation:   vehicle.snapshot?.generation || "",
    };
    await aiMemory.setActiveVehicle(runtime.user._id, payload);

    // ALSO patch the runtime context so any tool the LLM calls in
    // the SAME chat turn sees the new vehicle without another round.
    runtime.vehicleContext = {
      ...payload,
      id: payload.vehicleId,
      engineCode: vehicle.snapshot?.motorcode || "",
      engineType: vehicle.snapshot?.motortype || "",
    };

    return {
      switched: true,
      ...payload,
      engineCode:   vehicle.snapshot?.motorcode || "",
      engineType:   vehicle.snapshot?.motortype || "",
      displacement: vehicle.snapshot?.displacement || "",
      carname:      vehicle.snapshot?.carname || "",
    };
  },

  async get_low_stock({ threshold = 5 }, runtime) {
    const { scope } = runtime;
    if (scope.role === "user") return { error: "Not allowed for this role" };

    const filter = {
      ...scopeFilter(scope),
      $or: [{ stockQty: { $lte: threshold } }, { inStock: false }],
    };
    const raw = await Product.find(filter).limit(20).lean();
    const rows = raw.map((p) => ([
      p.oem || p.name,
      p.stockQty ?? 0,
      p.warehouseLocation || "—",
      { kind: "link", label: "Засах", href: `/seller/products/${p._id}` },
    ]));
    return {
      columns: ["OEM / Нэр", "Үлдэгдэл", "Байршил", "Үйлдэл"],
      rows,
      summary: { skuCount: rows.length, threshold },
    };
  },

  // ── SELLER tools (Phase B) ──────────────────────────────────────
  // Each enforces seller scope via scope.sellerId — anonymous users and
  // regular customers never reach here because the tools aren't in their
  // allowedTools list, but we double-check anyway as defense in depth.
  async get_deadstock({ monthsSilent = 6, limit = 20 } = {}, runtime) {
    const { scope } = runtime;
    if (scope.role !== "seller" && scope.role !== "admin") return { error: "Not allowed for this role" };
    const sellerId = scope.sellerId || runtime.user?._id;
    if (!sellerId) return { error: "Seller context missing" };

    const r = await findDeadstock(sellerId, { monthsSilent, limit });
    if (r.items.length === 0) {
      return {
        columns: ["OEM / Нэр", "Үлдэгдэл", "Сүүлд зарагдсан", "Бэхэлсэн капитал", "Хямдрах"],
        rows: [],
        summary: { ...r.summary, message: `Хамгийн сүүлийн ${monthsSilent} сард deadstock алга — сайн байна! 🎉` },
      };
    }
    const rows = r.items.map((it) => ([
      `${it.oem || it.name}${it.warehouseLocation ? ` (${it.warehouseLocation})` : ""}`,
      it.stockQty,
      `${it.monthsSilent}+ сар`,
      `₮${it.trappedCapital.toLocaleString("mn-MN")}`,
      {
        kind: "button",
        label: `${Math.round(it.suggestedDiscount * 100)}% хямдрал → ₮${it.liquidationPrice.toLocaleString("mn-MN")}`,
        action: `discount:${it.productId}:${Math.round(it.suggestedDiscount * 100)}`,
      },
    ]));
    return {
      columns: ["OEM / Нэр", "Үлдэгдэл", "Сүүлд зарагдсан", "Бэхэлсэн капитал", "Хямдрах"],
      rows,
      summary: {
        totalSku:        r.summary.totalSku,
        trappedCapital:  `₮${r.summary.trappedCapital.toLocaleString("mn-MN")}`,
        monthsSilent:    r.summary.monthsSilent,
      },
    };
  },

  async find_shelf_location({ query }, runtime) {
    const { scope } = runtime;
    if (scope.role !== "seller" && scope.role !== "admin") return { error: "Not allowed for this role" };
    const sellerId = scope.sellerId || runtime.user?._id;
    if (!sellerId) return { error: "Seller context missing" };

    const r = await findShelfLocations(sellerId, query);
    if (r.items.length === 0) {
      return {
        columns: ["OEM / Нэр", "Үлдэгдэл", "Байршил", "Үнэ"],
        rows: [],
        summary: { matchCount: 0, message: `"${query}" гэх SKU олдсонгүй — OEM код эсвэл бараагийн нэрээ нягтлаарай.` },
      };
    }
    const rows = r.items.map((it) => ([
      `${it.name}${it.oem ? ` (${it.oem})` : ""}`,
      it.stockQty,
      it.warehouseLocation,
      `₮${it.price.toLocaleString("mn-MN")}`,
    ]));
    return {
      columns: ["OEM / Нэр", "Үлдэгдэл", "Байршил", "Үнэ"],
      rows,
      summary: r.summary,
    };
  },

  async generate_quotation(args, runtime) {
    const { scope } = runtime;
    if (scope.role !== "seller" && scope.role !== "admin") return { error: "Not allowed for this role" };
    const sellerId = scope.sellerId || runtime.user?._id;
    if (!sellerId) return { error: "Seller context missing" };

    try {
      const q = await generateQuotation({
        sellerId,
        items:           args.items || [],
        buyer:           args.buyer || {},
        validDays:       args.validDays,
        vatPercent:      args.vatPercent,
        discountPercent: args.discountPercent,
        notes:           args.notes,
      });
      return {
        quoteId:  q.quoteId,
        bodyText: q.bodyText,
        summary:  q.summary,
      };
    } catch (e) {
      return { error: e.message };
    }
  },

  async get_sales_summary({ period = "today" }, runtime) {
    // Phase J.3: dual-scope. Sellers see ONLY their own line-item revenue;
    // admins see the platform total. Users are forbidden upstream (scope
    // doesn't grant the tool), but defence-in-depth says no anyway.
    const { scope } = runtime;
    if (scope.role !== "admin" && scope.role !== "seller") {
      return { error: "Not allowed for this role" };
    }

    const now = new Date();
    let since = null;
    if      (period === "today") { since = new Date(now); since.setHours(0, 0, 0, 0); }
    else if (period === "week")  { since = new Date(now); since.setDate(now.getDate() - 7); }
    else if (period === "month") { since = new Date(now); since.setMonth(now.getMonth() - 1); }

    const baseMatch = { status: { $in: ["paid", "processing", "shipped", "delivered"] } };
    if (since) baseMatch.createdAt = { $gte: since };

    // Admin path — order total = the full marketplace revenue.
    if (scope.role === "admin") {
      const orders = await Order.find(baseMatch).lean();
      const total = orders.reduce((s, o) => s + (o.total || 0), 0);
      return {
        kind: "kpi_grid",
        title: `Sales — ${period}`,
        data: {
          period, scope: "platform",
          orderCount: orders.length,
          revenue: total,
          avgOrder: orders.length ? Math.round(total / orders.length) : 0,
        },
      };
    }

    // Seller path — slice each order by THIS seller's line items only.
    // We $unwind items, match on items.seller, then sum price * qty.
    const sellerId = scope.sellerId || runtime.user?._id;
    if (!sellerId) return { error: "Seller context missing" };

    const [agg] = await Order.aggregate([
      { $match: baseMatch },
      { $unwind: "$items" },
      { $match: { "items.seller": sellerId } },
      { $group: {
          _id: "$_id",
          orderRevenue: { $sum: { $multiply: ["$items.price", { $ifNull: ["$items.qty", 1] }] } },
      } },
      { $group: {
          _id: null,
          orderCount: { $sum: 1 },
          revenue:    { $sum: "$orderRevenue" },
      } },
    ]);

    const orderCount = agg?.orderCount || 0;
    const revenue    = agg?.revenue    || 0;
    return {
      kind: "kpi_grid",
      title: `Миний борлуулалт — ${period}`,
      data: {
        period, scope: "seller",
        orderCount,
        revenue,
        avgOrder: orderCount > 0 ? Math.round(revenue / orderCount) : 0,
      },
    };
  },

  // ── ADMIN BI tools (Phase C) ───────────────────────────────────
  // All three are read-only aggregations; they delegate to
  // adminInsights.service which owns the math. The handlers do nothing
  // more than gate by role and forward args.
  async get_financial_metrics({ period = "week", topN = 5 } = {}, runtime) {
    if (runtime.scope.role !== "admin") return { error: "Admin only" };
    try {
      return await getFinancialMetrics({ period, topN });
    } catch (e) {
      return { error: e.message };
    }
  },

  async get_demand_forecast({ monthsLookback = 3, limit = 10 } = {}, runtime) {
    if (runtime.scope.role !== "admin") return { error: "Admin only" };
    try {
      return await getDemandForecast({ monthsLookback, limit });
    } catch (e) {
      return { error: e.message };
    }
  },

  async get_market_gaps({ daysLookback = 30, minOccurrences = 2, limit = 15 } = {}, runtime) {
    if (runtime.scope.role !== "admin") return { error: "Admin only" };
    try {
      return await getMarketGaps({ daysLookback, minOccurrences, limit });
    } catch (e) {
      return { error: e.message };
    }
  },
};

// ────────────────────────────────────────────────────────────────────
// Asset cleanup — orphan-upload defence (unchanged from prior hardened)
// ────────────────────────────────────────────────────────────────────
const cleanupUploadedAsset = async (req) => {
  const file = req?.file;
  if (!file) return;
  req.file = null;
  try {
    if (cloudinaryEnabled && file.filename) {
      await cloudinary.uploader.destroy(file.filename, { invalidate: true });
    } else if (file.path && !/^https?:/i.test(file.path)) {
      await fs.unlink(file.path);
    }
  } catch (err) {
    console.warn(`[ai.controller] asset cleanup failed: ${err.message}`);
  }
};

const respondWithError = async (req, res, status, body, headers = {}) => {
  await cleanupUploadedAsset(req);
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  return res.status(status).json(body);
};

// ────────────────────────────────────────────────────────────────────
// Request normalisation — accepts JSON (multi-turn) or multipart (image)
// ────────────────────────────────────────────────────────────────────
const normaliseRequest = (req) => {
  const locale = String(req.body?.locale || "mn") === "en" ? "en" : "mn";

  // vehicleContext can be sent as object (JSON) or JSON-stringified (multipart).
  let vehicleContext = req.body?.vehicleContext || null;
  if (typeof vehicleContext === "string") {
    try { vehicleContext = JSON.parse(vehicleContext); }
    catch { vehicleContext = null; }
  }

  // Multipart image-upload path.
  if (req.file && req.file.path) {
    const message = String(req.body?.message || req.body?.text || "").trim();
    let history = [];
    if (req.body?.history) {
      try {
        const parsed = JSON.parse(req.body.history);
        if (Array.isArray(parsed)) history = parsed;
      } catch {
        return { error: { code: "INVALID_HISTORY", message: "history must be JSON-stringified array" } };
      }
    }
    return {
      data: {
        locale, vehicleContext,
        imageUrl: req.file.path,
        messages: [
          ...history,
          { role: "user", content: message || "Identify the car part in this image.", imageUrl: req.file.path },
        ],
      },
    };
  }

  const messages = Array.isArray(req.body?.messages) ? req.body.messages : null;
  if (!messages || messages.length === 0) {
    return { error: { code: "NO_MESSAGES", message: "messages array required" } };
  }
  const lastUser = [...messages].reverse().find((m) => m && m.role === "user");
  const imageUrl = lastUser?.imageUrl || null;
  return { data: { locale, vehicleContext, imageUrl, messages } };
};

const MIN_TEXT_CHARS = 3;
const validateUserIntent = ({ messages, imageUrl, locale }) => {
  if (imageUrl) return { ok: true };
  const last = [...messages].reverse().find((m) => m && m.role === "user");
  const text = String(last?.content || "").trim();
  const signal = text.replace(/[^\p{L}\p{N}]/gu, "");
  if (signal.length < MIN_TEXT_CHARS) {
    return {
      ok: false,
      code: "EMPTY_PROMPT",
      message: locale === "en"
        ? `Please describe what you're looking for (at least ${MIN_TEXT_CHARS} letters or digits).`
        : `Юу хайж байгаагаа бичнэ үү (доод тал нь ${MIN_TEXT_CHARS} үсэг эсвэл тоо).`,
    };
  }
  return { ok: true };
};

const toCompletionMessage = (m) => {
  if (m.role === "user" && m.imageUrl) {
    return {
      role: "user",
      content: [
        { type: "text", text: m.content || "Identify the car part in this image." },
        { type: "image_url", image_url: { url: m.imageUrl, detail: "high" } },
      ],
    };
  }
  return { role: m.role, content: m.content };
};

// ────────────────────────────────────────────────────────────────────
// Tool-loop limits — Phase K: scaled per role.
//
// USER queries are usually 1-2 turns ("show me brake pads"); the
// baseline budget is sized for that. SELLER and ADMIN tasks routinely
// chain 4-6 tools ("deadstock → low_stock → sales summary → quote")
// and would otherwise hit caps mid-thought.
//
// Scaling rules:
//   USER   = baseline (env-overridable)
//   SELLER = 2× baseline
//   ADMIN  = 3× baseline
//
// Free-tier Groq cost = 0; the only resource is rate-limit quota.
// Sellers + admins are rare, so giving them headroom does not starve
// regular users. Caps still exist — these are bounded agents, not
// runaway loops.
// ────────────────────────────────────────────────────────────────────
const num = (v, d) => {
  const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d;
};

const BASE_LIMITS = Object.freeze({
  maxRounds:       num(process.env.AI_MAX_TOOL_ROUNDS,   3),
  maxToolCalls:    num(process.env.AI_MAX_TOOL_CALLS,    6),
  maxTotalTokens:  num(process.env.AI_MAX_TOTAL_TOKENS,  8000),
  walltimeMs:      num(process.env.AI_WALLTIME_MS,       25_000),
  maxOutputTokens: num(process.env.AI_MAX_OUTPUT_TOKENS, 1024),
});

const ROLE_MULT = Object.freeze({
  user:   num(process.env.AI_ROLE_MULT_USER,   1),
  seller: num(process.env.AI_ROLE_MULT_SELLER, 2),
  admin:  num(process.env.AI_ROLE_MULT_ADMIN,  3),
});

/**
 * Compose the effective limits for a given role. Walltime scales too
 * — admins on a slow link still need elbow room for multi-tool turns.
 *
 * `maxOutputTokens` is NOT scaled: a single reply over ~1.5K tokens
 * is bad UX regardless of role (long walls of text are unreadable).
 */
const limitsForRole = (role) => {
  const mult = ROLE_MULT[role] || ROLE_MULT.user;
  return Object.freeze({
    maxRounds:       Math.round(BASE_LIMITS.maxRounds      * mult),
    maxToolCalls:    Math.round(BASE_LIMITS.maxToolCalls   * mult),
    maxTotalTokens:  Math.round(BASE_LIMITS.maxTotalTokens * mult),
    walltimeMs:      Math.round(BASE_LIMITS.walltimeMs     * mult),
    maxOutputTokens: BASE_LIMITS.maxOutputTokens,
  });
};

// Backward-compat alias for any out-of-tree caller (tests, scripts).
// Code inside this file uses limitsForRole() exclusively now.
const LIMITS = BASE_LIMITS;

const callSignature = (tc) =>
  `${tc.function?.name || "?"}:${tc.function?.arguments || ""}`;

// ────────────────────────────────────────────────────────────────────
// Phase M.1: build the text-completion fallback chain ONCE at module
// load. Order: Groq 70b → Groq 8b → Gemini 2.0 Flash. Each entry has
// an independent rate-limit counter, so when Groq's 30 RPM is saturated
// we degrade to a smaller / different-provider model instead of 429-ing
// the user. See Service/aiFallback.service.js for the walking logic.
// ────────────────────────────────────────────────────────────────────
const TEXT_FALLBACK_CHAIN = buildTextFallbackChain();

// ────────────────────────────────────────────────────────────────────
// Conversation engine — passes the runtime context (incl. scope) to
// every tool handler.
// ────────────────────────────────────────────────────────────────────
const runConversation = async ({ profile, messages, runtime, transliterationHint }) => {
  const { scope, locale, vehicleContext } = runtime;

  // Phase K: budget scales with role. limits is per-call (a frozen
  // copy of the role's allowance) so concurrent requests for different
  // roles never share counters.
  const limits = limitsForRole(scope.role);

  // Filter the TOOLS catalogue by what this role is allowed to call.
  const availableTools = !profile.supportsTools ? undefined
    : TOOLS.filter((t) => isToolAllowed(scope, t.function.name));

  const conversation = [
    { role: "system",
      content: buildSystemPrompt({
        role: scope.role, locale, vehicleContext, transliterationHint,
      }) },
    ...messages.map(toCompletionMessage),
  ];

  const ac = new AbortController();
  const walltimeTimer = setTimeout(
    () => ac.abort(new Error("walltime_exceeded")),
    limits.walltimeMs,
  );

  const toolCalls = [];
  const seenSignatures = new Set();
  let lastMessage = null;
  let lastUsage = null;
  let totalTokens = 0;
  let terminate = { reason: "model_finished" };
  // Phase M.1: track which provider actually served each round so we
  // can surface "served by Gemini fallback" in diagnostics.
  let lastUsedProvider = profile.label;
  const fallbackAttempts = [];

  // Vision (image-bearing) requests have a single-provider chain —
  // Groq doesn't do vision yet, so we can't fall back to it.
  const chainForThisRequest = profile === aiConfig.vision
    ? [{ client: profile.client, model: profile.model, label: profile.label }]
    : TEXT_FALLBACK_CHAIN;

  try {
    for (let round = 0; round < limits.maxRounds; round++) {
      if (totalTokens >= limits.maxTotalTokens)  { terminate = { reason: "token_budget", totalTokens }; break; }
      if (toolCalls.length >= limits.maxToolCalls){ terminate = { reason: "tool_call_cap", toolCalls: toolCalls.length }; break; }
      if (ac.signal.aborted)                      { terminate = { reason: "walltime" }; break; }

      const body = {
        // model is set per-entry by chatWithFallback; we still pass it
        // here so single-provider paths (vision) keep working.
        model: profile.model,
        messages: conversation,
        temperature: 0.3,
        max_tokens: limits.maxOutputTokens,
      };
      if (availableTools && availableTools.length > 0) {
        body.tools = availableTools;
        body.tool_choice = "auto";
      }

      const { response: resp, usedEntry, attempts } = await chatWithFallback({
        chain: chainForThisRequest, body, signal: ac.signal,
      });
      lastUsedProvider = usedEntry.label;
      fallbackAttempts.push(...attempts);
      lastMessage = resp.choices?.[0]?.message;
      lastUsage   = resp.usage;
      totalTokens += Number(resp.usage?.total_tokens || 0);

      if (!lastMessage?.tool_calls || lastMessage.tool_calls.length === 0) break;

      const newCalls = lastMessage.tool_calls;
      const dupIndex = newCalls.findIndex((tc) => seenSignatures.has(callSignature(tc)));
      if (dupIndex !== -1) {
        terminate = { reason: "duplicate_tool_call", signature: callSignature(newCalls[dupIndex]) };
        break;
      }

      conversation.push(lastMessage);

      for (const tc of newCalls) {
        if (toolCalls.length >= limits.maxToolCalls) {
          terminate = { reason: "tool_call_cap", toolCalls: toolCalls.length };
          break;
        }
        seenSignatures.add(callSignature(tc));

        // Hard gate: even if the LLM somehow asked for a tool we filtered
        // out, refuse to execute it. Defence in depth.
        const name = tc.function?.name;
        if (!isToolAllowed(scope, name)) {
          toolCalls.push({ name, result: { error: `Tool not allowed for role ${scope.role}` } });
          conversation.push({
            role: "tool", tool_call_id: tc.id,
            content: JSON.stringify({ error: "tool_not_allowed" }),
          });
          continue;
        }

        const handler = TOOL_HANDLERS[name];
        let result;
        if (!handler) {
          result = { error: `Unknown tool: ${name}` };
        } else {
          try {
            const args = JSON.parse(tc.function.arguments || "{}");
            result = await handler(args, runtime);
          } catch (e) {
            result = { error: e.message };
          }
        }
        toolCalls.push({ name, result });
        conversation.push({
          role: "tool", tool_call_id: tc.id,
          content: JSON.stringify(result),
        });
      }

      // ── Phase H reflection: after this round's tools fired, look at
      // the LAST one and decide whether to inject a recovery hint that
      // the LLM will see on the NEXT round. This is what turns
      // "search → 0 → end" into "search → 0 → cross_ref → match".
      const roundsRemaining = limits.maxRounds - (round + 1);
      const reflection = reflectOnToolCalls(toolCalls, runtime, { roundsRemaining });
      if (reflection.recoveryHint && roundsRemaining > 0) {
        conversation.push({ role: "system", content: reflection.recoveryHint });
      }

      if (terminate.reason !== "model_finished") break;
    }
  } finally {
    clearTimeout(walltimeTimer);
  }

  // Final reflection — the user sees the LAST tool's payload, so its
  // band is the one that determines whether to show an escalation
  // banner on the frontend.
  const finalReflection = reflectOnToolCalls(toolCalls, runtime, { roundsRemaining: 0 });

  return {
    reply: lastMessage?.content || "",
    toolCalls,
    usage: lastUsage,
    totalTokens,
    terminate,
    reflection: finalReflection,
    // Phase M.1: which provider actually answered, plus the per-attempt
    // breakdown — useful for ops dashboards ("how often did we fall back
    // to Gemini last week"). Empty for the happy path on entry #1.
    usedProvider: lastUsedProvider,
    fallbackAttempts,
  };
};

// ────────────────────────────────────────────────────────────────────
// Upstream error mapper (unchanged from prior hardened controller)
// ────────────────────────────────────────────────────────────────────
const mapUpstreamError = (err) => {
  const upstream = Number(err?.status || err?.response?.status || 0);
  if (upstream === 401 || upstream === 403) return { status: 503, body: { code: "AI_AUTH_FAILED", message: "AI provider rejected credentials." } };
  if (upstream === 429) {
    // Phase M.1: cap the suggested cooldown at 15s — by the time the
    // frontend countdown finishes the user has usually rage-typed
    // anyway. Groq's actual Retry-After is honoured if present; we just
    // cap our DEFAULT (was 30) so the worst case isn't a half-minute
    // dead UI. Also bottom-out at 5s so we don't spin retries.
    const headerVal = Number(err?.headers?.["retry-after"]);
    const retryAfter = Number.isFinite(headerVal) && headerVal > 0
      ? Math.min(headerVal, 30)
      : 8;
    return { status: 429, body: { code: "AI_RATE_LIMITED", message: "AI provider is rate-limiting.", retryAfter } };
  }
  if (upstream === 413) {
    // Phase M.3: Groq returns 413 when the prompt exceeds the per-minute
    // TPM cap on a specific model (e.g. 6548 input tokens on 8b's 6K
    // ceiling). The fallback chain should have routed past this, but
    // if EVERY entry 413'd (Gemini unconfigured + only 8b left), give
    // the user actionable copy instead of a generic 500.
    return { status: 413, body: { code: "AI_REQUEST_TOO_LARGE", message: "Request payload exceeds the AI provider's per-minute token cap." } };
  }
  if (upstream === 400 || upstream === 422) return { status: 400, body: { code: "AI_BAD_REQUEST", message: err?.message || "AI rejected request shape." } };
  if (upstream >= 500 && upstream < 600) return { status: 502, body: { code: "AI_UPSTREAM_ERROR", message: "AI provider had internal error." } };
  if (err?.code === "ETIMEDOUT" || err?.code === "ECONNREFUSED"
      || err?.name === "AbortError" || err?.message === "walltime_exceeded") {
    return { status: 502, body: { code: "AI_UPSTREAM_UNREACHABLE", message: "AI provider unreachable or timeout." } };
  }
  return null;
};

// ────────────────────────────────────────────────────────────────────
// Public entry point — POST /api/ai/chat
// ────────────────────────────────────────────────────────────────────
export const handleAIRequest = async (req, res) => {
  // Phase AB: short correlation id so a user can quote it back to ops
  // and we can grep server logs for the matching stack trace. Truncated
  // to 8 chars — collisions are fine over a 24h log window.
  const requestId = Math.random().toString(36).slice(2, 10);
  try {
    // ── Shape the request ─────────────────────────────────────────
    const parsed = normaliseRequest(req);
    if (parsed.error) return respondWithError(req, res, 400, parsed.error);
    const { messages, imageUrl, locale, vehicleContext } = parsed.data;
    const hasImage = Boolean(imageUrl);

    // ── Reject trivially empty prompts (image is its own signal) ──
    const intent = validateUserIntent({ messages, imageUrl, locale });
    if (!intent.ok) return respondWithError(req, res, 400, { code: intent.code, message: intent.message });

    // ── Derive role + scope before any work happens ───────────────
    const role  = deriveAiRole(req.user);
    const scope = buildRoleScope(role, req.user);

    // ── Security gate: prompt-injection / jailbreak / secret extraction
    //    Runs BEFORE the LLM call so adversarial input never reaches Groq.
    //    Same generic refusal regardless of category — anti-fingerprinting.
    const lastUserText = [...messages].reverse().find((m) => m.role === "user")?.content || "";
    const security = securityGate(lastUserText, locale);
    if (security) {
      console.warn(
        `[ai.security] BLOCKED  category=${security.audit.category}  role=${role}  ` +
        `user=${req.user?._id || "anon"}  preview="${security.audit.textPreview.replace(/"/g, "'")}"`,
      );
      await cleanupUploadedAsset(req);
      return res.json({
        reply: security.refusal,
        layout: "plain",
        payload: {},
        diagnostics: { reason: "security_blocked", category: security.audit.category, role },
      });
    }

    // ── Wrong-persona command short-circuit ───────────────────────
    // (e.g. anonymous user typing "today's sales" — answer locally and
    // never invoke the LLM.)
    const wrongPersona = detectWrongPersonaCommand(lastUserText, role);
    if (wrongPersona) {
      await cleanupUploadedAsset(req);
      return res.json({
        reply: wrongPersona.message,
        layout: "plain", payload: {},
        suggestions: [{ label: "Нэвтрэх", cmd: wrongPersona.suggestedRoute }],
        diagnostics: { reason: wrongPersona.type, role },
      });
    }

    // ── Latin-Mongolian transliteration hint (pre-LLM) ────────────
    // Computed BEFORE the no-AI branch so the keyword fallback can also
    // benefit from "toormos" → "тоормос" expansion. The result is reused
    // verbatim by the LLM path below as part of the system prompt.
    const translitResult = transliterate(lastUserText);
    const transliterationHint = formatHint(translitResult, locale);

    // ── No AI provider — degraded but still useful path ───────────
    //
    // The buyer didn't ask "is the LLM up" — they asked for parts. If
    // GROQ_API_KEY is missing we degrade gracefully:
    //
    //   1. Symptom diagnostic engine (regex-only, no LLM needed)
    //   2. Latin→Cyrillic transliteration (so "toormos" → "тоормос")
    //   3. Scope-filtered keyword search using the expanded query
    //
    // The diagnostic path is the key gain — typing "урдны дугуй тог
    // тог дуу" returns a proper candidate-parts card even with zero
    // AI providers configured. Without this branch the chat was a
    // dead end for symptom-shaped queries in self-hosted setups.
    if (!isAiEnabled()) {
      if (hasImage) {
        return respondWithError(req, res, 400, {
          code: "AI_DISABLED_FOR_IMAGE",
          message: locale === "en"
            ? "Image analysis requires an AI provider. Please type the part name instead."
            : "Зургийн шинжилгээ AI provider шаардлагатай. Сэлбэгийн нэрийг бичээд хайна уу.",
        });
      }

      // 1. Try the symptom engine first — same "diagnose before search"
      //    rule the LLM-based path follows. Returns the SAME diagnostic
      //    envelope so the frontend renderer is identical.
      if (isSymptomShaped(lastUserText)) {
        const dx = diagnoseSymptom(lastUserText);
        if (dx) {
          await cleanupUploadedAsset(req);
          return res.json(buildEnvelope({
            replyText: locale === "en"
              ? `Possible causes for "${lastUserText}". Pick one to continue.`
              : `"${lastUserText}" — боломжит шалтгаанууд. Аль нь таны нөхцөлд тааруулж байна?`,
            toolCalls: [{ name: "diagnose_symptom", result: dx }],
            role,
            confidence: 70,                 // regex match — medium confidence
            diagnostics: { route: "fallback", model: "diagnostic-rules" },
          }));
        }
      }

      // 2. Run the keyword search on the TRANSLITERATION-EXPANDED query
      //    so "toormos" / "naklad" / "amortizator" land matches in the
      //    Cyrillic catalogue.
      const expandedQuery = translitResult.hasHits
        ? translitResult.expandedQuery
        : lastUserText;
      const raw = await runScopedProductSearch({ query: expandedQuery, limit: 5 }, scope);
      const items = sanitizeProducts(raw, scope);
      await cleanupUploadedAsset(req);

      // 3. Compose a reply that actually GUIDES the user. Empty results
      //    suggest the next step (try OEM / paste plate / try synonym)
      //    instead of a dead "no results".
      const noHitsCopy = locale === "en"
        ? `No matches for "${lastUserText}". Try the OEM code, your license plate, or a synonym (e.g. "brake pad", "shock absorber").`
        : `"${lastUserText}" — олдсонгүй. OEM код, машины дугаар, эсвэл өөр нэр (жнь "наклад", "амортизатор") туршаад үзнэ үү.`;
      const hitsCopy = locale === "en"
        ? `Found ${items.length} parts. Tap one to see details, or refine with your car's make/model.`
        : `${items.length} сэлбэг олдлоо. Дэлгэрэнгүйг харахын тулд дарна уу.`;

      return res.json(buildEnvelope({
        replyText: items.length === 0 ? noHitsCopy : hitsCopy,
        toolCalls: [{ name: "search_products", result: { items, count: items.length, query: expandedQuery } }],
        role,
        confidence: items.length > 0 ? 75 : 40,
        diagnostics: {
          route: "fallback", model: "keyword-search",
          translitApplied: translitResult.hasHits,
        },
      }));
    }

    // ── Provider routing ──────────────────────────────────────────
    let profile;
    if (hasImage) {
      profile = aiConfig.vision;
      if (!profile.enabled) {
        return respondWithError(req, res, 400, {
          code: "VISION_PROVIDER_UNAVAILABLE",
          message: locale === "en"
            ? "Vision provider not configured. Please type the part name."
            : "Зургийн AI provider тохируулагдаагүй. Сэлбэгийн нэрийг бичээд хайна уу.",
        });
      }
    } else {
      profile = aiConfig.text;
      if (!profile.enabled) profile = aiConfig.vision;
      if (!profile.enabled) {
        return respondWithError(req, res, 503, {
          code: "AI_PROVIDER_UNAVAILABLE",
          message: "AI provider not initialised.",
        });
      }
    }

    // ── Phase G: load cross-session memory + plate-detect nudge ───
    // Memory load is unconditional for logged-in users; anon users get
    // an empty shape so the rest of the pipeline is uniform.
    const memory = await aiMemory.loadMemory(req.user?._id || null);

    // If the frontend didn't supply a vehicleContext but memory has an
    // active vehicle, fall through to memory as the source. This makes
    // the chat "remember" the user's car across sessions even when the
    // frontend forgot to thread vehicleContext (e.g. cold tab open).
    let effectiveVehicleContext = vehicleContext;
    if (!effectiveVehicleContext && memory?.activeVehicle?.vehicleId) {
      const av = memory.activeVehicle;
      effectiveVehicleContext = {
        id:           String(av.vehicleId),
        plate:        av.plate,
        manufacturer: av.manufacturer,
        model:        av.model,
        generation:   av.generation,
      };
    }

    // Detect an embedded plate in the user's latest message — the
    // controller does NOT switch the vehicle, it just nudges the LLM
    // via a system note to use lookup_vehicle_by_plate + ask the user
    // to confirm. This is the "auto + confirmation" UX the user chose.
    const detectedPlate = detectMongolianPlate(lastUserText);
    const plateNudge = detectedPlate
      ? `\n[SYSTEM NOTE] User message contains a Mongolian plate "${detectedPlate.plate}". ` +
        `Call lookup_vehicle_by_plate to identify the vehicle, then ASK the user to confirm ` +
        `("${detectedPlate.plate} — энэ машинд солих уу?") before calling switch_active_vehicle. ` +
        `Do not auto-switch.`
      : "";

    // Phase I: detect chassis code / model shorthand in the message.
    // We don't "switch" anything — just nudge the LLM to refer to the
    // normalised form so its prose is consistent ("Toyota Prius ZVW30"
    // not "P30") and the search query carries the canonical phrase.
    const vehicleHit = normalizeVehicleReference(lastUserText);
    const vehicleNudge = vehicleHit
      ? `\n[SYSTEM NOTE] User mentioned "${vehicleHit.surface}" which canonicalises to ` +
        `"${vehicleHit.canonical}". Use this canonical form when calling search tools.`
      : "";

    // Phase I: detect symptom-shaped input. If the user described a
    // symptom (not a part name), the agent should call diagnose_symptom
    // FIRST and present candidates before any product search.
    const symptomDetected = isSymptomShaped(lastUserText);
    const symptomNudge = symptomDetected
      ? `\n[SYSTEM NOTE] The user's message looks like a SYMPTOM, not a part name. ` +
        `Call diagnose_symptom FIRST. Only after presenting candidate parts (and ` +
        `optionally asking ONE clarifying question) should you search the catalogue.`
      : "";

    // Build the memory summary block — appended to the system prompt
    // so the LLM has cross-session context without us paying for full
    // conversation history.
    const memoryHint = aiMemory.summarizeMemoryForPrompt(memory, locale);

    // Phase AM: maintenance insights. Per-make + per-model + search-
    // triggered hints that the LLM weaves into its reply as a single
    // natural-sounding aside ("...by the way, Toyota Prius owners
    // typically check the hybrid inverter coolant by 80K"). Only fires
    // when there's something meaningful to say — empty string most
    // turns so prompt budget stays unchanged for cold-start chats.
    const maintenanceHints = getMaintenanceHints({
      vehicleContext: effectiveVehicleContext,
      memory,
      lastUserText,
    });
    const maintenanceBlock = formatMaintenanceHints(maintenanceHints);

    const enrichedTranslitHint = [
      transliterationHint, memoryHint, plateNudge, vehicleNudge, symptomNudge, maintenanceBlock,
    ].filter(Boolean).join("\n\n");

    // ── Run the bounded conversation ──────────────────────────────
    const runtime = {
      user: req.user, role, scope, locale, memory,
      vehicleContext: effectiveVehicleContext,
    };

    // Phase AB+AJ: catch tool-loop / LLM crashes and degrade to keyword
    // search instead of returning AI_INTERNAL_ERROR. The buyer should
    // never see a dead "internal error" when there's a perfectly
    // working catalogue lookup we could have served.
    //
    // Phase AJ refinement: 413 (payload too large) and 429 (sustained
    // rate-limit AFTER all chain fallbacks exhausted) ALSO degrade — the
    // user can't recover from those by retrying, and showing them
    // product results is strictly better than "Хүсэлт хэт том" or
    // "Rate limited". The OLD behaviour passed those through to the
    // outer catch which surfaced an unhelpful error.
    //
    // 401 (auth fail) still re-throws because that's an ops problem
    // (bad API key) — falling back to keyword search would mask it from
    // the ops dashboard.
    let reply, toolCalls, usage, totalTokens, terminate, reflection, usedProvider, fallbackAttempts;
    try {
      ({ reply, toolCalls, usage, totalTokens, terminate, reflection, usedProvider, fallbackAttempts } =
        await runConversation({ profile, messages, runtime, transliterationHint: enrichedTranslitHint }));
    } catch (llmErr) {
      const upstreamStatus = Number(llmErr?.status || llmErr?.response?.status || 0);
      // 401/403 — bona-fide auth failure. Let ops see the alert.
      if (upstreamStatus === 401 || upstreamStatus === 403) throw llmErr;

      // Anything else (a tool crash, a JSON.stringify circular, smartSearch
      // rejecting, …) is a code bug — log it loud with the request id and
      // serve the user a keyword-search result so the chat thread isn't dead.
      console.error(
        `[ai.controller][${requestId}] runConversation crashed — degrading to keyword search.`,
        `\n  user=${req.user?._id || "anon"} role=${role} locale=${locale}`,
        `\n  lastUserText="${lastUserText.slice(0, 120)}"`,
        `\n  vehicle=${effectiveVehicleContext ? `${effectiveVehicleContext.manufacturer} ${effectiveVehicleContext.model}` : "(none)"}`,
        `\n  err.name=${llmErr?.name} err.message=${llmErr?.message}`,
        `\n  stack:\n${llmErr?.stack || "(no stack)"}`,
      );

      const expandedQuery = translitResult.hasHits
        ? translitResult.expandedQuery
        : lastUserText;
      // Phase AK: even on the degraded LLM-down path we apply price
      // intent + ranking so "хямд тоормос" still sorts cheapest-first.
      const degradedIntent = parsePriceIntent(lastUserText);
      const raw = await runScopedProductSearch({
        query: expandedQuery, limit: 5, intent: degradedIntent,
      }, scope).catch((searchErr) => {
        console.error(`[ai.controller][${requestId}] keyword fallback ALSO failed:`, searchErr.message);
        return [];
      });
      const ranked = rankProducts(raw, {
        query: expandedQuery,
        vehicleContext: effectiveVehicleContext,
        intent: degradedIntent,
      });
      const items = sanitizeProducts(ranked.slice(0, 5), scope);
      // Phase AL: bundle suggestions still ship even when the LLM is
      // down — the keyword search + related-categories map are both
      // deterministic. Adds ~1 extra Mongo round-trip.
      const relatedRaw = ranked[0]
        ? await findRelatedProducts(ranked[0], scope, 3).catch(() => [])
        : [];
      const related = sanitizeProducts(relatedRaw, scope);
      await cleanupUploadedAsset(req);

      // Phase AJ+: word-friendly degraded copy. Only mention "AI" + ref
      // code in the EMPTY case so a debugger can grep logs; the populated
      // case leads with the catalogue result (which is what the user
      // actually wanted). The "(код)" parenthetical is intentionally
      // small / subtle so it doesn't dominate the bubble.
      const degradedReply = items.length === 0
        ? (locale === "en"
            ? `Couldn't find "${lastUserText}" in the catalogue right now. Try the OEM code, license plate, or a synonym (e.g. "brake pad"). (ref ${requestId})`
            : `"${lastUserText}" — каталогаас одоохондоо олдсонгүй. OEM код, машины дугаар, эсвэл өөр нэр (жнь "наклад", "амортизатор") туршаад үзнэ үү. (код ${requestId})`)
        : (locale === "en"
            ? `Found ${items.length} parts matching "${lastUserText}". Tap one to see details.`
            : `"${lastUserText}" — ${items.length} тааруу олдлоо. Дэлгэрэнгүйг харахын тулд нэгэн дээр дарна уу.`);

      return res.json(buildEnvelope({
        replyText: degradedReply,
        // Phase AL: pass `related` through the same tool-call envelope
        // that the LLM-driven path uses, so the frontend renders the
        // "Хамт ихэвчлэн авдаг" strip identically in both modes.
        toolCalls: [{
          name: "search_products",
          result: { items, related, count: items.length, query: expandedQuery },
        }],
        role,
        // Phase AJ+: don't surface a confidence chip on the degraded
        // path. The keyword search is deterministic — the "AI is unsure"
        // ConfidenceBadge would mislead the user into thinking the model
        // ran and was uncertain. `null` tells the frontend renderer to
        // skip the badge entirely (Phase H code path).
        confidence: null,
        diagnostics: {
          route: "degraded-fallback",
          model: "keyword-search",
          requestId,
          llmErrName:    llmErr?.name || null,
          llmErrMessage: (llmErr?.message || "").slice(0, 200),
        },
      }));
    }

    // ── Memory write-back: pick up signals from tool calls ────────
    // search_products → push to recentSearches
    // search_vehicle_parts → push to recentSearches + vehicleId
    // identify_part_from_image / cross_reference_oem → push surfaced items
    if (req.user?._id) {
      for (const tc of toolCalls) {
        const r = tc.result;
        if (!r || r.error) continue;
        if (tc.name === "search_products" || tc.name === "search_vehicle_parts") {
          aiMemory.pushRecentSearch(req.user._id, {
            query:       r.query || lastUserText,
            category:    r.category || r.plan?.category || "",
            resultCount: r.count || 0,
            vehicleId:   effectiveVehicleContext?.id || null,
          }).catch(() => {});
        }
        // Stash up to 3 product references from any tool that produced items.
        const items = Array.isArray(r.items) ? r.items.slice(0, 3) : [];
        for (const p of items) {
          if (!p?.id) continue;
          aiMemory.pushRecentProduct(req.user._id, {
            productId: p.id, name: p.name, oem: p.oem,
          }).catch(() => {});
        }
      }
    }

    // ── Assemble the structured envelope ──────────────────────────
    // Phase H: surface reflection results to the frontend as
    //   • confidence (0..100 — int for readability)
    //   • escalation block (or null) — frontend renders prominent banner
    const confidencePct = reflection ? Math.round(reflection.confidence * 100) : null;
    const escalation = reflection?.shouldEscalate
      ? buildEscalation(reflection.escalationReason || "low_confidence", locale)
      : null;

    return res.json(buildEnvelope({
      replyText: reply,
      toolCalls,
      role,
      confidence: confidencePct,
      escalation,
      diagnostics: {
        route: profile === aiConfig.vision ? "vision" : "text",
        model: profile.model,
        provider: profile.label,
        // Phase M.1: provider that actually answered (may differ from
        // `provider` when we fell back), and the per-attempt breakdown
        // for ops dashboards.
        usedProvider,
        fallbackAttempts,
        totalTokens,
        usage,
        terminateReason: terminate.reason,
        toolCallCount: toolCalls.length,
        // Phase H — surface reflection internals for ops dashboards.
        reflection: reflection ? {
          confidence: reflection.confidence,
          band: confidenceBand(reflection.confidence),
          escalationReason: reflection.escalationReason,
        } : null,
        translit: translitResult.hasHits ? {
          hits: translitResult.hits.map((h) => ({ surface: h.surface, mn: h.mn, en: h.en })),
          expandedQuery: translitResult.expandedQuery,
          bestCategory: translitResult.bestCategory,
        } : null,
      },
    }));
  } catch (err) {
    const mapped = mapUpstreamError(err);
    if (mapped) {
      const headers = mapped.status === 429 && mapped.body.retryAfter
        ? { "Retry-After": String(mapped.body.retryAfter) } : {};
      // Phase AB: attach requestId so a rate-limit / payload-too-large
      // is traceable end-to-end.
      return respondWithError(req, res, mapped.status, { ...mapped.body, requestId }, headers);
    }
    // Truly unhandled — everything that ISN'T a runConversation crash
    // (those are caught above and degraded). Log full context.
    console.error(
      `[ai.controller][${requestId}] unhandled exception in handleAIRequest:`,
      `\n  err.name=${err?.name} err.code=${err?.code} err.status=${err?.status}`,
      `\n  err.message=${err?.message}`,
      `\n  stack:\n${err?.stack || "(no stack)"}`,
    );
    return respondWithError(req, res, 500, {
      code: "AI_INTERNAL_ERROR",
      message: "Unexpected error while processing AI request.",
      requestId,
    });
  }
};

/** @deprecated use handleAIRequest */
export const chat = handleAIRequest;

// ────────────────────────────────────────────────────────────────────
// Phase G — Memory REST handlers
//
// These bypass the LLM entirely. The chat widget calls them directly
// to power the header switcher UI (recent vehicles dropdown, manual
// plate input, "switch / clear vehicle" buttons) without paying a
// Groq round-trip for purely UI-driven state changes.
//
// Auth is required upstream (Routes/ai.route.js). Anonymous users
// don't have memory; their vehicle is local-only (Zustand persist).
// ────────────────────────────────────────────────────────────────────

/** GET /api/ai/memory — return the current user's full memory shape. */
export const handleMemoryGet = async (req, res) => {
  try {
    const memory = await aiMemory.loadMemory(req.user._id);
    return res.json({ memory });
  } catch (err) {
    console.error("[ai.memory] get failed:", err.message);
    return res.status(500).json({ code: "INTERNAL_ERROR", message: "Дотоод алдаа" });
  }
};

/**
 * POST /api/ai/memory/active-vehicle
 *   body: { plate?: string }  OR  { vehicleId?: string }
 *
 * Two paths:
 *   • { plate } — look up via Garage.mn (cache-first), persist
 *                 vehicle, set as active.
 *   • { vehicleId } — switch to an already-known vehicle (e.g. one
 *                     the user picked from their recentVehicles list).
 *
 * Returns the updated memory shape so the frontend can re-render the
 * dropdown without a separate GET round-trip.
 */
export const handleSetActiveVehicle = async (req, res) => {
  try {
    const { plate, vehicleId } = req.body || {};
    if (!plate && !vehicleId) {
      return res.status(400).json({
        code: "MISSING_INPUT", message: "plate эсвэл vehicleId шаардлагатай",
      });
    }

    let vehicle = null;
    if (vehicleId) {
      vehicle = await Vehicle.findById(vehicleId).lean();
      if (!vehicle) {
        return res.status(404).json({ code: "NOT_FOUND", message: "Машин олдсонгүй" });
      }
    } else {
      // Plate path — validate format, cache-check, fall through to
      // Garage.mn lookup + persist.
      if (!isPlateValid(plate)) {
        return res.status(400).json({
          code: "PLATE_INVALID",
          message: "Дугаар буруу — 4 тоо + 3 кирилл үсэг (1234УБА)",
        });
      }
      const norm = garageNormalizePlate(plate);
      vehicle = await Vehicle.findOne({ plate: norm }).lean();
      if (!vehicle) {
        try {
          const lookup = await fetchByPlate(norm);
          const persisted = await normalizeAndPersist(lookup, { userId: req.user._id });
          vehicle = persisted.vehicle;
        } catch (e) {
          return res.status(404).json({
            code: "PLATE_LOOKUP_FAILED",
            message: `Дугаар олдсонгүй: ${e.message}`,
          });
        }
      }
    }

    const payload = {
      vehicleId:    String(vehicle._id),
      plate:        vehicle.plate,
      manufacturer: vehicle.snapshot?.manuname  || "",
      model:        vehicle.snapshot?.modelname || "",
      generation:   vehicle.snapshot?.generation || "",
    };
    await aiMemory.setActiveVehicle(req.user._id, payload);
    const memory = await aiMemory.loadMemory(req.user._id);
    return res.json({
      vehicle: {
        ...payload,
        // Phase AE: surface motorcode + displacement + carname so
        // /garage save-recent can pre-fill engine field with the
        // proper engine model code ("2GR-FSE") instead of treating
        // engineType as engine name.
        engineCode:   vehicle.snapshot?.motorcode || "",
        engineType:   vehicle.snapshot?.motortype || "",
        displacement: vehicle.snapshot?.displacement || "",
        carname:      vehicle.snapshot?.carname || "",
      },
      memory,
    });
  } catch (err) {
    console.error("[ai.memory] set active failed:", err.stack || err.message);
    return res.status(500).json({ code: "INTERNAL_ERROR", message: "Дотоод алдаа" });
  }
};

/** DELETE /api/ai/memory/active-vehicle — clear active without touching history. */
export const handleClearActiveVehicle = async (req, res) => {
  try {
    await aiMemory.clearActiveVehicle(req.user._id);
    const memory = await aiMemory.loadMemory(req.user._id);
    return res.json({ memory });
  } catch (err) {
    console.error("[ai.memory] clear active failed:", err.message);
    return res.status(500).json({ code: "INTERNAL_ERROR", message: "Дотоод алдаа" });
  }
};

// Test/diagnostic exports — not on the public route surface.
export const __internal = Object.freeze({
  TOOLS, TOOL_HANDLERS, LIMITS, BASE_LIMITS, ROLE_MULT, limitsForRole,
  cleanupUploadedAsset, validateUserIntent,
  callSignature, mapUpstreamError, runScopedProductSearch,
});
