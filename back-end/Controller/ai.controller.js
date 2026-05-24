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

/** Lightweight inline product search — scope-aware. */
const runScopedProductSearch = async ({ query, category, limit = 5 }, scope) => {
  const base = scopeFilter(scope);
  const filter = { ...base };
  if (category) filter.category = category;
  if (query) {
    const rx = new RegExp(String(query).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [{ name: rx }, { oem: rx }, { brand: rx }, { tags: rx }];
  }
  return Product.find(filter).limit(Math.max(1, Math.min(20, limit))).lean();
};

const TOOL_HANDLERS = {
  async search_products(args, runtime) {
    const { query, category, limit = 5 } = args;
    const { scope, user } = runtime;

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

    const raw = await runScopedProductSearch({
      query: finalQuery, category: finalCategory, limit,
    }, scope);

    const items = sanitizeProducts(raw, scope);
    logSearch({
      query, expandedQuery: finalQuery, category: finalCategory,
      resultCount: items.length, source: "ai", user: user?._id,
    }).catch(() => {});

    return {
      query: finalQuery,
      category: finalCategory,
      count: items.length,
      items,
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
    return {
      vehicleId:    String(vehicle._id),
      plate:        vehicle.plate,
      manufacturer: vehicle.snapshot?.manuname  || "",
      model:        vehicle.snapshot?.modelname || "",
      generation:   vehicle.snapshot?.generation || "",
      engineCode:   vehicle.snapshot?.motorcode  || "",
      engineType:   vehicle.snapshot?.motortype  || "",
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
      engineCode: vehicle.snapshot?.motorcode || "",
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
// Tool-loop limits (unchanged)
// ────────────────────────────────────────────────────────────────────
const num = (v, d) => {
  const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d;
};
const LIMITS = Object.freeze({
  maxRounds:       num(process.env.AI_MAX_TOOL_ROUNDS,   3),
  maxToolCalls:    num(process.env.AI_MAX_TOOL_CALLS,    6),
  maxTotalTokens:  num(process.env.AI_MAX_TOTAL_TOKENS,  8000),
  walltimeMs:      num(process.env.AI_WALLTIME_MS,       25_000),
  maxOutputTokens: num(process.env.AI_MAX_OUTPUT_TOKENS, 1024),
});

const callSignature = (tc) =>
  `${tc.function?.name || "?"}:${tc.function?.arguments || ""}`;

// ────────────────────────────────────────────────────────────────────
// Conversation engine — passes the runtime context (incl. scope) to
// every tool handler.
// ────────────────────────────────────────────────────────────────────
const runConversation = async ({ profile, messages, runtime, transliterationHint }) => {
  const { scope, locale, vehicleContext } = runtime;

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
    LIMITS.walltimeMs,
  );

  const toolCalls = [];
  const seenSignatures = new Set();
  let lastMessage = null;
  let lastUsage = null;
  let totalTokens = 0;
  let terminate = { reason: "model_finished" };

  try {
    for (let round = 0; round < LIMITS.maxRounds; round++) {
      if (totalTokens >= LIMITS.maxTotalTokens)  { terminate = { reason: "token_budget", totalTokens }; break; }
      if (toolCalls.length >= LIMITS.maxToolCalls){ terminate = { reason: "tool_call_cap", toolCalls: toolCalls.length }; break; }
      if (ac.signal.aborted)                      { terminate = { reason: "walltime" }; break; }

      const body = {
        model: profile.model,
        messages: conversation,
        temperature: 0.3,
        max_tokens: LIMITS.maxOutputTokens,
      };
      if (availableTools && availableTools.length > 0) {
        body.tools = availableTools;
        body.tool_choice = "auto";
      }

      const resp = await profile.client.chat.completions.create(body, { signal: ac.signal });
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
        if (toolCalls.length >= LIMITS.maxToolCalls) {
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
      const roundsRemaining = LIMITS.maxRounds - (round + 1);
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
  };
};

// ────────────────────────────────────────────────────────────────────
// Upstream error mapper (unchanged from prior hardened controller)
// ────────────────────────────────────────────────────────────────────
const mapUpstreamError = (err) => {
  const upstream = Number(err?.status || err?.response?.status || 0);
  if (upstream === 401 || upstream === 403) return { status: 503, body: { code: "AI_AUTH_FAILED", message: "AI provider rejected credentials." } };
  if (upstream === 429) return { status: 429, body: { code: "AI_RATE_LIMITED", message: "AI provider is rate-limiting.", retryAfter: Number(err?.headers?.["retry-after"]) || 30 } };
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

    // ── No AI provider — fall back to keyword search (USER role) ──
    if (!isAiEnabled()) {
      if (hasImage) {
        return respondWithError(req, res, 400, {
          code: "AI_DISABLED_FOR_IMAGE",
          message: locale === "en"
            ? "Image analysis requires an AI provider. Please type the part name instead."
            : "Зургийн шинжилгээ AI provider шаардлагатай. Сэлбэгийн нэрийг бичээд хайна уу.",
        });
      }
      const raw = await runScopedProductSearch({ query: lastUserText, limit: 5 }, scope);
      const items = sanitizeProducts(raw, scope);
      await cleanupUploadedAsset(req);
      return res.json(buildEnvelope({
        replyText: items.length === 0
          ? (locale === "en" ? "No results — try a different keyword." : "Олдсонгүй. Өөр түлхүүр үг туршаад үзнэ үү.")
          : (locale === "en" ? `${items.length} parts found.` : `${items.length} сэлбэг олдлоо.`),
        toolCalls: [{ name: "search_products", result: { items, count: items.length } }],
        role,
        diagnostics: { route: "fallback", model: "keyword-search" },
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

    // ── Latin-Mongolian transliteration hint (pre-LLM) ────────────
    const translitResult = transliterate(lastUserText);
    const transliterationHint = formatHint(translitResult, locale);

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
    const enrichedTranslitHint = [transliterationHint, memoryHint, plateNudge, vehicleNudge, symptomNudge]
      .filter(Boolean).join("\n\n");

    // ── Run the bounded conversation ──────────────────────────────
    const runtime = {
      user: req.user, role, scope, locale, memory,
      vehicleContext: effectiveVehicleContext,
    };
    const { reply, toolCalls, usage, totalTokens, terminate, reflection } =
      await runConversation({ profile, messages, runtime, transliterationHint: enrichedTranslitHint });

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
      return respondWithError(req, res, mapped.status, mapped.body, headers);
    }
    console.error("[ai.controller] unhandled:", err.stack || err.message);
    return respondWithError(req, res, 500, {
      code: "AI_INTERNAL_ERROR",
      message: "Unexpected error while processing AI request.",
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
        engineCode: vehicle.snapshot?.motorcode || "",
        engineType: vehicle.snapshot?.motortype || "",
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
  TOOLS, TOOL_HANDLERS, LIMITS,
  cleanupUploadedAsset, validateUserIntent,
  callSignature, mapUpstreamError, runScopedProductSearch,
});
