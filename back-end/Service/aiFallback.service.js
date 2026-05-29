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
 *     1. Groq llama-3.3-70b-versatile   ← primary (best quality, 30K TPM)
 *     2. Gemini 2.0 Flash               ← fallback (different provider,
 *                                          1M TPM = handles big prompts
 *                                          even when Groq 8b can't)
 *     3. Groq llama-3.1-8b-instant      ← last resort (separate model
 *                                          counter but only 6K TPM — fine
 *                                          for short follow-ups, useless
 *                                          for big seller/admin prompts)
 *
 *   Order rationale: Phase M.3 reordered Gemini ahead of 8b because we
 *   were watching seller chats die with 70b 429 → 8b 413 (request too
 *   large) → unhandled. The seller persona's system prompt + tool
 *   catalogue clears 6K tokens easily, so 8b is the WRONG fallback for
 *   that surface. Putting Gemini second means a large prompt always
 *   survives so long as one of the two providers is up.
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
 *   • HTTP 413 (request too large — Groq returns this when the prompt
 *     exceeds the per-minute token cap on a particular model; a model
 *     with a bigger TPM budget on the next entry typically succeeds)
 *   • HTTP 503 (provider overloaded)
 *   • HTTP 502 / 504 (gateway / timeout)
 *   • Network errors (ETIMEDOUT / ECONNRESET / ECONNREFUSED)
 *   • HTTP 400 with "tool call validation failed" or "tool_use_failed"
 *     in the body — this is Groq's check that catches malformed
 *     tool-call output from the LLM (e.g. function name with args
 *     concatenated: `'search_products {"query":"..."}'`). The error
 *     is TRANSIENT (next round / different model usually works). We
 *     used to misclassify it as a request-shape bug and not retry —
 *     buyers saw "Дотоод алдаа гарлаа" when 70b had a bad sampling
 *     moment. (Phase AJ.)
 *
 * No for OTHER 4xx (legit request-shape problem — a smaller / bigger
 * model won't fix malformed JSON we sent) or 5xx other than 503
 * (provider bug — a different model is unlikely to help).
 */
export const isFallbackableError = (err) => {
  const status = Number(err?.status || err?.response?.status || 0);
  if (status === 429 || status === 503) return true;
  if (status === 413) return true;                            // payload too large
  if (status === 502 || status === 504) return true;          // gateway / timeout
  const code = String(err?.code || "").toUpperCase();
  if (code === "ETIMEDOUT" || code === "ECONNRESET" || code === "ECONNREFUSED") return true;

  // Groq-specific: 400 with malformed tool-call output from the LLM.
  // Observed wording variants on llama-3.3-70b-versatile (May 2026):
  //
  //   "tool call validation failed: attempted to call tool 'X' which was
  //    not in request.tools"
  //   "Failed to call a function. Please adjust your prompt. See
  //    'failed_generation' for more details."
  //   "tool_use_failed"
  //
  // All three mean the LLM emitted malformed tool-call JSON — TRANSIENT
  // (next round / different model usually works). We used to misclassify
  // them as request-shape bugs and not retry; buyers saw "Дотоод алдаа
  // гарлаа". Now they fall through to the next chain entry. (Phase AJ.)
  if (status === 400) {
    const msg = String(err?.message || "").toLowerCase();
    if (msg.includes("tool call validation failed")) return true;
    if (msg.includes("tool_use_failed")) return true;
    if (msg.includes("not in request.tools")) return true;
    if (msg.includes("failed to call a function")) return true;
    if (msg.includes("failed_generation")) return true;
  }
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

  // 1. Primary text model (Groq 70b by default) — best quality, 30K TPM.
  if (primaryClient) {
    chain.push({ client: primaryClient, model: primaryModel, label: primaryLabel });
  }

  // 2. Gemini — totally separate provider, separate rate-limit counter,
  // 1M TPM. Phase M.3: PROMOTED ahead of Groq 8b because we were seeing
  // seller chats die with 70b 429 → 8b 413 (request too large) since
  // 8b's 6K TPM can't fit the seller system prompt + tool catalogue.
  // Putting Gemini here means a big prompt survives whenever EITHER
  // provider is up.
  if (geminiClient && geminiClient !== primaryClient) {
    chain.push({ client: geminiClient, model: geminiModel, label: geminiLabel });
  }

  // 3. Last resort: same Groq client, smaller model. Groq's RPM counter
  // is sometimes per-model, so 8b may serve when 70b is throttled — but
  // its TPM cap (6K free tier) makes it unsuitable for large prompts.
  // Kept in the chain for the case where Gemini is ALSO down or
  // unconfigured; for tiny user follow-ups it works fine.
  if (primaryClient && groqFallbackModel && groqFallbackModel !== primaryModel) {
    chain.push({
      client: primaryClient,
      model:  groqFallbackModel,
      label:  `${primaryLabel}-fallback-8b`,
    });
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
/**
 * Rough token estimator — char-count / 3.5 is empirically close for
 * mixed Mongolian+English+JSON content. Used ONLY as a pre-flight check
 * to decide whether a small-context model (e.g. Groq 8b free tier with
 * 6K TPM) is even worth trying. Off-by-200 is fine; we use a 5500 cap.
 */
const estimateBodyTokens = (body) => {
  try {
    const j = JSON.stringify(body || {});
    return Math.ceil(j.length / 3.5);
  } catch {
    return 0;
  }
};

/**
 * Per-entry token cap. If the body is larger than this, the chain
 * walker skips the entry rather than incurring a guaranteed 413.
 * Keyed by model substring so renames don't break the guard.
 */
// Cap is INTENTIONALLY low (4000) because:
// (a) Groq counts tool-schema tokens differently than naive JSON.stringify
//     — the gap is ~900-1500 tokens for our 10-tool schema.
// (b) The free-tier limit is 6000 tokens-per-minute, so even if a single
//     request fits, two back-to-back ones will 429.
// Setting the cap at 4000 means: only TINY follow-ups (e.g. "хэр хүлээх вэ?"
// after an item is already selected) reach 8B. Cold-start chats with full
// system prompt skip straight to Gemini, which has 1M TPM headroom.
const ENTRY_TOKEN_CAP = [
  { match: /8b/i,           cap: 3000 },   // Groq llama-3.1-8b-instant free tier
  { match: /llama-3\.1-8b/, cap: 3000 },
];

const capForEntry = (entry) => {
  const m = entry?.model || "";
  for (const r of ENTRY_TOKEN_CAP) if (r.match.test(m)) return r.cap;
  return Infinity;
};

export const chatWithFallback = async ({ chain, body, signal }) => {
  if (!Array.isArray(chain) || chain.length === 0) {
    throw new Error("aiFallback: empty chain — no AI provider configured");
  }

  const attempts = [];
  let lastErr = null;
  const estTokens = estimateBodyTokens(body);

  for (let i = 0; i < chain.length; i++) {
    const entry = chain[i];
    // Abort signal already tripped (walltime) — stop walking.
    if (signal?.aborted) {
      const e = new Error("walltime_exceeded");
      e.aborted = true;
      throw e;
    }

    // Phase AP: pre-flight token guard. Skip entries whose model can't
    // fit the prompt — saves a guaranteed-413 round-trip and lets the
    // chain walker reach the next viable provider faster.
    const cap = capForEntry(entry);
    if (estTokens > cap) {
      attempts.push({
        label: entry.label, model: entry.model, ok: false,
        skipped: "token-cap", estTokens, cap,
      });
      console.warn(chalk.dim(
        `[aiFallback] skipping ${entry.label} (${entry.model}) — ~${estTokens}t exceeds ${cap}t cap`,
      ));
      continue;
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
