/**
 * AI Translator — converts a Mongolian user query + vehicle context into a
 * STRICT machine-readable "search plan".
 *
 * Output contract (every call returns this shape, even on fallback):
 *
 *   {
 *     standard_category:   string   // snake_case key, e.g. "front_brake_pads"
 *     api_english_name:    string   // what to send to PartsSouq / Amayama
 *     search_keywords:     string[] // mn + en mix for OEM-mapping fallback
 *     possible_oem_codes:  string[] // pre-validated OEM-shape strings
 *     possible_cross_codes:string[] // aftermarket equivalents (Akebono, KYB, …)
 *   }
 *
 * Why function calling instead of `response_format: json_object`:
 *   • function calling enforces a JSON Schema → we get type safety + required
 *     fields even on smaller models
 *   • the model literally cannot return free-text; it MUST call the tool
 *
 * Caching:
 *   • Redis key: ai-plan:<vehicleKey>:<query>  (24h)
 *   • vehicleKey = manuname|generation|motorcode — same plate / different car
 *     should share the cache
 *
 * Fallback (no OpenAI key):
 *   • Uses the existing OemMapping table + a hand-curated slang dictionary
 *   • Returns the same shape so callers don't branch
 */

import { openai, openaiEnabled, openaiModel } from "../Config/openai.js";
import { cacheGet, cacheSet } from "../Config/redis.js";
import { expandQueryWithMappings } from "./oem.service.js";

const CACHE_TTL = Number(process.env.AI_TRANSLATOR_TTL || 60 * 60 * 24); // 24h
const OEM_RX = /^[A-Z0-9][A-Z0-9.\-/ ]{1,30}[A-Z0-9]$/i;

// ── Mongolian slang → English (used by both prompt examples and fallback) ──
const SLANG_TO_EN = {
  наклад:        "brake pads",
  амортизатор:   "shock absorber",
  ээмэг:         "stabilizer link",
  гялаан:        "control arm",
  гитара:        "control arm",
  свеч:          "spark plug",
  свечэ:         "spark plug",
  помп:          "water pump",
  помпо:         "water pump",
  "цагны залуур": "tie rod end",
  тяг:           "tie rod end",
  боорцог:       "ball joint",
  шаров:         "ball joint",
  тоормос:       "brake",
  диск:          "brake disc",
  фар:           "headlight",
  фара:          "headlight",
  гэрэл:         "lighting",
  ремень:        "belt",
  бэлт:          "belt",
  бэлтгэх:       "belt",
  тосны:         "oil filter",
  агаарын:       "air filter",
  түлшний:       "fuel filter",
  батарей:       "battery",
  колодк:        "brake pads",
  колодка:       "brake pads",
};

const POSITION_HINTS = {
  урд:    "front",
  ард:    "rear",
  хойд:   "rear",
  зүүн:   "left",
  баруун: "right",
};

const SYSTEM_PROMPT = `You are HiCar AI — a senior automotive parts specialist for the Mongolian market.

Translate a Mongolian/mixed-script user query about a SPECIFIC vehicle into a structured search plan.

RULES:
1. Translate Mongolian slang / Russian-origin terms to international English part names:
   наклад/колодка → brake pads · амортизатор → shock absorber · ээмэг → stabilizer link
   гялаан/гитара → control arm · свеч → spark plug · помп → water pump
   цагны залуур/тяг → tie rod end · боорцог/шаров → ball joint
   диск → brake disc · фар → headlight · ремень → belt

2. Recognise position qualifiers: урд=front, ард/хойд=rear, зүүн=left, баруун=right.

3. Use your domain knowledge of the vehicle (manuname, modelname, generation/chassis code,
   motorcode, motortype) to output the most likely OEM codes that would be sold for this
   exact platform — never invent codes for unrelated cars.

4. Include 3-6 commonly-stocked aftermarket cross-references (Akebono, Nisshinbo, KYB,
   555, GMB, Aisin, NGK, Denso, Bosch, etc.) — only those you are confident apply.

5. ALWAYS call the emit_search_plan function. Do not respond with plain text.`;

const TOOL = {
  type: "function",
  function: {
    name: "emit_search_plan",
    description: "Emit the structured search plan for the given vehicle + query.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["standard_category", "api_english_name", "search_keywords", "possible_oem_codes", "possible_cross_codes"],
      properties: {
        standard_category:    { type: "string", description: "snake_case category key (e.g. 'front_brake_pads')" },
        api_english_name:     { type: "string", description: "Phrase to send to PartsSouq / Amayama, e.g. 'front brake pads'" },
        search_keywords:      { type: "array", items: { type: "string" }, description: "Mongolian + English keywords for our DB tag/text search" },
        possible_oem_codes:   { type: "array", items: { type: "string" }, description: "OEM codes the model thinks apply to THIS exact vehicle" },
        possible_cross_codes: { type: "array", items: { type: "string" }, description: "Aftermarket equivalents (Akebono, KYB, 555, etc.)" },
      },
    },
  },
};

const userPrompt = (vehicle, query) => `
VEHICLE:
  manuname:    ${vehicle.manuname}
  modelname:   ${vehicle.modelname}
  carname:     ${vehicle.carname || ""}
  motorcode:   ${vehicle.motorcode || ""}
  motortype:   ${vehicle.motortype || ""}
  generation:  ${vehicle.generation || ""}

USER QUERY: "${query}"

Emit the search plan. Be conservative with OEM codes — only include codes you are CONFIDENT match this exact chassis+engine combination.
`.trim();

// ── Canonicalisers ─────────────────────────────────────────────────────
const cleanCode = (s) => String(s).trim().toUpperCase().replace(/\s+/g, "");
const uniq = (arr) => [...new Set(arr)];
const filterCodes = (arr) =>
  uniq((arr || [])
    .map(cleanCode)
    .filter((c) => OEM_RX.test(c)));

const emptyPlan = () => ({
  standard_category: "",
  api_english_name: "",
  search_keywords: [],
  possible_oem_codes: [],
  possible_cross_codes: [],
});

const validateAndShape = (out) => {
  const o = out || {};
  return {
    standard_category:    String(o.standard_category || "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "_"),
    api_english_name:     String(o.api_english_name  || "").trim().toLowerCase(),
    search_keywords:      uniq((o.search_keywords || []).map((s) => String(s).trim()).filter(Boolean)).slice(0, 16),
    possible_oem_codes:   filterCodes(o.possible_oem_codes).slice(0, 30),
    possible_cross_codes: filterCodes(o.possible_cross_codes).slice(0, 30),
  };
};

// ── Fallback (no OpenAI): build a plan using slang dict + OEM mappings ──
const fallbackPlan = async (query, vehicle) => {
  const q = String(query).toLowerCase().trim();
  const tokens = q.split(/\s+/);

  // Detect part name from slang dict (longest-first to beat "наклад" with "колодка")
  let englishPart = "";
  const sortedSlang = Object.entries(SLANG_TO_EN).sort(([a], [b]) => b.length - a.length);
  for (const [mn, en] of sortedSlang) {
    if (q.includes(mn)) { englishPart = en; break; }
  }

  // Detect position
  const positions = [];
  for (const tok of tokens) {
    if (POSITION_HINTS[tok]) positions.push(POSITION_HINTS[tok]);
  }
  const positionPrefix = positions.length ? `${positions.join(" ")} ` : "";

  // Use existing oem service for category mapping (uses OemMapping table)
  const expanded = await expandQueryWithMappings(q);
  const standard = englishPart
    ? `${positions.join("_")}${positions.length ? "_" : ""}${englishPart.replace(/\s+/g, "_")}`.replace(/^_/, "")
    : (expanded.category || "");

  const apiName = englishPart ? `${positionPrefix}${englishPart}` : q;

  return validateAndShape({
    standard_category: standard,
    api_english_name: apiName,
    search_keywords: uniq([q, englishPart, ...positions.map((p) => `${p} ${englishPart}`)]
      .filter(Boolean)),
    possible_oem_codes: [],   // can't safely guess without LLM
    possible_cross_codes: [],
  });
};

// ── Cache key (vehicle-aware) ──────────────────────────────────────────
const cacheKey = (query, vehicle) => {
  const v = [
    String(vehicle.manuname || "").toUpperCase(),
    String(vehicle.modelname || "").toUpperCase(),
    String(vehicle.generation || "").toUpperCase(),
    String(vehicle.motorcode || "").toUpperCase(),
  ].join("|");
  return `ai-plan:${v}:${String(query).toLowerCase().trim()}`;
};

/**
 * Main entry. Always returns the SearchPlan shape, even on error.
 *
 * @param {string} query — user query, Mongolian or mixed script
 * @param {object} vehicle — { manuname, modelname, generation?, motorcode?, motortype?, carname? }
 * @returns {Promise<{
 *   plan: SearchPlan,
 *   source: "cache" | "llm" | "fallback",
 *   model?: string,
 *   tookMs: number,
 * }>}
 */
export const translateSearchQuery = async (query, vehicle) => {
  const started = Date.now();
  if (!query || typeof query !== "string") {
    return { plan: emptyPlan(), source: "fallback", tookMs: Date.now() - started };
  }

  const key = cacheKey(query, vehicle);
  const cached = await cacheGet(key);
  if (cached) return { plan: cached, source: "cache", tookMs: Date.now() - started };

  if (!openaiEnabled) {
    const plan = await fallbackPlan(query, vehicle);
    await cacheSet(key, plan, 60 * 60); // shorter TTL (fallback is weaker)
    return { plan, source: "fallback", tookMs: Date.now() - started };
  }

  try {
    const resp = await openai.chat.completions.create({
      model: openaiModel,
      temperature: 0.1,           // deterministic-ish — same input, same output
      tool_choice: { type: "function", function: { name: TOOL.function.name } },
      tools: [TOOL],
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user",   content: userPrompt(vehicle, query) },
      ],
    });

    const call = resp.choices[0]?.message?.tool_calls?.[0];
    if (!call || call.function?.name !== TOOL.function.name) {
      throw new Error("LLM did not call emit_search_plan");
    }
    let parsed;
    try { parsed = JSON.parse(call.function.arguments || "{}"); }
    catch { throw new Error("LLM returned invalid JSON arguments"); }

    const plan = validateAndShape(parsed);
    await cacheSet(key, plan, CACHE_TTL);
    return { plan, source: "llm", model: openaiModel, tookMs: Date.now() - started };
  } catch (err) {
    // Don't fail the whole search just because the LLM blinked — degrade gracefully.
    const plan = await fallbackPlan(query, vehicle);
    return { plan, source: "fallback", tookMs: Date.now() - started, error: err.message };
  }
};
