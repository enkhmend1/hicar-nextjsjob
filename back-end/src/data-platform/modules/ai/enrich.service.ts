/**
 * AI enrichment service. Calls the model for the unresolved fields, validates
 * the output with zod, and returns clean values plus a DISCOUNTED confidence.
 *
 * Why discount: LLMs are systematically overconfident. AI confidence is capped
 * at AI_CONF_CAP (0.6), strictly below every deterministic prior (alias 0.95,
 * regex 0.9, vehicleParser 0.85) and human (1.0). Consequence: an AI-only
 * interpretation can never auto-approve — it always lands in the review queue,
 * where a human confirm turns it into a permanent alias. AI proposes; humans
 * (and rules) dispose.
 */

import { z } from "zod";
import { emitFields, aiEnrichEnabled } from "./aiClient.js";
import { buildEnrichMessages, type EnrichPromptInput } from "./enrich.prompt.js";

export type AiEnrichField =
  | "partType"
  | "canonicalBrand"
  | "canonicalModel"
  | "generation"
  | "oem";

const AI_FIELD_LIST: AiEnrichField[] = [
  "partType",
  "canonicalBrand",
  "canonicalModel",
  "generation",
  "oem",
];

const AI_CONF_CAP = 0.6;

const aiOutputSchema = z.object({
  partType: z.string().trim().min(1).nullable().optional(),
  canonicalBrand: z.string().trim().min(1).nullable().optional(),
  canonicalModel: z.string().trim().min(1).nullable().optional(),
  generation: z.string().trim().min(1).nullable().optional(),
  oem: z.string().trim().min(1).nullable().optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export interface EnrichResult {
  values: Partial<Record<AiEnrichField, string>>;
  confidence: number;
}

export async function enrichFields(input: EnrichPromptInput): Promise<EnrichResult | null> {
  if (!aiEnrichEnabled()) return null;

  const raw = await emitFields(buildEnrichMessages(input));
  if (!raw) return null;

  const parsed = aiOutputSchema.safeParse(raw);
  if (!parsed.success) return null;
  const data = parsed.data;

  const self = typeof data.confidence === "number" ? data.confidence : 0.5;
  const confidence = Math.min(AI_CONF_CAP, Math.max(0, self * 0.7));

  const values: Partial<Record<AiEnrichField, string>> = {};
  for (const field of AI_FIELD_LIST) {
    const v = data[field];
    if (typeof v === "string" && v.trim()) values[field] = v.trim();
  }

  return { values, confidence };
}
