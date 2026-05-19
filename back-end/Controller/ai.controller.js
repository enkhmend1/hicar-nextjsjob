import { openai, openaiEnabled, openaiModel } from "../Config/openai.js";
import Product from "../Model/product.model.js";
import Order from "../Model/order.model.js";
import { logSearch, expandQueryWithMappings } from "../Service/oem.service.js";

// ──────────────────────────────────────────────────────────────────
// Tool definitions exposed to the LLM
// ──────────────────────────────────────────────────────────────────
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

// ──────────────────────────────────────────────────────────────────
// Internal: raw search (no expansion, no logging). The two callers
// (LLM tool handler + non-AI fallback) handle expansion + logging
// themselves so we don't double-count usage.
// ──────────────────────────────────────────────────────────────────
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

// ──────────────────────────────────────────────────────────────────
// Tool implementations (invoked by LLM)
// ──────────────────────────────────────────────────────────────────
const TOOL_HANDLERS = {
  async search_products(args, user) {
    const { query, category, limit = 5 } = args;
    const expanded = await expandQueryWithMappings(query);
    const finalCategory = category || expanded.category;
    const finalQuery = expanded.query;

    const items = await runProductSearch({ query: finalQuery, category: finalCategory, limit });

    logSearch({
      query, expandedQuery: finalQuery, category: finalCategory,
      resultCount: items.length, source: "ai", user: user?._id,
    }).catch(() => {});

    return { query: finalQuery, category: finalCategory, count: items.length, items };
  },

  // The model "identifies" the part from the image and we then run a normal search.
  // We pass `keywords` straight to runProductSearch (no second expansion)
  // because the model already concluded the category.
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
    if (period === "today") { since = new Date(now); since.setHours(0, 0, 0, 0); }
    else if (period === "week") { since = new Date(now); since.setDate(now.getDate() - 7); }
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

// ──────────────────────────────────────────────────────────────────
// Fallback (no OpenAI key): keyword/slang based search.
// Performs expansion + raw search + logging exactly once.
// ──────────────────────────────────────────────────────────────────
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

// ──────────────────────────────────────────────────────────────────
// Build an OpenAI-compatible message from our generic shape.
// Supports text-only and text+image (GPT-4V multipart).
// ──────────────────────────────────────────────────────────────────
const toOpenAiMessage = (m) => {
  if (m.role === "user" && m.imageUrl) {
    return {
      role: "user",
      content: [
        { type: "text", text: m.content || "Энэ зурагт ямар автомашины сэлбэг байна вэ?" },
        { type: "image_url", image_url: { url: m.imageUrl, detail: "high" } },
      ],
    };
  }
  return { role: m.role, content: m.content };
};

// ──────────────────────────────────────────────────────────────────
// Main chat endpoint
// ──────────────────────────────────────────────────────────────────
export const chat = async (req, res) => {
  try {
    const { messages, locale = "mn" } = req.body;
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ message: "messages array required" });
    }
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    const userText = lastUserMsg?.content || "";
    const hasImage = Boolean(lastUserMsg?.imageUrl);

    // ── Without OpenAI: fall back to keyword search ────────────────
    if (!openaiEnabled) {
      if (hasImage) {
        return res.json({
          reply: locale === "en"
            ? "Image search needs the OpenAI API key. Please type the part name instead."
            : "Зургийн хайлт ажиллахын тулд OpenAI key хэрэгтэй. Та сэлбэгийн нэрийг бичээд хайна уу.",
          toolCalls: [],
          fallback: true,
        });
      }
      const result = await fallbackSearch(userText, req.user);
      const langReply = locale === "en"
        ? `${result.count} parts found.`
        : `${result.count} сэлбэг олдлоо.`;
      return res.json({
        reply: result.count === 0
          ? (locale === "en" ? "No results. Try a different keyword." : "Олдсонгүй. Өөр түлхүүр үг туршаад үзнэ үү.")
          : langReply,
        toolCalls: [{ name: "search_products", result }],
        fallback: true,
      });
    }

    // ── Real OpenAI call with function calling ─────────────────────
    const isAdmin = req.user?.role === "admin";
    const systemPrompt = locale === "en"
      ? `You are HiCar AI — a friendly assistant for an auto-parts marketplace.
${isAdmin ? "You are speaking to an ADMIN — admin tools are available." : "You are speaking to a regular customer."}
Reply concisely in English. When the user asks about parts, call search_products. When they upload an image, call identify_part_from_image first.`
      : `Та HiCar AI туслах — автомашины сэлбэгийн платформын туслах.
${isAdmin ? "Та ADMIN-тай ярьж байна — admin tool ашиглаж болно." : "Та энгийн хэрэглэгчтэй ярьж байна."}
Богино, ойлгомжтой Монголоор хариул. Сэлбэгийн талаар асуувал search_products дуудна. Зураг илгээсэн бол эхлээд identify_part_from_image дууд.
Монгол slang: тоормос=brake, фар/гэрэл=lighting, амортизатор=suspension, хөдөлгүүр/мотор=engine, наклад=brake pad, бампер=bumper.`;

    const availableTools = isAdmin
      ? TOOLS
      : TOOLS.filter((t) => !["get_low_stock", "get_sales_summary"].includes(t.function.name));

    const conversation = [
      { role: "system", content: systemPrompt },
      ...messages.map(toOpenAiMessage),
    ];

    // Allow a couple of tool-call rounds (e.g. identify → search)
    const toolCalls = [];
    let usage = null;
    let msg = null;
    const MAX_ROUNDS = 3;
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const resp = await openai.chat.completions.create({
        model: openaiModel,
        messages: conversation,
        tools: availableTools,
        tool_choice: round === 0 ? "auto" : "auto",
        temperature: 0.3,
      });
      msg = resp.choices[0].message;
      usage = resp.usage;
      if (!msg.tool_calls || msg.tool_calls.length === 0) break;

      conversation.push(msg);
      for (const tc of msg.tool_calls) {
        const handler = TOOL_HANDLERS[tc.function.name];
        let result = { error: "Unknown tool" };
        if (handler) {
          try {
            const args = JSON.parse(tc.function.arguments || "{}");
            result = await handler(args, req.user);
          } catch (e) {
            result = { error: e.message };
          }
        }
        toolCalls.push({ name: tc.function.name, result });
        conversation.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify(result),
        });
      }
    }

    return res.json({
      reply: msg?.content || "",
      toolCalls,
      usage,
    });
  } catch (err) {
    console.error("AI chat error:", err.message);
    return res.status(500).json({ message: err.message });
  }
};
