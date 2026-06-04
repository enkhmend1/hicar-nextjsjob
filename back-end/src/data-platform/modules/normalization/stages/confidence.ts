/**
 * STAGE 6 — CONFIDENCE FUSION + ROUTING.
 *
 * partType is the ANCHOR: a listing we can't classify is near-useless. The
 * overall score is the partType confidence (weighted 0.8) plus bonuses for
 * each additional resolved signal (OEM, brand, model, generation). An item
 * with a strong part match AND vehicle context clears the auto-approve bar;
 * a bare part match lands in review; nothing resolved → rejected.
 *
 *   overall ≥ 0.90  → auto_approved (publish)
 *   0 < overall<0.9 → needs_review (held / flagged)
 *   nothing          → rejected
 */

import type { PipelineContext, PipelineFields } from "../pipeline.types.js";
import type { FieldResolution, NormalizedStatus } from "../normalizedProduct.model.js";

const resolved = (f: FieldResolution<string>): boolean => f.value != null && f.confidence > 0;
const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Pure confidence fusion over a resolved-field set. Shared by the pipeline
 * (stage 6) and the correction service (which re-scores after a human edit),
 * so the scoring rule lives in exactly one place.
 */
export function scoreFields(fields: PipelineFields): { overall: number; status: NormalizedStatus } {
  const { partType, oem, canonicalBrand, canonicalModel, generation } = fields;

  let overall = 0;
  let status: NormalizedStatus;

  if (resolved(partType)) {
    overall = partType.confidence * 0.8;
    if (resolved(oem)) overall += 0.1;
    if (resolved(canonicalBrand)) overall += 0.06;
    if (resolved(canonicalModel)) overall += 0.04;
    if (resolved(generation)) overall += 0.05;
    overall = Math.min(1, overall);
    status = overall >= 0.9 ? "auto_approved" : "needs_review";
  } else if (resolved(oem)) {
    // OEM but no part type: identifiable later via catalog → hold for review.
    overall = 0.5;
    status = "needs_review";
  } else {
    overall = 0;
    status = "rejected";
  }

  return { overall: round2(overall), status };
}

export function stageConfidence(ctx: PipelineContext): { overall: number; status: NormalizedStatus } {
  return scoreFields(ctx.fields);
}
