/**
 * Product Enricher — turns messy seller input into clean, structured
 * catalogue rows ready for insertion.
 *
 *     RAW (seller input)                  ENRICHED (DB-ready)
 *     ──────────────────────              ────────────────────
 *     raw_name      "..."                 cleaned_oem_code
 *     input_code    "  04465 - 30400  "   cleaned_part_number
 *     brand         "Toyota"              brand                  (UPPER)
 *     price         180000                standard_category      (snake_case)
 *     stock         5                     display_name_mn
 *     location      "Теди салбар"        display_name_en
 *                                         condition_grade  (OEM | Premium Aftermarket | Standard Aftermarket)
 *                                         compatible_vehicles[]
 *                                         price, stock, location (passed through)
 *                                         confidence       (0.0 … 1.0)
 *                                         warnings[]
 *
 * Three usage modes the controller wraps:
 *   • single   — one row, sync round-trip
 *   • bulk     — N rows, BullMQ if available, else parallel cap 5
 *   • ocr      — image URL → GPT-4V extracts code/name → enrich pipeline
 *
 * Pipeline:
 *   1. Deterministic cleaners ALWAYS run (never trust LLM for syntax cleaning)
 *   2. LLM enriches: category, mn/en display names, condition grade,
 *      compatible vehicles (uses function calling for strict schema)
 *   3. Result is validated against schema; missing fields fall back to
 *      conservative defaults instead of throwing
 *
 * Caching:
 *   Redis key: enrich:v1:<sha1(normalized raw)>:<openaiModel>
 *   TTL: 7 days — sellers re-upload the same SKU constantly
 */

import crypto from "crypto";
import { openai, openaiEnabled, openaiModel } from "../Config/openai.js";
import { cacheGet, cacheSet } from "../Config/redis.js";

const CACHE_TTL = Number(process.env.ENRICH_CACHE_TTL || 60 * 60 * 24 * 7); // 7d

// ── Deterministic cleaners ─────────────────────────────────────────────
// Never delegate format-cleaning to the LLM — it's slow, expensive and
// occasionally hallucinates. Strip whitespace, normalise case, drop
// unwanted punctuation here.

const OEM_KEEP_RX = /[^A-Za-z0-9.\-/]/g;
export const cleanOemCode = (s) =>
  String(s || "")
    .trim()
    .toUpperCase()
    .replace(OEM_KEEP_RX, "")     // drop spaces, illegal punctuation
    .replace(/^[.\-/]+|[.\-/]+$/g, ""); // trim separators

export const cleanBrand = (s) =>
  String(s || "").trim().toUpperCase().replace(/\s+/g, " ");

const num = (v, dflt = 0) => {
  if (v == null || v === "") return dflt;
  const n = Number(String(v).replace(/[^\d.\-]/g, ""));
  return Number.isFinite(n) ? n : dflt;
};

const slug = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);

// ── Premium aftermarket brand list — used by fallback grading ───────────
const PREMIUM_BRANDS = new Set([
  "KYB", "NISSHINBO", "ADVICS", "AKEBONO", "DENSO", "BOSCH", "AISIN",
  "NGK", "GMB", "555", "TOKICO", "PIONEER", "TRW", "SACHS", "MANN",
  "MAHLE", "ZF", "FEBI", "LUK", "VALEO",
]);

const looksLikeOem = (s) =>
  /^[A-Z0-9][A-Z0-9.\-/]{1,30}[A-Z0-9]$/.test(s || "");

// ── Function-calling schema ────────────────────────────────────────────
const TOOL = {
  type: "function",
  function: {
    name: "emit_enriched_product",
    description: "Return the cleaned + enriched structured product row.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: [
        "standard_category",
        "display_name_mn",
        "display_name_en",
        "condition_grade",
        "compatible_vehicles",
      ],
      properties: {
        standard_category: {
          type: "string",
          description: "snake_case canonical category (e.g. 'front_brake_pads')",
        },
        display_name_mn: { type: "string", description: "Standardised Mongolian display name" },
        display_name_en: { type: "string", description: "Standardised English display name" },
        condition_grade: {
          type: "string",
          enum: ["OEM", "Premium Aftermarket", "Standard Aftermarket"],
        },
        compatible_vehicles: {
          type: "array",
          description: "Best-known vehicle fitments for this OEM (max 8)",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["make", "model"],
            properties: {
              make:    { type: "string" },
              model:   { type: "string" },
              chassis: { type: "string" },
              engine:  { type: "string" },
              years:   { type: "string", description: "e.g. '2012-2018'" },
            },
          },
        },
        confidence: {
          type: "number",
          description: "0..1 — how sure the model is about category + compatibility",
        },
      },
    },
  },
};

const SYSTEM_PROMPT = `You are HiCar AI — a senior auto-parts data steward for Mongolia.

Convert a raw seller-entered product row into a clean structured record.

RULES:
1. The OEM code has ALREADY been syntactically cleaned. Do not re-format codes.
2. Use \`raw_name\` + \`brand\` + (already cleaned) \`cleaned_oem_code\` to infer:
   • standard_category    — snake_case, e.g. "front_brake_pads", "shock_absorber_front",
                            "oil_filter", "spark_plug", "headlight_left", "control_arm_front_lower".
   • display_name_mn      — Mongolian, e.g. "Урд тоормосны талст (Наклад)".
   • display_name_en      — English, e.g. "Front Brake Pads".
3. Condition grade:
   • "OEM"                    — manufacturer brand (Toyota Genuine, Honda Genuine, etc.),
                                or raw_name contains "оригинал", "genuine", "OEM".
   • "Premium Aftermarket"    — KYB, Nisshinbo, Akebono, Advics, Denso, NGK, Bosch, GMB, 555, …
   • "Standard Aftermarket"   — anything else / generic.
4. compatible_vehicles — if the OEM is a well-known code you recognise,
   list the vehicles it fits. Include chassis code + engine code where known.
   If unsure, return empty array — DO NOT guess.
5. ALWAYS call emit_enriched_product. Never reply with plain text.
6. Be conservative — empty arrays/strings are better than hallucinations.`;

const userPrompt = (cleaned) => `
SELLER ROW (already cleaned for format):
  raw_name:          ${cleaned.raw_name || ""}
  cleaned_oem_code:  ${cleaned.cleaned_oem_code || "(none)"}
  brand:             ${cleaned.brand || ""}
  raw_input_code:    ${cleaned.input_code || ""}

Emit the structured row. Use empty array for compatible_vehicles if you are
not certain — false fitments cost customers money.
`.trim();

// ── Rule-based fallback (LLM unavailable / disabled) ───────────────────

// Tiny slang dictionary for the most common parts admins see daily.
const SLANG_CATEGORY = [
  { mn: ["наклад", "колодка"], cat: "brake_pads",          mn_name: "Тоормосны талст (Наклад)", en_name: "Brake Pads" },
  { mn: ["амортизатор"],        cat: "shock_absorber",      mn_name: "Амортизатор",                en_name: "Shock Absorber" },
  { mn: ["ээмэг"],              cat: "stabilizer_link",     mn_name: "Тогтворжуулагч холбоос (Ээмэг)", en_name: "Stabilizer Link" },
  { mn: ["гялаан", "гитара"],   cat: "control_arm",         mn_name: "Хяналтын хөшүүрэг",         en_name: "Control Arm" },
  { mn: ["свеч", "свечэ"],      cat: "spark_plug",          mn_name: "Шатаагч лаа (Свеч)",        en_name: "Spark Plug" },
  { mn: ["помп"],               cat: "water_pump",          mn_name: "Усны насос (Помп)",         en_name: "Water Pump" },
  { mn: ["тяг", "цагны залуур"],cat: "tie_rod_end",         mn_name: "Цагны залуурын төгсгөл",    en_name: "Tie Rod End" },
  { mn: ["боорцог", "шаров"],    cat: "ball_joint",          mn_name: "Бөмбөлгөн залгаас",          en_name: "Ball Joint" },
  { mn: ["диск"],               cat: "brake_disc",          mn_name: "Тоормосны диск",            en_name: "Brake Disc" },
  { mn: ["фар"],                cat: "headlight",           mn_name: "Гэрэл (Фар)",                en_name: "Headlight" },
  { mn: ["тосны шүүр", "тосны"],cat: "oil_filter",          mn_name: "Тосны шүүлтүүр",            en_name: "Oil Filter" },
  { mn: ["агаарын шүүр", "агаарын"], cat: "air_filter",     mn_name: "Агаарын шүүлтүүр",          en_name: "Air Filter" },
];

const POSITION = [
  { mn: ["урд"],         en: "front", mnLabel: "Урд" },
  { mn: ["ард", "хойд"], en: "rear",  mnLabel: "Ард" },
  { mn: ["зүүн"],        en: "left",  mnLabel: "Зүүн" },
  { mn: ["баруун"],      en: "right", mnLabel: "Баруун" },
];

const capFirst = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

const fallbackEnrich = (cleaned) => {
  const lc = (cleaned.raw_name || "").toLowerCase();
  const hit = SLANG_CATEGORY.find((s) => s.mn.some((m) => lc.includes(m)));
  const matches = POSITION.filter((p) => p.mn.some((m) => lc.includes(m)));
  const enPositions = matches.map((p) => p.en);
  const mnPositions = matches.map((p) => p.mnLabel);

  const posSnake = enPositions.length ? enPositions.join("_") + "_" : "";
  const enPrefix = enPositions.length ? enPositions.join(" ") + " " : "";
  const mnPrefix = mnPositions.length ? mnPositions.join(" ") + " " : "";

  // Condition grade from brand / raw text
  const brand = (cleaned.brand || "").toUpperCase();
  let grade = "Standard Aftermarket";
  if (/оригинал|genuine|\bOEM\b/i.test(cleaned.raw_name || "") ||
      ["TOYOTA", "HONDA", "NISSAN", "MITSUBISHI", "MAZDA", "HYUNDAI", "KIA", "SUBARU"].includes(brand)) {
    grade = "OEM";
  } else if (PREMIUM_BRANDS.has(brand)) {
    grade = "Premium Aftermarket";
  }

  return {
    standard_category: hit ? `${posSnake}${hit.cat}` : "",
    display_name_mn:   hit ? `${mnPrefix}${hit.mn_name}` : cleaned.raw_name || "",
    display_name_en:   hit ? capFirst(`${enPrefix}${hit.en_name}`) : "",
    condition_grade:   grade,
    compatible_vehicles: [],
    confidence: hit ? 0.4 : 0.1,
  };
};

// ── LLM enricher ───────────────────────────────────────────────────────
const llmEnrich = async (cleaned) => {
  const resp = await openai.chat.completions.create({
    model: openaiModel,
    temperature: 0.1,
    tool_choice: { type: "function", function: { name: TOOL.function.name } },
    tools: [TOOL],
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user",   content: userPrompt(cleaned) },
    ],
  });

  const call = resp.choices[0]?.message?.tool_calls?.[0];
  if (!call || call.function?.name !== TOOL.function.name) {
    throw new Error("LLM did not call emit_enriched_product");
  }
  const parsed = JSON.parse(call.function.arguments || "{}");
  return parsed;
};

// ── Final validator / shaper ───────────────────────────────────────────
const shape = (enrich, cleaned, source) => {
  const warnings = [];
  const cat = slug(enrich.standard_category);
  if (!cat) warnings.push("missing_category");
  if (!cleaned.cleaned_oem_code) warnings.push("missing_oem_code");
  if (!Array.isArray(enrich.compatible_vehicles)) enrich.compatible_vehicles = [];

  return {
    // ── cleaned input ──
    cleaned_oem_code:    cleaned.cleaned_oem_code,
    cleaned_part_number: cleaned.cleaned_oem_code, // alias for clarity
    brand:               cleanBrand(cleaned.brand),
    raw_input_code:      cleaned.input_code,
    raw_name:            cleaned.raw_name,
    // ── pass-through inventory data ──
    price:               num(cleaned.price),
    stock:               num(cleaned.stock),
    location:            cleaned.location || "",
    // ── AI enrichment ──
    standard_category:   cat,
    display_name_mn:     String(enrich.display_name_mn || cleaned.raw_name || "").trim(),
    display_name_en:     String(enrich.display_name_en || "").trim(),
    condition_grade:     ["OEM", "Premium Aftermarket", "Standard Aftermarket"].includes(enrich.condition_grade)
                          ? enrich.condition_grade : "Standard Aftermarket",
    compatible_vehicles: enrich.compatible_vehicles.slice(0, 12).map((v) => ({
      make:    String(v.make || "").toUpperCase(),
      model:   String(v.model || "").toUpperCase(),
      chassis: v.chassis ? String(v.chassis).toUpperCase() : undefined,
      engine:  v.engine  ? String(v.engine).toUpperCase()  : undefined,
      years:   v.years || undefined,
    })),
    confidence:          Math.max(0, Math.min(1, Number(enrich.confidence) || 0)),
    // ── meta ──
    _meta: {
      enriched_by: source,           // "llm" | "fallback" | "cache"
      enriched_at: new Date().toISOString(),
      warnings,
    },
  };
};

// ── Cache key ──────────────────────────────────────────────────────────
const cacheKey = (cleaned) => {
  const h = crypto.createHash("sha1")
    .update([
      cleaned.cleaned_oem_code,
      cleaned.brand,
      (cleaned.raw_name || "").trim().toLowerCase(),
    ].join("|"))
    .digest("hex");
  return `enrich:v1:${openaiEnabled ? openaiModel : "fallback"}:${h}`;
};

/**
 * Public entry — enrich a single raw seller row. Always returns a structured
 * record, never throws.
 *
 * @param {{ raw_name?, input_code?, brand?, price?, stock?, location? }} raw
 */
export const enrichProduct = async (raw) => {
  const cleaned = {
    raw_name:         String(raw?.raw_name || "").trim(),
    input_code:       String(raw?.input_code || "").trim(),
    cleaned_oem_code: cleanOemCode(raw?.input_code),
    brand:            cleanBrand(raw?.brand),
    price:            raw?.price,
    stock:            raw?.stock,
    location:         raw?.location,
  };

  // OEM code sanity warning
  if (cleaned.cleaned_oem_code && !looksLikeOem(cleaned.cleaned_oem_code)) {
    // keep going — controller surfaces this via _meta.warnings
  }

  // Cache lookup
  const key = cacheKey(cleaned);
  const cached = await cacheGet(key);
  if (cached) return { ...cached, _meta: { ...cached._meta, enriched_by: "cache" } };

  try {
    const enrich = openaiEnabled ? await llmEnrich(cleaned) : fallbackEnrich(cleaned);
    const out = shape(enrich, cleaned, openaiEnabled ? "llm" : "fallback");
    await cacheSet(key, out, CACHE_TTL);
    return out;
  } catch (err) {
    // LLM failed → degrade gracefully
    const enrich = fallbackEnrich(cleaned);
    const out = shape(enrich, cleaned, "fallback");
    out._meta.warnings.push(`llm_error:${err.message}`);
    return out;
  }
};

/**
 * Bulk enrich — bounded concurrency so we don't fan-out 1000 LLM calls at once.
 *
 * @param {Array} rows
 * @param {{ concurrency?: number, onProgress?: (done, total) => void }} opts
 */
export const enrichBulk = async (rows, opts = {}) => {
  const concurrency = Math.max(1, Math.min(8, opts.concurrency || 5));
  const queue = rows.slice();
  const out = new Array(rows.length);
  let cursor = 0;
  let done = 0;

  const workers = Array.from({ length: concurrency }).map(async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= queue.length) return;
      try {
        out[idx] = await enrichProduct(queue[idx]);
      } catch (e) {
        // enrichProduct never throws but belt-and-braces
        out[idx] = {
          _meta: { enriched_by: "error", warnings: [e.message] },
          ...queue[idx],
        };
      }
      done++;
      opts.onProgress?.(done, queue.length);
    }
  });
  await Promise.all(workers);
  return out;
};
