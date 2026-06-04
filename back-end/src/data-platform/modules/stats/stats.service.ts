/**
 * Aggregate stats for the admin overview widget — counts across the three
 * layers + the feedback loop. Uses estimatedDocumentCount / lightweight
 * aggregations so it's cheap enough to poll.
 */

import type { Model } from "mongoose";
import { RawProductModel } from "../ingestion/rawProduct.model.js";
import { NormalizedProductModel } from "../normalization/normalizedProduct.model.js";
import { CanonicalPartModel } from "../catalog/canonicalPart.model.js";
import { PartAliasModel } from "../catalog/partAlias.model.js";
import { CorrectionModel } from "../feedback/correction.model.js";

export interface PlatformStats {
  raw: { total: number; byStatus: Record<string, number> };
  normalized: {
    total: number;
    byStatus: Record<string, number>;
    avgConfidence: number;
    reviewable: number;
  };
  catalog: { parts: number; aliases: number };
  corrections: { total: number };
}

async function groupCountByStatus<T>(model: Model<T>): Promise<Record<string, number>> {
  const rows = await model.aggregate<{ _id: string; n: number }>([
    { $group: { _id: "$status", n: { $sum: 1 } } },
  ]);
  const out: Record<string, number> = {};
  for (const r of rows) out[String(r._id)] = r.n;
  return out;
}

export async function getPlatformStats(): Promise<PlatformStats> {
  const [rawTotal, rawByStatus, normTotal, normByStatus, confAgg, parts, aliases, corrections] =
    await Promise.all([
      RawProductModel.estimatedDocumentCount(),
      groupCountByStatus(RawProductModel),
      NormalizedProductModel.estimatedDocumentCount(),
      groupCountByStatus(NormalizedProductModel),
      NormalizedProductModel.aggregate<{ avg: number }>([
        { $match: { status: { $ne: "superseded" } } },
        { $group: { _id: null, avg: { $avg: "$overallConfidence" } } },
      ]),
      CanonicalPartModel.estimatedDocumentCount(),
      PartAliasModel.estimatedDocumentCount(),
      CorrectionModel.estimatedDocumentCount(),
    ]);

  const reviewable = (normByStatus.needs_review ?? 0) + (normByStatus.rejected ?? 0);
  const avgConfidence = Math.round((confAgg[0]?.avg ?? 0) * 100) / 100;

  return {
    raw: { total: rawTotal, byStatus: rawByStatus },
    normalized: { total: normTotal, byStatus: normByStatus, avgConfidence, reviewable },
    catalog: { parts, aliases },
    corrections: { total: corrections },
  };
}
