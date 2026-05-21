/**
 * Smart Hybrid AI Router — Controller Layer (HARDENED)
 *
 *   POST /api/ai/chat
 *     ├─ multipart/form-data + `file` upload  → routed to visionClient (Gemini)
 *     └─ JSON only                            → routed to fastTextClient (Groq)
 *
 * Defensive layers (in order of execution):
 *
 *   ① Cleanup contract — every non-2xx response path goes through
 *      respondWithError(), which deletes any already-uploaded Cloudinary
 *      asset before sending. Closes the orphan-asset DoS where a bad
 *      request triggers a successful upload that nobody reads.
 *
 *   ② Input validation — empty / whitespace-only text requests are
 *      rejected at the door (no expensive LLM call for "x" or "??"). Image
 *      requests are exempt: the image alone justifies invocation.
 *
 *   ③ Tool-loop hardening — concurrent guards on rounds, total tool calls,
 *      cumulative tokens, duplicate signatures, wall-clock time, and
 *      per-call output cap. Any guard fires → break gracefully and return
 *      the best message we have so far.
 *
 *   ④ Upstream error mapping — SDK status → stable HTTP contracts (401→503
 *      operator-fixable, 429→429+Retry-After, 5xx→502, timeout→502).
 *      Only genuinely-unhandled exceptions reach 500.
 */

import fs from "fs/promises";
import { aiConfig, isAiEnabled } from "../Config/openai.js";
import { cloudinary, cloudinaryEnabled } from "../Config/cloudinary.js";
import Product from "../Model/product.model.js";
import Order from "../Model/order.model.js";
import { logSearch, expandQueryWithMappings } from "../Service/oem.service.js";
import {
  transliterate,
  formatHint,
  TRANSLIT_INSTRUCTION_EN,
  TRANSLIT_INSTRUCTION_MN,
} from "../Service/latinMongolian.service.js";

// ────────────────────────────────────────────────────────────────────
// Tool definitions exposed to the LLM
// ────────────────────────────────────────────────────────────────────
const TOOLS = [
  {
    type: "function",
    function: {
      name: "search_products",
      description:
        "Search the auto-parts catalogue. Use this whenever the user mentions car parts, OEM codes, brands, or vehicle models. " +
        "Understands Mongolian automotive slang (тоормос=brake, фар/гэрэл=lighting, амортизатор=suspension, мотор/хөдөлгүүр=engine, наклад=brake pad, бампер=bumper).",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Free-form search keywords or OEM code" },
          category: {
            type: "string",
            enum: ["brake", "engine", "lighting", "suspension", "electric", "body", "transmission", "other"],
            description: "Optional category filter",
          },
          limit: { type: "integer", description: "Max number of results (1-20)", default: 5 },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "identify_part_from_image",
      description:
        "Use this when the user uploaded an image and is asking what part it is. " +
        "Analyze the image, return your best guess of (a) category, (b) likely Japanese/Korean OEM keywords, and (c) part name in English. " +
        "After identifying, call search_products with the keywords.",
      parameters: {
        type: "object",
        properties: {
          guessName: { type: "string", description: "Best-guess part name in English" },
          category: {
            type: "string",
            enum: ["brake", "engine", "lighting", "suspension", "electric", "body", "transmission", "other"],
          },
          keywords: { type: "string", description: "Search keywords (3-6 words)" },
          confidence: { type: "string", enum: ["low", "medium", "high"] },
        },
        required: ["guessName", "category", "keywords"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_low_stock",
      description: "ADMIN ONLY. Returns products running low on stock (qty <= threshold) or marked out-of-stock.",
      parameters: {
        type: "object",
        properties: {
          threshold: { type: "integer", description: "Stock threshold (default 5)", default: 5 },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_sales_summary",
      description: "ADMIN ONLY. Returns aggregate sales for a time range.",
      parameters: {
        type: "object",
        properties: {
          period: { type: "string", enum: ["today", "week", "month", "all"] },
        },
      },
    },
  },
];

// ────────────────────────────────────────────────────────────────────
// Internal: raw search + tool handlers + keyword fallback
// ────────────────────────────────────────────────────────────────────
const runProductSearch = async ({ query, category, limit = 5 }) => {
  const filter = { status: "approved" };
  if (category) filter.category = category;
  if (query) {
    const rx = new RegExp(String(query).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [{ name: rx }, { oem: rx }, { brand: rx }];
  }
  const items = await Product.find(filter).limit(Math.max(1, Math.min(20, limit)));
  return items.map((p) => ({
    id: String(p._id),
    name: p.name,
    oem: p.oem,
    brand: p.brand,
    price: p.price,
    stockQty: p.stockQty,
    inStock: p.inStock,
  }));
};

const TOOL_HANDLERS = {
  async search_products(args, user) {
    const { query, category, limit = 5 } = args;

    // Belt-and-suspenders: even though the system prompt instructs the
    // LLM to transliterate Latin-Mongolian before calling this tool, a
    // weaker model may still pass the raw Latin form through. Run the
    // deterministic dictionary FIRST and merge its expansion into the
    // query so the catalogue search has both the Cyrillic + English
    // form available. Costs ~0ms; pure in-memory lookup.
    const translit = transliterate(query);
    const seedQuery = translit.hasHits ? translit.expandedQuery : query;
    const seedCategory = category || translit.bestCategory;

    const expanded = await expandQueryWithMappings(seedQuery);
    const finalCategory = seedCategory || expanded.category;
    const finalQuery = expanded.query;
    const items = await runProductSearch({ query: finalQuery, category: finalCategory, limit });
    logSearch({
      query, expandedQuery: finalQuery, category: finalCategory,
      resultCount: items.length, source: "ai", user: user?._id,
    }).catch(() => {});
    return {
      query: finalQuery, category: finalCategory, count: items.length, items,
      // Surface the transliteration step so the LLM (and any downstream
      // logging) can see what we mapped. Empty when no Latin hits.
      transliterated: translit.hasHits ? translit.hits.map((h) => ({ surface: h.surface, mn: h.mn, en: h.en })) : [],
    };
  },

  async identify_part_from_image(args, user) {
    const { keywords, category, guessName, confidence } = args;
    const items = await runProductSearch({ query: keywords, category, limit: 6 });
    logSearch({
      query: keywords, expandedQuery: keywords, category,
      resultCount: items.length, source: "image", user: user?._id,
    }).catch(() => {});
    return { guessName, category, keywords, confidence, count: items.length, items };
  },

  async get_low_stock({ threshold = 5 }, user) {
    if (user?.role !== "admin") return { error: "Admin only" };
    const items = await Product.find({
      $or: [{ stockQty: { $lte: threshold } }, { inStock: false }],
    }).limit(20);
    return {
      threshold,
      count: items.length,
      items: items.map((p) => ({
        id: String(p._id), name: p.name, oem: p.oem,
        stockQty: p.stockQty, inStock: p.inStock,
      })),
    };
  },

  async get_sales_summary({ period = "today" }, user) {
    if (user?.role !== "admin") return { error: "Admin only" };
    const now = new Date();
    let since = null;
    if      (period === "today") { since = new Date(now); since.setHours(0, 0, 0, 0); }
    else if (period === "week")  { since = new Date(now); since.setDate(now.getDate() - 7); }
    else if (period === "month") { since = new Date(now); since.setMonth(now.getMonth() - 1); }

    const filter = { status: { $in: ["paid", "processing", "shipped", "delivered"] } };
    if (since) filter.createdAt = { $gte: since };
    const orders = await Order.find(filter);
    const total = orders.reduce((s, o) => s + o.total, 0);
    return {
      period,
      orderCount: orders.length,
      revenue: total,
      avgOrder: orders.length ? Math.round(total / orders.length) : 0,
    };
  },
};

/** No-AI fallback — runs a keyword search expanded with OEM mappings. */
const fallbackSearch = async (text, user) => {
  const expanded = await expandQueryWithMappings(text);
  const finalQuery = expanded.query || text;
  const items = await runProductSearch({ query: finalQuery, category: expanded.category, limit: 5 });
  logSearch({
    query: text, expandedQuery: finalQuery, category: expanded.category,
    resultCount: items.length, source: "ai", user: user?._id,
  }).catch(() => {});
  return { query: finalQuery, category: expanded.category, count: items.length, items };
};

// ────────────────────────────────────────────────────────────────────
// ① Asset cleanup — close the orphan-upload DoS
// ────────────────────────────────────────────────────────────────────

/**
 * Delete the asset that multer uploaded, if any. Idempotent (sets
 * req.file = null after the first call so retries are no-ops). Never
 * throws — failure is logged and swallowed because cleanup happens on
 * the response path and shouldn't mask the real status code.
 *
 * Branches:
 *   - cloudinaryEnabled + req.file.filename (public_id provided by
 *     multer-storage-cloudinary) → cloudinary.uploader.destroy
 *   - local storage + req.file.path on disk → fs.unlink
 */
const cleanupUploadedAsset = async (req) => {
  const file = req?.file;
  if (!file) return;
  req.file = null; // idempotency guard

  try {
    if (cloudinaryEnabled && file.filename) {
      // multer-storage-cloudinary populates `filename` with the public_id.
      await cloudinary.uploader.destroy(file.filename, { invalidate: true });
    } else if (file.path && !/^https?:/i.test(file.path)) {
      // Local disk fallback.
      await fs.unlink(file.path);
    }
  } catch (err) {
    console.warn(`[ai.controller] asset cleanup failed: ${err.message}`);
  }
};

/**
 * Centralised non-2xx exit. Every 4xx/5xx response goes through here so
 * the orphan-asset cleanup is guaranteed — no rogue early `return
 * res.status(...).json(...)` can skip it.
 *
 * Optional `headers` are set BEFORE sending (e.g. Retry-After for 429).
 */
const respondWithError = async (req, res, status, body, headers = {}) => {
  await cleanupUploadedAsset(req);
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  return res.status(status).json(body);
};

// ────────────────────────────────────────────────────────────────────
// ② Input validation + normalisation
// ────────────────────────────────────────────────────────────────────

/**
 * Validate that the latest user content carries enough signal to justify
 * an expensive LLM call. Image presence overrides the text-length minimum
 * — a photo alone is meaningful.
 *
 * Returns { ok: true } or { ok: false, code, message }.
 */
const MIN_TEXT_CHARS = 3;

const validateUserIntent = ({ messages, imageUrl, locale }) => {
  if (imageUrl) return { ok: true }; // image carries intent on its own

  const last = [...messages].reverse().find((m) => m && m.role === "user");
  const text = String(last?.content || "").trim();

  // Strip non-letters/digits to catch "??" or "..." or single punctuation.
  // We keep Cyrillic + Latin + digits — the marketplace operates in mn/en.
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

/**
 * Convert request body (multipart or JSON) into the internal shape:
 *   { messages: [{ role, content, imageUrl? }], imageUrl, locale }
 */
const normaliseRequest = (req) => {
  const locale = String(req.body?.locale || "mn") === "en" ? "en" : "mn";

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
        locale,
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
  return { data: { locale, imageUrl, messages } };
};

/**
 * Vanilla OpenAI-compatible message shape — same on OpenAI, Gemini-compat,
 * Ollama-llava. No provider-specific branching.
 */
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
// ③ Tool-loop hard limits
// ────────────────────────────────────────────────────────────────────

/**
 * Tunable safety envelope for ONE chat invocation. Defaults are sized so
 * a single legitimate "find me brake pads for X" conversation fits
 * comfortably, but a runaway / adversarial conversation is bounded.
 *
 * Override via env to react to incidents without a deploy:
 *   AI_MAX_TOOL_ROUNDS, AI_MAX_TOOL_CALLS, AI_MAX_TOTAL_TOKENS,
 *   AI_WALLTIME_MS,     AI_MAX_OUTPUT_TOKENS
 */
const num = (v, d) => {
  const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d;
};
const LIMITS = Object.freeze({
  maxRounds:        num(process.env.AI_MAX_TOOL_ROUNDS,   3),
  maxToolCalls:     num(process.env.AI_MAX_TOOL_CALLS,    6),
  maxTotalTokens:   num(process.env.AI_MAX_TOTAL_TOKENS,  8000),
  walltimeMs:       num(process.env.AI_WALLTIME_MS,       25_000),
  maxOutputTokens:  num(process.env.AI_MAX_OUTPUT_TOKENS, 1024),
});

const callSignature = (tc) =>
  `${tc.function?.name || "?"}:${tc.function?.arguments || ""}`;

/**
 * System-prompt builder.
 *
 *   ① The core persona (HiCar AI, admin-aware, locale-aware).
 *   ② TRANSLIT_INSTRUCTION_* — the GENERAL rule the model learns so it
 *      can handle Latin-Mongolian variants we haven't catalogued.
 *   ③ transliterationHint — the per-request, deterministic dictionary
 *      match (rendered by latinMongolian.formatHint). When the user's
 *      input touches a known term, this gives the LLM the EXACT mapping
 *      so it doesn't have to guess.
 *
 * The execution architecture (tool loop, AbortController, max_tokens,
 * etc.) is unchanged — this just shapes what the model SEES at round 0.
 */
const buildSystemPrompt = ({ locale, isAdmin, transliterationHint = "" }) => {
  const core = locale === "en"
    ? `You are HiCar AI — a friendly assistant for an auto-parts marketplace.
${isAdmin ? "You are speaking to an ADMIN — admin tools are available." : "You are speaking to a regular customer."}
Reply concisely in English. When the user asks about parts, call search_products. When they upload an image, call identify_part_from_image first.`
    : `Та HiCar AI туслах — автомашины сэлбэгийн платформын туслах.
${isAdmin ? "Та ADMIN-тай ярьж байна — admin tool ашиглаж болно." : "Та энгийн хэрэглэгчтэй ярьж байна."}
Богино, ойлгомжтой Монголоор хариул. Сэлбэгийн талаар асуувал search_products дуудна. Зураг илгээсэн бол эхлээд identify_part_from_image дууд.
Монгол slang: тоормос=brake, фар/гэрэл=lighting, амортизатор=suspension, хөдөлгүүр/мотор=engine, наклад=brake pad, бампер=bumper.`;

  const translit = locale === "en" ? TRANSLIT_INSTRUCTION_EN : TRANSLIT_INSTRUCTION_MN;

  // Per-request hint is appended LAST so it's the freshest context the
  // model sees before the user's actual turn.
  return [core, translit, transliterationHint].filter(Boolean).join("\n");
};

/**
 * Conversation engine. Returns the final assistant reply plus every tool
 * call observed and the resource counters at exit.
 *
 * Guards (any one trips the loop exit):
 *   • maxRounds            — at most N back-and-forth turns
 *   • maxToolCalls         — at most N tool invocations TOTAL
 *   • maxTotalTokens       — sum of usage.total_tokens across rounds
 *   • walltimeMs           — wall-clock budget covering ALL SDK calls
 *   • duplicate signature  — same tool name + same args twice → exit
 *
 * `terminate.reason` exposes which guard fired (useful for ops dashboards).
 */
const runConversation = async ({ profile, messages, user, locale, transliterationHint }) => {
  const isAdmin = user?.role === "admin";
  const availableTools = !profile.supportsTools ? undefined
    : isAdmin ? TOOLS
    : TOOLS.filter((t) => !["get_low_stock", "get_sales_summary"].includes(t.function.name));

  const conversation = [
    { role: "system", content: buildSystemPrompt({ locale, isAdmin, transliterationHint }) },
    ...messages.map(toCompletionMessage),
  ];

  // Shared abort signal — caps wall-clock for the WHOLE conversation,
  // including all SDK calls and tool executions inside it.
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
      // Budget checks BEFORE the call so we never spend past the cap.
      if (totalTokens >= LIMITS.maxTotalTokens) {
        terminate = { reason: "token_budget", totalTokens };
        break;
      }
      if (toolCalls.length >= LIMITS.maxToolCalls) {
        terminate = { reason: "tool_call_cap", toolCalls: toolCalls.length };
        break;
      }
      if (ac.signal.aborted) {
        terminate = { reason: "walltime" };
        break;
      }

      const requestBody = {
        model: profile.model,
        messages: conversation,
        temperature: 0.3,
        max_tokens: LIMITS.maxOutputTokens,
      };
      if (availableTools && availableTools.length > 0) {
        requestBody.tools = availableTools;
        requestBody.tool_choice = "auto";
      }

      const resp = await profile.client.chat.completions.create(
        requestBody,
        { signal: ac.signal },
      );
      lastMessage = resp.choices?.[0]?.message;
      lastUsage = resp.usage;
      totalTokens += Number(resp.usage?.total_tokens || 0);

      // No tools requested → model is done.
      if (!lastMessage?.tool_calls || lastMessage.tool_calls.length === 0) {
        break;
      }

      // Duplicate-call detector — the canonical infinite-loop / prompt-
      // injection vector is the model asking for the same tool with the
      // same arguments forever. We allow it ONCE; second time → exit
      // with whatever assistant text we already have.
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
        const handler = TOOL_HANDLERS[tc.function?.name];
        let result;
        if (!handler) {
          result = { error: `Unknown tool: ${tc.function?.name}` };
        } else {
          try {
            const args = JSON.parse(tc.function.arguments || "{}");
            result = await handler(args, user);
          } catch (e) {
            result = { error: e.message };
          }
        }
        toolCalls.push({ name: tc.function?.name, result });
        conversation.push({
          role: "tool",
          tool_call_id: tc.id,
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
// Error mapping — turn SDK / network errors into stable HTTP statuses
// ────────────────────────────────────────────────────────────────────
const mapUpstreamError = (err) => {
  const upstream = Number(err?.status || err?.response?.status || 0);

  if (upstream === 401 || upstream === 403) {
    return { status: 503, body: { code: "AI_AUTH_FAILED",
      message: "AI provider rejected credentials. Operator must verify API keys." } };
  }
  if (upstream === 429) {
    return { status: 429, body: { code: "AI_RATE_LIMITED",
      message: "AI provider is rate-limiting. Please retry shortly.",
      retryAfter: Number(err?.headers?.["retry-after"]) || 30 } };
  }
  if (upstream === 400 || upstream === 422) {
    return { status: 400, body: { code: "AI_BAD_REQUEST",
      message: err?.message || "AI provider rejected the request shape." } };
  }
  if (upstream >= 500 && upstream < 600) {
    return { status: 502, body: { code: "AI_UPSTREAM_ERROR",
      message: "AI provider had an internal error. Please retry." } };
  }
  if (err?.code === "ETIMEDOUT" || err?.code === "ECONNREFUSED"
      || err?.name === "AbortError" || err?.message === "walltime_exceeded") {
    return { status: 502, body: { code: "AI_UPSTREAM_UNREACHABLE",
      message: "AI provider unreachable or response exceeded time budget." } };
  }
  return null;
};

// ────────────────────────────────────────────────────────────────────
// ④ Public entry point
// ────────────────────────────────────────────────────────────────────
export const handleAIRequest = async (req, res) => {
  try {
    // ── Parse & shape the body ────────────────────────────────────
    const parsed = normaliseRequest(req);
    if (parsed.error) {
      return respondWithError(req, res, 400, parsed.error);
    }
    const { messages, imageUrl, locale } = parsed.data;
    const hasImage = Boolean(imageUrl);

    // ── Reject trivially empty text prompts (image grounded is OK) ─
    const intent = validateUserIntent({ messages, imageUrl, locale });
    if (!intent.ok) {
      return respondWithError(req, res, 400, { code: intent.code, message: intent.message });
    }

    // ── No AI configured at all ───────────────────────────────────
    if (!isAiEnabled()) {
      if (hasImage) {
        return respondWithError(req, res, 400, {
          code: "AI_DISABLED_FOR_IMAGE",
          message: locale === "en"
            ? "Image analysis requires an AI provider. Please type the part name instead."
            : "Зургийн шинжилгээ ажиллахын тулд AI provider шаардлагатай. Сэлбэгийн нэрийг бичээд хайна уу.",
        });
      }
      const lastUserText =
        [...messages].reverse().find((m) => m.role === "user")?.content || "";
      const result = await fallbackSearch(lastUserText, req.user);
      const reply = result.count === 0
        ? (locale === "en"
            ? "No results. Try a different keyword."
            : "Олдсонгүй. Өөр түлхүүр үг туршаад үзнэ үү.")
        : (locale === "en"
            ? `${result.count} parts found.`
            : `${result.count} сэлбэг олдлоо.`);
      // Cleanup is unnecessary here — text-only path. But the helper is
      // idempotent so this stays safe even if a future hybrid path lands.
      await cleanupUploadedAsset(req);
      return res.json({
        reply, toolCalls: [{ name: "search_products", result }],
        route: "fallback", model: "keyword-search",
      });
    }

    // ── Provider routing ──────────────────────────────────────────
    let profile;
    if (hasImage) {
      profile = aiConfig.vision;
      if (!profile.enabled) {
        return respondWithError(req, res, 400, {
          code: "VISION_PROVIDER_UNAVAILABLE",
          message: locale === "en"
            ? "Vision provider is not configured on this server. Please type the part name instead."
            : "Серверт зургийн AI provider тохируулагдаагүй байна. Сэлбэгийн нэрийг бичээд хайна уу.",
          hint: "Set GEMINI_API_KEY (or any OpenAI-compatible vision provider) — see Config/openai.js header.",
        });
      }
    } else {
      profile = aiConfig.text;
      if (!profile.enabled) profile = aiConfig.vision;
      if (!profile.enabled) {
        return respondWithError(req, res, 503, {
          code: "AI_PROVIDER_UNAVAILABLE",
          message: "AI provider not initialised. Operator must check env.",
        });
      }
    }

    // ── Pre-process Latin-Mongolian transliteration ───────────────
    // Runs on the LATEST user message. Deterministic dictionary lookup;
    // zero LLM cost. The hint is injected into the system prompt so the
    // model sees exact mappings BEFORE deciding which tool to call.
    const latestUserContent =
      [...messages].reverse().find((m) => m.role === "user")?.content || "";
    const translitResult = transliterate(latestUserContent);
    const transliterationHint = formatHint(translitResult, locale);

    // ── Run the bounded conversation ──────────────────────────────
    const { reply, toolCalls, usage, totalTokens, terminate } = await runConversation({
      profile, messages, user: req.user, locale, transliterationHint,
    });

    // Successful path → asset is no longer needed for this request.
    // We DO NOT delete the Cloudinary asset on success: it may be needed
    // for the user's next message (visible in the chat thread). Asset
    // lifecycle for retained images is owned by a separate housekeeping
    // cron (out of scope for this controller).

    return res.json({
      reply,
      toolCalls,
      usage,
      route: profile === aiConfig.vision ? "vision" : "text",
      model: profile.model,
      provider: profile.label,
      // Diagnostics — clients can use these to back off / show warnings.
      diagnostics: {
        totalTokens,
        terminateReason: terminate.reason,
        toolCallCount: toolCalls.length,
        // Surface translit signal so the frontend can show "we mapped X → Y"
        // when the user typed Latin-Mongolian.
        translit: translitResult.hasHits ? {
          hits: translitResult.hits.map((h) => ({ surface: h.surface, mn: h.mn, en: h.en })),
          expandedQuery: translitResult.expandedQuery,
          bestCategory: translitResult.bestCategory,
        } : null,
      },
    });
  } catch (err) {
    const mapped = mapUpstreamError(err);
    if (mapped) {
      const headers = mapped.status === 429 && mapped.body.retryAfter
        ? { "Retry-After": String(mapped.body.retryAfter) }
        : {};
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

// Test/diagnostic exports — not part of the public route surface.
export const __internal = Object.freeze({
  LIMITS,
  cleanupUploadedAsset,
  validateUserIntent,
  callSignature,
  mapUpstreamError,
});
