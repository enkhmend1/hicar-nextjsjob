import OpenAI from "openai";
import chalk from "chalk";

/**
 * Smart Hybrid AI Router — Configuration Layer
 *
 * The codebase needs TWO distinct AI capabilities:
 *
 *   ① Text + tool-call inference (chat replies, OEM translation, fraud
 *      analysis, product enrichment). Latency-sensitive and high-volume.
 *      → routed to a "fast text" provider.
 *
 *   ② Vision / multimodal (image-based part identification, seller bulk
 *      import OCR). Lower volume, needs an image-capable model.
 *      → routed to a "vision" provider.
 *
 * Concretely we ship with:
 *     fastTextClient → Groq        (https://api.groq.com/openai/v1)
 *     visionClient   → Gemini      (Google's OpenAI-compat endpoint)
 *
 * The OpenAI SDK is a vanilla transport layer. To swap either client to
 * OpenAI's native endpoint, change ONLY the env vars below; ZERO code
 * changes are required anywhere in the application:
 *
 *     GROQ_API_KEY=sk-openai-key
 *     GROQ_BASE_URL=https://api.openai.com/v1
 *     GROQ_MODEL=gpt-4o-mini
 *     GEMINI_API_KEY=sk-openai-key
 *     GEMINI_BASE_URL=https://api.openai.com/v1
 *     GEMINI_MODEL=gpt-4o
 *
 * The env-var names retain their provider prefixes to communicate ROLE
 * (text vs vision) — they are NOT provider-locked. Renaming to
 * AI_TEXT_* / AI_VISION_* is a future cosmetic change that doesn't
 * affect any caller.
 */

// ────────────────────────────────────────────────────────────────────
// Env helpers
// ────────────────────────────────────────────────────────────────────
const env = (name, fallback = "") => {
  const v = process.env[name];
  if (v === undefined || v === null) return fallback;
  const trimmed = String(v).trim();
  return trimmed === "" ? fallback : trimmed;
};

// Text/tool provider — defaults to Groq.
const TEXT_API_KEY  = env("GROQ_API_KEY");
const TEXT_BASE_URL = env("GROQ_BASE_URL", "https://api.groq.com/openai/v1");
const TEXT_MODEL    = env("GROQ_MODEL",    "llama-3.3-70b-versatile");

// Vision/multimodal provider — defaults to Gemini.
const VISION_API_KEY  = env("GEMINI_API_KEY");
const VISION_BASE_URL = env("GEMINI_BASE_URL", "https://generativelanguage.googleapis.com/v1beta/openai");
const VISION_MODEL    = env("GEMINI_MODEL",    "gemini-2.0-flash");

const CLIENT_TIMEOUT_MS = Number(env("AI_REQUEST_TIMEOUT_MS", "30000")) || 30_000;
// Phase M.1: bumped 1 → 4. The OpenAI SDK retries internally on 429/5xx
// with exponential backoff and respects the upstream's `Retry-After`
// header. Groq free-tier limits clear in 1-5s; 4 retries (~0.5/1/2/4s)
// usually covers it. After SDK retries exhaust, aiFallback.service
// walks to the next entry in the chain.
const CLIENT_MAX_RETRIES = Number(env("AI_REQUEST_MAX_RETRIES", "4")) || 4;

// ────────────────────────────────────────────────────────────────────
// Safe instantiation — never throws at module-load time
// ────────────────────────────────────────────────────────────────────
/**
 * Build an OpenAI SDK instance with defensive defaults. Returns null
 * (logging a clear reason) if the key is missing or the SDK constructor
 * itself throws — boot must succeed even with AI disabled.
 */
const buildClient = (role, { apiKey, baseURL, model }) => {
  if (!apiKey) {
    const envKey = role === "text" ? "GROQ_API_KEY" : "GEMINI_API_KEY";
    console.log(chalk.yellow(
      `AI (${role}) disabled — set ${envKey} to enable`,
    ));
    return null;
  }
  try {
    const client = new OpenAI({
      apiKey,
      baseURL,
      timeout: CLIENT_TIMEOUT_MS,
      maxRetries: CLIENT_MAX_RETRIES,
    });
    console.log(chalk.green.bold(
      `AI (${role}) enabled — model=${model}, baseURL=${baseURL}`,
    ));
    return client;
  } catch (err) {
    console.error(chalk.red(
      `AI (${role}) init failed: ${err.message}`,
    ));
    return null;
  }
};

// ────────────────────────────────────────────────────────────────────
// Public exports
// ────────────────────────────────────────────────────────────────────

/**
 * Fast text + tool-call client. Use this for chat without images, fraud
 * analysis, OEM translation, product enrichment.
 */
export const fastTextClient = buildClient("text", {
  apiKey: TEXT_API_KEY, baseURL: TEXT_BASE_URL, model: TEXT_MODEL,
});

/**
 * Vision / multimodal client. Use this whenever an image_url appears in
 * the conversation or req.file is present.
 */
export const visionClient = buildClient("vision", {
  apiKey: VISION_API_KEY, baseURL: VISION_BASE_URL, model: VISION_MODEL,
});

/**
 * Frozen capability map. Controllers and services should read from here
 * rather than dereferencing the raw clients, so future capability shifts
 * (Groq adding vision, OpenAI changing tool-call shape) are one-line
 * config changes rather than scattered conditionals.
 */
export const aiConfig = Object.freeze({
  text: Object.freeze({
    client:         fastTextClient,
    model:          TEXT_MODEL,
    enabled:        Boolean(fastTextClient),
    supportsTools:  true,   // Groq + OpenAI both support tools
    supportsVision: false,  // Groq has no vision yet
    label:          "groq-text",
  }),
  vision: Object.freeze({
    client:         visionClient,
    model:          VISION_MODEL,
    enabled:        Boolean(visionClient),
    supportsTools:  true,
    supportsVision: true,
    label:          "gemini-vision",
  }),
});

export const isAiEnabled = () => aiConfig.text.enabled || aiConfig.vision.enabled;

// ────────────────────────────────────────────────────────────────────
// Backward-compat aliases
// ────────────────────────────────────────────────────────────────────
// Pre-existing consumers (fraud.service, aiTranslator.service,
// productEnricher.service) import `openai`, `openaiEnabled`, `openaiModel`.
// They are all TEXT-ONLY workloads, so we alias them to the text client.
// New code should consume aiConfig.text / aiConfig.vision directly.

/** @deprecated use aiConfig.text.client */
export const openai        = fastTextClient;
/** @deprecated use aiConfig.text.enabled / aiConfig.vision.enabled */
export const openaiEnabled = aiConfig.text.enabled;
/** @deprecated use aiConfig.text.model */
export const openaiModel   = aiConfig.text.model;
/** @deprecated use aiConfig.vision.enabled */
export const openaiVision  = aiConfig.vision.enabled;
/** @deprecated use aiConfig.text.supportsTools */
export const openaiTools   = aiConfig.text.supportsTools;
