/**
 * Review queue — surfaces the interpretations a human should check, lowest
 * confidence first. Each item is joined with its raw context (what the seller
 * actually wrote) so the reviewer can judge and correct in one screen.
 *
 * Ranking is confidence-ascending. Demand-weighting (popular parts first, using
 * the legacy searchLog signal) is a documented follow-up — it requires reading
 * a cross-context collection.
 */

import { NormalizedProductModel, type NormalizedStatus } from "../normalization/normalizedProduct.model.js";
import { RawProductModel } from "../ingestion/rawProduct.model.js";

const REVIEWABLE: NormalizedStatus[] = ["needs_review", "rejected"];

export interface ReviewQueueParams {
  status?: NormalizedStatus;
  limit?: number;
  skip?: number;
}

export async function listReviewQueue(params: ReviewQueueParams) {
  const limit = Math.min(Math.max(params.limit ?? 25, 1), 100);
  const skip = Math.max(params.skip ?? 0, 0);
  const filter =
    params.status && REVIEWABLE.includes(params.status)
      ? { status: params.status }
      : { status: { $in: REVIEWABLE } };

  const [items, total] = await Promise.all([
    NormalizedProductModel.find(filter)
      .sort({ overallConfidence: 1, updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    NormalizedProductModel.countDocuments(filter),
  ]);

  // Join raw context for the reviewer (what the seller actually typed).
  const rawIds = items.map((i) => i.rawProductId);
  const raws = await RawProductModel.find({ _id: { $in: rawIds } })
    .select("rawTitle rawOem rawBrand sellerId")
    .lean();
  const rawById = new Map(raws.map((r) => [String(r._id), r]));

  const rows = items.map((item) => ({
    ...item,
    raw: rawById.get(String(item.rawProductId)) ?? null,
  }));

  return { total, limit, skip, items: rows };
}
