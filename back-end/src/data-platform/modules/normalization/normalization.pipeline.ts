/**
 * Normalization pipeline orchestrator (M2 — rules only).
 *
 * Runs the deterministic stages in order, fuses confidence, links to canonical,
 * and writes a VERSIONED normalized_products document with per-field provenance.
 * Re-running supersedes the previous interpretation (raw is never touched), so a
 * better pipeline/dictionary can reprocess history losslessly.
 *
 * AI enrichment (stage 5) is added in M4 — it will fill ONLY the fields the
 * rules left unresolved, with a discounted confidence.
 */

import { RawProductModel } from "../ingestion/rawProduct.model.js";
import { NormalizedProductModel } from "./normalizedProduct.model.js";
import { stageClean } from "./stages/clean.js";
import { stageOem } from "./stages/oem.js";
import { stageAlias } from "./stages/alias.js";
import { stageVehicle } from "./stages/vehicle.js";
import { stageAiEnrich } from "./stages/aiEnrich.js";
import { stageConfidence } from "./stages/confidence.js";
import { stageLink } from "./stages/link.js";
import { unresolved, type PipelineContext, type PipelineFields } from "./pipeline.types.js";
import type { FieldResolution } from "./normalizedProduct.model.js";
import { enqueueIndex } from "../search/index.queue.js";
import { mirrorImagesToCloudinary } from "../../services/image.pipeline.js";
import { logger } from "../../shared/logger.js";

export const PIPELINE_VERSION = "m4-rules+ai-1";

// Fields that a human may correct; carried forward on re-normalization so the
// rules can never overwrite an authoritative human edit.
const HUMAN_CARRY_FIELDS: (keyof PipelineFields)[] = [
  "canonicalBrand", "canonicalModel", "generation", "partType", "oem",
];

export async function normalizeRawProduct(rawProductId: string): Promise<void> {
  const raw = await RawProductModel.findById(rawProductId);
  if (!raw) {
    logger.warn("normalize.raw_missing", { rawProductId });
    return;
  }

  raw.status = "normalizing";
  await raw.save();

  const ctx: PipelineContext = {
    raw,
    cleanedText: "",
    tokens: [],
    cyrillicTokens: [],
    fields: {
      canonicalBrand: unresolved(),
      canonicalModel: unresolved(),
      generation: unresolved(),
      partType: unresolved(),
      oem: unresolved(),
    },
    canonicalPartId: null,
    pipelineVersion: PIPELINE_VERSION,
  };

  try {
    // Deterministic-first ordering: cheap, explainable signals before anything else.
    stageClean(ctx);
    stageOem(ctx);
    await stageAlias(ctx);
    stageVehicle(ctx);

    // Fetch the previous interpretation (for versioning AND human carry-over).
    const prev = await NormalizedProductModel.findOne({ rawProductId: raw._id })
      .sort({ version: -1 })
      .lean();

    // Human edits are authoritative: re-running the rules must never clobber a
    // correction. Carry any human-sourced field forward into this version.
    if (prev) {
      for (const f of HUMAN_CARRY_FIELDS) {
        const pf = prev[f] as FieldResolution<string> | undefined;
        if (pf && pf.source === "human" && pf.value != null) {
          ctx.fields[f] = {
            value: pf.value,
            confidence: pf.confidence,
            source: "human",
            evidence: pf.evidence,
          };
          if (f === "partType" && prev.canonicalPartId) ctx.canonicalPartId = prev.canonicalPartId;
        }
      }
    }

    // Stage 5 — AI fills ONLY what rules + human carry-over left unresolved.
    // No-op (and never throws) when AI is disabled.
    await stageAiEnrich(ctx);

    const { overall, status } = stageConfidence(ctx);
    await stageLink(ctx);

    // Mirror seller images into Cloudinary on first normalisation. Carry the
    // existing publicIds forward on re-runs to avoid redundant re-uploads.
    // Best-effort: a Cloudinary failure here must never fail the whole pipeline.
    let imagePublicIds: string[] = prev?.imagePublicIds ?? [];
    if (imagePublicIds.length === 0 && raw.images.length > 0) {
      try {
        const identifier = ctx.fields.oem.value?.trim() || String(raw._id);
        imagePublicIds = await mirrorImagesToCloudinary(raw.images, "canonical", identifier);
      } catch (imgErr) {
        logger.warn("normalize.image_mirror_failed", {
          rawProductId,
          err: (imgErr as Error).message,
        });
      }
    }

    // Versioning: supersede any prior interpretation for this raw row.
    const version = prev ? prev.version + 1 : 1;
    if (prev) {
      await NormalizedProductModel.updateMany(
        { rawProductId: raw._id, status: { $ne: "superseded" } },
        { $set: { status: "superseded" } },
      );
    }

    const created = await NormalizedProductModel.create({
      rawProductId: raw._id,
      sellerId: raw.sellerId,
      version,
      pipelineVersion: PIPELINE_VERSION,
      canonicalPartId: ctx.canonicalPartId,
      canonicalBrand: ctx.fields.canonicalBrand,
      canonicalModel: ctx.fields.canonicalModel,
      generation: ctx.fields.generation,
      partType: ctx.fields.partType,
      oem: ctx.fields.oem,
      attributes: {},
      imagePublicIds,
      overallConfidence: overall,
      status,
    });

    raw.status = "normalized";
    await raw.save();

    // Sync the search read model (CQRS). Best-effort — search must never block
    // or fail normalization; the indexer also no-ops when search is disabled.
    try {
      await enqueueIndex(String(created._id));
    } catch (e) {
      logger.warn("index.enqueue_failed", { rawProductId, err: (e as Error).message });
    }
    logger.info("normalize.done", {
      rawProductId,
      version,
      status,
      overall,
      partType: ctx.fields.partType.value,
      brand: ctx.fields.canonicalBrand.value,
      generation: ctx.fields.generation.value,
    });
  } catch (err) {
    // 11000 = duplicate key on the unique {rawProductId, version} index.
    // Another worker won the race and already wrote this version — our work is
    // redundant, not failed. Leave raw.status as-is and exit cleanly.
    if ((err as { code?: number }).code === 11000) {
      logger.warn("normalize.version_conflict", { rawProductId, version: "unknown" });
      return;
    }
    raw.status = "failed";
    await raw.save().catch(() => {});
    logger.error("normalize.failed", { rawProductId, err: (err as Error).message });
    throw err; // surface to BullMQ for retry
  }
}
