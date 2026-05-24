/**
 * AI Fallback Service — Phase M.1.
 *
 * Walks a chain of `(client, model)` pairs and returns the first
 * successful response. Designed for one and only one purpose: surviving
 * Groq free-tier rate limits without the user ever seeing a 429.
 *
 * Why a chain (not just retry the same model):
 *   The OpenAI SDK already retries on 429 internally (we bumped
 *   maxRetries to 4 in Config/openai.js). If THAT exhausts, the
 *   counter is still pinned for the next ~30s — re-trying the same
 *   model wouldn't help. The win is switching to a DIFFERENT counter:
 *
 *     1. Groq llama-3.3-70b-versatile   ← primary (highest quality)
 *     2. Groq llama-3.1-8b-instant      ← fallback (separate model counter)
 *     3. Gemini 2.0 Flash               ← fallback (separate provider, 1M TPM)
 *
 *   If all three are pinned simultaneously the user has a real platform
 *   problem (likely paid-tier territory) — we surface the 429 to the
 *   frontend, which shows a countdown and auto-retries after cooldown.
 *
 * Why not in-controller:
 *   Keeping fallback logic in a service makes it (a) testable without
 *   spinning up Express, (b) reusable by future workers (background
 *   agent, fraud check) that also call the text LLM, (c) easy to mock
 *   in unit tests by swapping the chain.
 *
 * What is NOT in scope here:
 *   • Per-user rate limiting (separate middleware — Phase M.1.x)
 *   • Streaming responses (Phase M.2)
 *   • Cost tracking / per-user budgets (Phase M future)
 */

import chalk from "chalk";
import { aiConfig } from "../Config/openai.js";

// ────────────────────────────────────────────────────────────────────
// Error classification — we only fall back on rate-limit-ish errors.
// Auth / bad-request / model-not-found should fail loud, not silently
// degrade to a smaller model.
// ────────────────────────────────────────────────────────────────────

/**
 * Is this an error we should walk the chain for? Yes for:
 *   • HTTP 429 (rate limited)
 *   • HTTP 503 (provider overloaded)
 *   • Network timeouts
 *
 * No for 4xx (request shape problem) or 5xx other than 503 (provider
 * bug — smaller model unlikely to help).
 */
export const isFallbackableError = (err) => {
  const status = Number(err?.status || err?.response?.status || 0);
  if (status === 429 || status === 503) return true;
  if (status === 502 || status === 504) return true;          // gateway / timeout
  const code = String(err?.code || "").toUpperCase();
  if (code === "ETIMEDOUT" || code === "ECONNRESET" || code === "ECONNREFUSED") return true;
  return false;
};

// ────────────────────────────────────────────────────────────────────
// Chain builder — composes the in-process fallback order from aiConfig.
// ────────────────────────────────────────────────────────────────────

/**
 * Build the default text-completion fallback chain. Entries are skipped
 * silently if their client isn't enabled (missing API key) so dev
 * environments with only one provider still work.
 *
 * Override the 8b model with AI_FAST_MODEL_FALLBACK if Groq renames it.
 */
export const buildTextFallbackChain = ({
  primaryClient = aiConfig.text.client,
  primaryModel  = aiConfig.text.model,
  primaryLabel  = aiConfig.text.label,
  groqFallbackModel = process.env.AI_FAST_MODEL_FALLBACK || "llama-3.1-8b-instant",
  geminiClient  = aiConfig.vision.client,
  geminiModel   = aiConfig.vision.model,
  geminiLabel   = aiConfig.vision.label,
} = {}) => {
  const chain = [];

  // 1. Primary text model (Groq 70b by default) — best quality.
  if (primaryClient) {
    chain.push({ client: primaryClient, model: primaryModel, label: primaryLabel });
  }

  // 2. Same Groq client, smaller model. Groq's RPM counter is
  // sometimes per-model; even if not, the 8b is way faster and the
  // TPM headroom is bigger.
  if (primaryClient && groqFallbackModel && groqFallbackModel !== primaryModel) {
    chain.push({
      client: primaryClient,
      model:  groqFallbackModel,
      label:  `${primaryLabel}-fallback-8b`,
    });
  }

  // 3. Gemini — totally separate provider, separate rate-limit
  // counter. 1M TPM is generous; only 15 RPM but if we got here Groq
  // is already saturated, so Gemini's burst budget is mostly intact.
  if (geminiClient && geminiClient !== primaryClient) {
    chain.push({ client: geminiClient, model: geminiModel, label: geminiLabel });
  }

  return chain;
};

// ────────────────────────────────────────────────────────────────────
// The core walker.
// ────────────────────────────────────────────────────────────────────

/**
 * Try each entry in order. Return the first successful response along
 * with the entry that produced it (so the controller can surface the
 * `usedProvider` to diagnostics).
 *
 * Throws the LAST error encountered if every entry was either skipped
 * or threw a fallbackable error — callers should treat this the same
 * way they treated the single-client error before (mapUpstreamError).
 *
 * Non-fallbackable errors (e.g. 400 bad request) bubble up immediately
 * from the first entry — no point trying smaller models on a malformed
 * request shape.
 *
 * @param {Object} args
 * @param {Array<{client, model, label}>} args.chain - try in this order
 * @param {Object} args.body - chat.completions.create body. We OVERRIDE
 *                             `model` from each chain entry, so callers
 *                             can pass any model and it gets replaced.
 * @param {AbortSignal} [args.signal] - forwarded to each create() call
 *                                       so walltime budget still wins.
 * @returns {Promise<{ response, usedEntry, attempts }>}
 */
export const chatWithFallback = async ({ chain, body, signal }) => {
  if (!Array.isArray(chain) || chain.length === 0) {
    throw new Error("aiFallback: empty chain — no AI provider configured");
  }

  const attempts = [];
  let lastErr = null;

  for (let i = 0; i < chain.length; i++) {
    const entry = chain[i];
    // Abort signal already tripped (walltime) — stop walking.
    if (signal?.aborted) {
      const e = new Error("walltime_exceeded");
      e.aborted = true;
      throw e;
    }

    const callBody = { ...body, model: entry.model };
    try {
      const response = await entry.client.chat.completions.create(
        callBody, { signal },
      );
      attempts.push({ label: entry.label, model: entry.model, ok: true });
      if (i > 0) {
        // We had to fall back — log loud so ops sees how often it happens.
        console.warn(chalk.yellow(
          `[aiFallback] succeeded on entry ${i + 1}/${chain.length} ` +
          `(${entry.label}) after ${i} 429/503 failure(s)`,
        ));
      }
      return { response, usedEntry: entry, attempts };
    } catch (err) {
      attempts.push({
        label: entry.label, model: entry.model, ok: false,
        status: Number(err?.status || 0),
        code: err?.code || null,
      });
      lastErr = err;

      // Non-fallbackable → don't waste budget on the rest. The user gets
      // the original error, which is the most informative.
      if (!isFallbackableError(err)) {
        throw err;
      }
      // Fallbackable + we have more entries → continue the loop.
      console.warn(chalk.yellow(
        `[aiFallback] ${entry.label} (${entry.model}) hit ${err.status || err.code} ` +
        `— ${i + 1 < chain.length ? `falling back to entry ${i + 2}` : "no more entries"}`,
      ));
    }
  }

  // Every entry exhausted. Rethrow the last error so mapUpstreamError
  // produces a proper 429/503 response. Frontend countdown + auto-retry
  // is the last line of defence.
  throw lastErr || new Error("aiFallback: chain exhausted with no error");
};

// ────────────────────────────────────────────────────────────────────
// Test exports
// ────────────────────────────────────────────────────────────────────
export const __internal = Object.freeze({
  isFallbackableError,
});
