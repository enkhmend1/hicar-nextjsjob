/**
 * STAGE 5 — AI ENRICH (gap-fill). Runs AFTER the deterministic rules AND after
 * human carry-over, so it only ever fills fields nothing else could resolve.
 * AI output is written with source="ai" and a discounted confidence (see
 * enrich.service). partType is constrained to the canonical catalog — the model
 * may pick an existing part type, never invent one.
 *
 * Fully optional: if AI is disabled or the call fails, this is a no-op and the
 * pipeline proceeds with the rules-only result.
 */

import { enrichFields, type AiEnrichField } from "../../ai/enrich.service.js";
import { getCanonicalPartNames } from "../../catalog/canonicalCache.js";
import type { PipelineContext, PipelineFields } from "../pipeline.types.js";

const AI_FIELDS: (keyof PipelineFields)[] = [
  "partType",
  "canonicalBrand",
  "canonicalModel",
  "generation",
  "oem",
];

export async function stageAiEnrich(ctx: PipelineContext): Promise<void> {
  const missing = AI_FIELDS.filter((f) => ctx.fields[f].value == null);
  if (missing.length === 0) return; // rules + human already resolved everything

  const needsPartType = missing.includes("partType");
  const allowedPartTypes = needsPartType ? await getCanonicalPartNames() : [];

  const resolved: Record<string, string | null> = {};
  for (const f of AI_FIELDS) resolved[f] = ctx.fields[f].value;

  const result = await enrichFields({
    cleanedText: ctx.cleanedText,
    resolved,
    missing: missing as string[],
    allowedPartTypes,
  });
  if (!result) return; // AI disabled or failed → rules-only result stands

  for (const f of missing) {
    const value = result.values[f as AiEnrichField];
    if (!value) continue;
    // Guard: never let AI introduce a part type outside the governed catalog.
    if (f === "partType" && allowedPartTypes.length > 0 && !allowedPartTypes.includes(value)) {
      continue;
    }
    ctx.fields[f] = { value, confidence: result.confidence, source: "ai", evidence: "groq" };
  }
}
