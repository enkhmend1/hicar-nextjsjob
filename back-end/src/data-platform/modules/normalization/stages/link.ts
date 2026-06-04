/**
 * STAGE 7 — CANONICAL LINK + DEDUPE.
 *
 * In the common case the alias stage already set `canonicalPartId` (an alias
 * carries its part link). This stage covers the residual: a partType resolved
 * by other means is linked to canonical_parts by name. It also bumps the
 * matched alias's hit counter (telemetry for the review queue).
 *
 * Cross-listing duplicate MERGING (embedding similarity) is intentionally
 * deferred to M6 — at M2 we link the PART, we don't merge OFFERS.
 */

import { CanonicalPartModel } from "../../catalog/canonicalPart.model.js";
import { PartAliasModel } from "../../catalog/partAlias.model.js";
import type { PipelineContext } from "../pipeline.types.js";

export async function stageLink(ctx: PipelineContext): Promise<void> {
  if (!ctx.canonicalPartId && ctx.fields.partType.value) {
    const part = await CanonicalPartModel.findOne({ canonicalPartName: ctx.fields.partType.value })
      .select("_id")
      .lean();
    if (part) ctx.canonicalPartId = part._id;
  }

  // Telemetry: count alias usage so M3's review queue can rank by demand.
  if (ctx.fields.partType.source === "alias" && ctx.fields.partType.evidence) {
    await PartAliasModel.updateOne(
      { alias: ctx.fields.partType.evidence },
      { $inc: { hitCount: 1 } },
    ).catch(() => {}); // telemetry must never fail the pipeline
  }
}
