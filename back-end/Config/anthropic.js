import Anthropic from "@anthropic-ai/sdk";
import { logger } from "./logger.js";

/**
 * Anthropic Claude — Chat Configuration Layer
 *
 * Powers the USER/SELLER/ADMIN chat assistant (Controller/ai.controller.js).
 * The native @anthropic-ai/sdk is used directly (NOT the OpenAI compat layer)
 * so we get first-class tool use + prompt caching.
 *
 * DEFENSIVE by design — mirrors Config/openai.js:
 *   • never throws at module load; returns null if the key is missing or the
 *     constructor itself fails, so boot succeeds with AI disabled,
 *   • a clear log line states whether chat is enabled and on which model.
 *
 * This is a SEPARATE provider from Config/openai.js (Groq/Gemini). The chat
 * controller prefers Anthropic and falls back to the Groq text chain when
 * Anthropic is unavailable or rate-limited, so chat is never a single-provider
 * single point of failure.
 */

const env = (name, fallback = "") => {
  const v = process.env[name];
  if (v === undefined || v === null) return fallback;
  const trimmed = String(v).trim();
  return trimmed === "" ? fallback : trimmed;
};

const ANTHROPIC_API_KEY   = env("ANTHROPIC_API_KEY");
const ANTHROPIC_CHAT_MODEL = env("ANTHROPIC_CHAT_MODEL", "claude-3-5-sonnet-latest");

// Reuse the same transport tuning as the OpenAI client so all AI surfaces
// share one retry/timeout policy. The SDK retries 429/5xx with backoff.
const CLIENT_TIMEOUT_MS  = Number(env("AI_REQUEST_TIMEOUT_MS", "30000")) || 30_000;
const CLIENT_MAX_RETRIES = Number(env("AI_REQUEST_MAX_RETRIES", "4")) || 4;

const buildClient = () => {
  if (!ANTHROPIC_API_KEY) {
    logger.warn(
      "Anthropic chat disabled — set ANTHROPIC_API_KEY to enable (chat will use the Groq fallback chain)",
    );
    return null;
  }
  try {
    const client = new Anthropic({
      apiKey: ANTHROPIC_API_KEY,
      maxRetries: CLIENT_MAX_RETRIES,
      timeout: CLIENT_TIMEOUT_MS,
    });
    logger.info("Anthropic chat enabled", { model: ANTHROPIC_CHAT_MODEL });
    return client;
  } catch (err) {
    logger.error("Anthropic chat init failed", { err });
    return null;
  }
};

const client = buildClient();

/**
 * Frozen config. Controllers read from here rather than dereferencing the raw
 * client, so capability/model changes stay one-line config edits.
 */
export const anthropicConfig = Object.freeze({
  client,
  model:   ANTHROPIC_CHAT_MODEL,
  enabled: Boolean(client),
  label:   "anthropic-chat",
});

export const anthropicEnabled = () => anthropicConfig.enabled;
