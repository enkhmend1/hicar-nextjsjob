/**
 * The READ-MODEL projection: the shape a buyer searches. Built by JOINING the
 * normalized interpretation + its raw offer (price/stock/title/seller) +
 * the canonical part's alias surface forms. We index THIS — never raw.
 *
 * `aliasText` folds every known surface form of the part (English/Cyrillic/
 * Latin/slang) into one searchable field, so a query for "gerel" matches a
 * listing whose canonical name is "Headlight" — our dictionary powers recall.
 */

import { transliterateLatinToCyrillic } from "../../shared/text.js";
import { getOptimizedUrl } from "../../services/cloudinary.service.js";
import type { NormalizedProduct } from "../normalization/normalizedProduct.model.js";
import type { RawProduct } from "../ingestion/rawProduct.model.js";

export interface ListingDoc {
  id: string; // = rawProductId (stable per listing; re-normalization replaces, never duplicates)
  rawProductId: string;
  normalizedProductId: string;
  sellerId: string;
  title: string;
  titleCyrillic?: string;
  titleLatin?: string;
  canonicalPartName?: string;
  aliasText?: string;
  brand?: string;
  model?: string;
  generation?: string;
  oem?: string;
  price?: number;
  inStock?: boolean;
  thumbnailUrl?: string;
  confidence: number;
  status: string;
  createdAt: number; // epoch seconds (Typesense int64 sort field)
}

/** Normalized statuses that should appear in search. */
export function isPublishable(status: string): boolean {
  return status === "auto_approved" || status === "needs_review";
}

const fr = (f: { value?: string | null } | undefined): string | undefined => f?.value ?? undefined;

export function buildListingDoc(
  normalizedId: string,
  normalized: NormalizedProduct,
  raw: Pick<RawProduct, "rawTitle" | "sellerId" | "price" | "stockQty"> & { _id: unknown },
  aliasText: string,
): ListingDoc {
  const title = raw.rawTitle ?? "";
  return {
    id: String(raw._id),
    rawProductId: String(raw._id),
    normalizedProductId: normalizedId,
    sellerId: String(raw.sellerId),
    title,
    titleCyrillic: transliterateLatinToCyrillic(title),
    titleLatin: title.toLowerCase(),
    canonicalPartName: fr(normalized.partType),
    aliasText: aliasText || undefined,
    brand: fr(normalized.canonicalBrand),
    model: fr(normalized.canonicalModel),
    generation: fr(normalized.generation),
    oem: fr(normalized.oem),
    price: typeof raw.price === "number" ? raw.price : undefined,
    inStock: typeof raw.stockQty === "number" ? raw.stockQty > 0 : undefined,
    thumbnailUrl: normalized.imagePublicIds?.[0]
      ? getOptimizedUrl(normalized.imagePublicIds[0], { width: 400 }) || undefined
      : undefined,
    confidence: normalized.overallConfidence ?? 0,
    status: normalized.status,
    createdAt: Math.floor(Date.now() / 1000),
  };
}
