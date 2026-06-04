/**
 * Indexer — syncs one normalized listing into Typesense.
 *
 *   • publishable (auto_approved / needs_review) → upsert the projection
 *   • otherwise (rejected / superseded / gone)   → delete from the index
 *
 * Keyed by rawProductId, so re-normalization REPLACES the listing rather than
 * piling up stale versions. No-ops when search is disabled.
 */

import { getTypesense } from "./typesense.client.js";
import { env } from "../../shared/env.js";
import { NormalizedProductModel } from "../normalization/normalizedProduct.model.js";
import { RawProductModel } from "../ingestion/rawProduct.model.js";
import { PartAliasModel } from "../catalog/partAlias.model.js";
import { buildListingDoc, isPublishable } from "./listing.projection.js";
import { logger } from "../../shared/logger.js";

export async function indexNormalized(normalizedProductId: string): Promise<void> {
  const client = getTypesense();
  if (!client) return; // search disabled → no-op

  const normalized = await NormalizedProductModel.findById(normalizedProductId).lean();
  const collection = client.collections(env.typesenseCollection);

  // Gone or not publishable → remove from the index (idempotent).
  if (!normalized || !isPublishable(normalized.status)) {
    const rawId = normalized ? String(normalized.rawProductId) : null;
    if (rawId) {
      try {
        await collection.documents(rawId).delete();
      } catch {
        /* not indexed — fine */
      }
    }
    return;
  }

  const raw = await RawProductModel.findById(normalized.rawProductId)
    .select("rawTitle sellerId price stockQty")
    .lean();
  if (!raw) return;

  // Fold the part's alias surface forms into the doc for slang/translit recall.
  let aliasText = "";
  if (normalized.canonicalPartId) {
    const aliases = await PartAliasModel.find({ canonicalPartId: normalized.canonicalPartId })
      .select("alias")
      .lean();
    aliasText = aliases.map((a) => a.alias).join(" ");
  }

  const doc = buildListingDoc(String(normalizedProductId), normalized, raw, aliasText);
  try {
    await collection.documents().upsert(doc);
    logger.debug("index.upsert", { id: doc.id, partType: doc.canonicalPartName });
  } catch (err) {
    logger.error("index.upsert_failed", { id: doc.id, err: (err as Error).message });
    throw err; // let BullMQ retry
  }
}
