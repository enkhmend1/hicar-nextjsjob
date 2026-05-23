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
      description: "ADMIN. Aggregate revenue/orders/AOV for today|week|month|all.",
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

    // Belt-and-suspenders Latin→Mongolian deterministic dictionary pass.
    const translit = transliterate(query);
    const seedQuery = translit.hasHits ? translit.expandedQuery : query;
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
    if (runtime.scope.role !== "admin") return { error: "Admin only" };
    const now = new Date();
    let since = null;
    if      (period === "today") { since = new Date(now); since.setHours(0, 0, 0, 0); }
    else if (period === "week")  { since = new Date(now); since.setDate(now.getDate() - 7); }
    else if (period === "month") { since = new Date(now); since.setMonth(now.getMonth() - 1); }

    const filter = { status: { $in: ["paid", "processing", "shipped", "delivered"] } };
    if (since) filter.createdAt = { $gte: since };
    const orders = await Order.find(filter).lean();
    const total = orders.reduce((s, o) => s + (o.total || 0), 0);
    return {
      kind: "kpi_grid",
      title: `Sales — ${period}`,
      data: {
        period,
        orderCount: orders.length,
        revenue: total,
        avgOrder: orders.length ? Math.round(total / orders.length) : 0,
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
      if (terminate.reason !== "model_finished") break;
    }
  } finally {
    clearTimeout(walltimeTimer);
  }

  return {
    reply: lastMessage?.content || "",
    toolCalls,
    usage: lastUsage,
    totalTokens,
    terminate,
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

    // ── Wrong-persona command short-circuit ───────────────────────
    // (e.g. anonymous user typing "today's sales" — answer locally and
    // never invoke the LLM.)
    const lastUserText = [...messages].reverse().find((m) => m.role === "user")?.content || "";
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

    // ── Run the bounded conversation ──────────────────────────────
    const runtime = { user: req.user, role, scope, vehicleContext, locale };
    const { reply, toolCalls, usage, totalTokens, terminate } =
      await runConversation({ profile, messages, runtime, transliterationHint });

    // ── Assemble the structured envelope ──────────────────────────
    return res.json(buildEnvelope({
      replyText: reply,
      toolCalls,
      role,
      diagnostics: {
        route: profile === aiConfig.vision ? "vision" : "text",
        model: profile.model,
        provider: profile.label,
        totalTokens,
        usage,
        terminateReason: terminate.reason,
        toolCallCount: toolCalls.length,
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

// Test/diagnostic exports — not on the public route surface.
export const __internal = Object.freeze({
  TOOLS, TOOL_HANDLERS, LIMITS,
  cleanupUploadedAsset, validateUserIntent,
  callSignature, mapUpstreamError, runScopedProductSearch,
});
