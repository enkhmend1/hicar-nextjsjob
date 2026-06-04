/**
 * Correction service — applies a human fix and turns it into learning.
 *
 * Flow (the self-improving flywheel):
 *   1. Set the corrected field to the human value (source=human, confidence=1.0
 *      — authoritative; survives future re-normalization via the pipeline's
 *      human carry-over).
 *   2. Re-score the listing and persist.
 *   3. Record the Correction + a hash-chained change_log entry.
 *   4. If a partType correction carries a rawToken, UPSERT it into part_aliases
 *      → the next occurrence resolves deterministically (no AI).
 *   5. Enqueue re-normalization of OTHER raws containing that token so they
 *      benefit immediately.
 */

import { Types } from "mongoose";
import {
  NormalizedProductModel,
  type FieldResolution,
  type ResolutionSource,
  type NormalizedStatus,
} from "../normalization/normalizedProduct.model.js";
import { scoreFields } from "../normalization/stages/confidence.js";
import type { PipelineFields } from "../normalization/pipeline.types.js";
import { enqueueNormalize } from "../normalization/normalize.queue.js";
import { enqueueIndex } from "../search/index.queue.js";
import { RawProductModel } from "../ingestion/rawProduct.model.js";
import { CanonicalPartModel } from "../catalog/canonicalPart.model.js";
import { PartAliasModel, type AliasLang } from "../catalog/partAlias.model.js";
import { invalidateAliasCache } from "../catalog/aliasCache.js";
import { CorrectionModel, type CorrectableField } from "./correction.model.js";
import { appendChange } from "./changeLog.service.js";
import { normalizeText } from "../../shared/text.js";
import { NotFoundError, ValidationError } from "../../shared/errors.js";
import { logger } from "../../shared/logger.js";

const REPROCESS_LIMIT = 200;

export interface ApplyCorrectionInput {
  normalizedProductId: string;
  field: CorrectableField;
  newValue: string;
  rawToken?: string;
  correctedBy: string;
  role: "admin" | "seller";
}

export interface ApplyCorrectionResult {
  normalizedProductId: string;
  field: CorrectableField;
  oldValue: string | null;
  newValue: string;
  overall: number;
  status: NormalizedStatus;
  aliasLearned: boolean;
  reprocessQueued: number;
}

function toFieldResolution(value: unknown): FieldResolution<string> {
  const o = (value ?? {}) as {
    value?: string | null;
    confidence?: number;
    source?: ResolutionSource;
    evidence?: string;
  };
  return {
    value: o.value ?? null,
    confidence: typeof o.confidence === "number" ? o.confidence : 0,
    source: o.source ?? "regex",
    evidence: o.evidence,
  };
}

function detectLang(token: string): AliasLang {
  return /[Ѐ-ӿ]/.test(token) ? "mn-cyrl" : "mn-latn";
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Enqueue re-normalization of other raws whose title contains `token`. */
export async function reprocessByToken(token: string, excludeRawId: Types.ObjectId): Promise<number> {
  const rx = new RegExp(escapeRegex(token.trim()), "i");
  const raws = await RawProductModel.find({ _id: { $ne: excludeRawId }, rawTitle: rx })
    .select("_id")
    .limit(REPROCESS_LIMIT)
    .lean();
  for (const r of raws) await enqueueNormalize(String(r._id));
  return raws.length;
}

export async function applyCorrection(input: ApplyCorrectionInput): Promise<ApplyCorrectionResult> {
  const field = input.field;
  const newValue = input.newValue.trim();
  if (!newValue) throw new ValidationError("newValue хоосон байж болохгүй");

  // Read-only snapshot: used for `before` values and confidence re-scoring.
  // The actual write is a single atomic findByIdAndUpdate below so two
  // concurrent corrections to the same document cannot clobber each other.
  const snapshot = await NormalizedProductModel.findById(input.normalizedProductId).lean();
  if (!snapshot) throw new NotFoundError("Normalized бараа олдсонгүй");

  const before = toFieldResolution(snapshot[field] as unknown);
  const oldValue = before.value;
  const actor = new Types.ObjectId(input.correctedBy);

  const human: FieldResolution<string> = {
    value: newValue,
    confidence: 1,
    source: "human",
    evidence: `correction:${input.correctedBy}`,
  };

  // A partType correction also relinks the canonical part.
  let canonicalPartId = snapshot.canonicalPartId ?? null;
  if (field === "partType") {
    const part = await CanonicalPartModel.findOne({ canonicalPartName: newValue }).select("_id").lean();
    canonicalPartId = part?._id ?? null;
  }

  // Re-score: merge the human value into the snapshot field set and re-compute.
  const scoringFields: PipelineFields = {
    canonicalBrand: toFieldResolution(snapshot.canonicalBrand as unknown),
    canonicalModel: toFieldResolution(snapshot.canonicalModel as unknown),
    generation: toFieldResolution(snapshot.generation as unknown),
    partType: toFieldResolution(snapshot.partType as unknown),
    oem: toFieldResolution(snapshot.oem as unknown),
  };
  scoringFields[field] = human;
  const { overall, status } = scoreFields(scoringFields);

  // Atomic write — no read-modify-write race.
  const updateDoc: Record<string, unknown> = {
    [field]: human,
    overallConfidence: overall,
    status,
  };
  if (field === "partType") updateDoc.canonicalPartId = canonicalPartId;

  const normalized = await NormalizedProductModel.findByIdAndUpdate(
    input.normalizedProductId,
    { $set: updateDoc },
    { returnDocument: "after" },
  );
  if (!normalized) throw new NotFoundError("Normalized бараа олдсонгүй");

  const correction = await CorrectionModel.create({
    normalizedProductId: normalized._id,
    rawProductId: normalized.rawProductId,
    field,
    oldValue,
    newValue,
    rawToken: input.rawToken,
    correctedBy: actor,
    role: input.role,
    appliedToDictionary: false,
  });

  await appendChange({
    entity: "normalized_product",
    entityId: normalized._id,
    op: "update",
    actor,
    before: { [field]: before },
    after: { [field]: human, overallConfidence: overall, status },
  });

  // Grow the dictionary: partType + rawToken + a resolved canonical part.
  let aliasLearned = false;
  if (field === "partType" && input.rawToken && canonicalPartId) {
    const aliasText = normalizeText(input.rawToken);
    const res = await PartAliasModel.updateOne(
      { alias: aliasText, canonicalPartId },
      {
        $set: { lang: detectLang(input.rawToken), weight: 1, addedBy: input.role },
        $setOnInsert: { alias: aliasText, canonicalPartId, hitCount: 0 },
      },
      { upsert: true },
    );
    aliasLearned = (res.upsertedCount ?? 0) > 0 || (res.modifiedCount ?? 0) > 0;
    invalidateAliasCache();
    correction.appliedToDictionary = true;
    await correction.save();

    if ((res.upsertedCount ?? 0) > 0) {
      const aliasDoc = await PartAliasModel.findOne({ alias: aliasText, canonicalPartId }).select("_id").lean();
      if (aliasDoc) {
        await appendChange({
          entity: "part_alias",
          entityId: aliasDoc._id,
          op: "create",
          actor,
          after: { alias: aliasText, canonicalPartId: String(canonicalPartId), weight: 1 },
        });
      }
    }
  }

  // Re-index this listing so search reflects the correction immediately.
  await enqueueIndex(String(normalized._id)).catch(() => {});

  // Flywheel: re-normalize other listings that contain this token.
  let reprocessQueued = 0;
  if (aliasLearned && input.rawToken) {
    reprocessQueued = await reprocessByToken(input.rawToken, normalized.rawProductId);
  }

  logger.info("correction.applied", {
    normalizedProductId: String(normalized._id),
    field,
    aliasLearned,
    reprocessQueued,
  });

  return {
    normalizedProductId: String(normalized._id),
    field,
    oldValue,
    newValue,
    overall,
    status,
    aliasLearned,
    reprocessQueued,
  };
}

/** List corrections for one normalized product (audit trail). */
export async function listCorrections(normalizedProductId: string, limit = 50) {
  return CorrectionModel.find({ normalizedProductId: new Types.ObjectId(normalizedProductId) })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
}
