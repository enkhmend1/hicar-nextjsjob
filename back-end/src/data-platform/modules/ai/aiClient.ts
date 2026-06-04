/**
 * Self-contained, typed AI client for the data platform — Anthropic Claude
 * (Haiku by default, via ANTHROPIC_API_KEY + DP_AI_MODEL).
 *
 * Hard guarantees:
 *   • never throws — every failure path returns null so the pipeline degrades
 *     gracefully to rules-only,
 *   • lazy, cached client build (boot never depends on AI),
 *   • FORCED TOOL USE for structured output: the model is required to answer by
 *     calling a tool, so we always get a schema-shaped object (no prose, no
 *     JSON-in-markdown to scrape), temperature 0 for determinism.
 *
 * Two structured entry points:
 *   • emitFields() — enrich gap-fill, forced into the fixed `emit_fields` schema.
 *   • chatJson()   — generic JSON producer (free-form object) used by the import
 *                    column-header mapper, whose keys are dynamic per file.
 */

import Anthropic from "@anthropic-ai/sdk";
import { env } from "../../shared/env.js";
import { logger } from "../../shared/logger.js";

let client: Anthropic | null = null;
let initialized = false;

function getClient(): Anthropic | null {
  if (initialized) return client;
  initialized = true;
  if (!env.anthropicApiKey) {
    logger.info("ai.disabled", { reason: "ANTHROPIC_API_KEY not set" });
    return null;
  }
  try {
    client = new Anthropic({
      apiKey: env.anthropicApiKey,
      maxRetries: env.aiMaxRetries,
      timeout: env.aiTimeoutMs,
    });
    logger.info("ai.enabled", { model: env.dpAiModel });
  } catch (err) {
    logger.error("ai.init_failed", { err: (err as Error).message });
    client = null;
  }
  return client;
}

export function aiEnrichEnabled(): boolean {
  return env.aiEnrichEnabled && getClient() !== null;
}

export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

// ── Forced-tool definitions ─────────────────────────────────────────
// The model MUST answer by calling the tool, so its `input` is guaranteed
// to be a structured object. Anthropic does not strictly validate input
// against the schema, so a downstream zod parse still owns correctness.

/** Enrich gap-fill — fixed field shape (validated by enrich.service zod). */
const EMIT_FIELDS_TOOL: Anthropic.Tool = {
  name: "emit_fields",
  description:
    "Return the normalized automotive-part fields you inferred. " +
    "Use null for any field you cannot confidently determine.",
  input_schema: {
    type: "object",
    properties: {
      partType: { type: "string", description: "exactly one value from allowedPartTypes, or null" },
      canonicalBrand: { type: "string", description: "canonical English brand, or null" },
      canonicalModel: { type: "string", description: "canonical English model, or null" },
      generation: { type: "string", description: "chassis/generation code, or null" },
      oem: { type: "string", description: "OEM code if clearly present, or null" },
      confidence: { type: "number", description: "overall 0..1 certainty" },
    },
  },
};

/** Generic JSON producer — free-form object whose keys are dynamic. */
const EMIT_JSON_TOOL: Anthropic.Tool = {
  name: "emit_json",
  description:
    "Return your answer as a single JSON object matching the structure " +
    "described in the system instructions.",
  input_schema: { type: "object" },
};

/**
 * One forced-tool completion. Returns the tool's `input` object, or null on ANY
 * failure (disabled, network, no tool block) — callers must treat null as
 * "AI unavailable". System messages are merged into the Anthropic `system`
 * param; user messages become the conversation turns.
 */
async function callForcedTool(
  messages: ChatMessage[],
  tool: Anthropic.Tool,
  maxTokens: number,
): Promise<Record<string, unknown> | null> {
  const c = getClient();
  if (!c) return null;
  try {
    const system = messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const userMsgs: Anthropic.MessageParam[] = messages
      .filter((m) => m.role === "user")
      .map((m) => ({ role: "user", content: m.content }));

    const resp = await c.messages.create({
      model: env.dpAiModel,
      max_tokens: maxTokens,
      temperature: 0,
      ...(system ? { system } : {}),
      messages: userMsgs,
      tools: [tool],
      tool_choice: { type: "tool", name: tool.name },
    });

    const block = resp.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    if (!block) return null;
    const input = block.input;
    return input && typeof input === "object" ? (input as Record<string, unknown>) : null;
  } catch (err) {
    logger.warn("ai.chat_failed", { err: (err as Error).message });
    return null;
  }
}

/**
 * Enrich gap-fill — forced into the `emit_fields` schema. Returns the raw tool
 * input (validated downstream by enrich.service's zod). Null = AI unavailable.
 */
export function emitFields(
  messages: ChatMessage[],
  maxTokens = 300,
): Promise<Record<string, unknown> | null> {
  return callForcedTool(messages, EMIT_FIELDS_TOOL, maxTokens);
}

/**
 * Generic JSON completion — free-form object (e.g. dynamic header→field map for
 * the import column mapper). Null = AI unavailable.
 */
export function chatJson(
  messages: ChatMessage[],
  maxTokens = 300,
): Promise<Record<string, unknown> | null> {
  return callForcedTool(messages, EMIT_JSON_TOOL, maxTokens);
}
