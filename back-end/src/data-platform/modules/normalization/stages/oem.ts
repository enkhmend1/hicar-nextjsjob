/**
 * STAGE 2 — OEM. The highest-signal token. Prefers the seller's dedicated
 * `rawOem` field (high trust); otherwise scans the title for an OEM-shaped
 * code. A light normalization (uppercase, strip spaces) is applied; aggressive
 * OCR fuzzy-correction (reusing the legacy ocrFuzzy.service) is deferred to a
 * later pass to avoid corrupting valid codes here.
 */

import type { PipelineContext } from "../pipeline.types.js";

// Toyota-style "81150-47120"; then a looser alphanumeric-with-dash fallback.
const TOYOTA_OEM = /\b\d{5}-[0-9A-Z]{5}\b/i;
const GENERIC_OEM = /\b[A-Z0-9]{3,}-[A-Z0-9]{2,}\b/i;

function tidyOem(code: string): string {
  return code.toUpperCase().replace(/\s+/g, "");
}

export function stageOem(ctx: PipelineContext): void {
  const fromField = ctx.raw.rawOem?.trim();
  if (fromField) {
    ctx.fields.oem = {
      value: tidyOem(fromField),
      confidence: 0.98,
      source: "oem",
      evidence: "rawOem",
    };
    return;
  }

  const upper = ctx.cleanedText.toUpperCase();
  const match = TOYOTA_OEM.exec(upper) ?? GENERIC_OEM.exec(upper);
  if (match) {
    ctx.fields.oem = {
      value: tidyOem(match[0]),
      confidence: 0.9,
      source: "regex",
      evidence: "title",
    };
  }
}
