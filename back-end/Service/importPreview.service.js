/**
 * Bulk-import Preview orchestrator (Phase D.3).
 *
 * The wizard's Step 2 needs to show the seller a "predictive preview" —
 * every row decorated with: the AI-cleaned shape, an OCR-corrected OEM,
 * a confidence score, a conflict annotation when the OEM already exists
 * in this seller's catalogue, and a suggested next action.
 *
 * One module, one orchestration responsibility. Each existing service
 * keeps its own concern:
 *
 *   ocrFuzzy.service        — pattern-based OEM corrections (Phase D.2)
 *   productEnricher.service — LLM-driven brand/category/vehicle parse
 *   importPreview.service   — composes the above, adds conflict state
 *
 * Why the conflict detector lives here (not in commitHandler):
 *   The seller MUST see the conflict in the preview to make an informed
 *   call (merge vs overwrite). Detecting it at commit-time would force
 *   either silent decisions or an awkward second confirmation dialog.
 *   By annotating in the preview we give the UI the data it needs to
 *   render the per-row action selector AND the bulk-action buttons.
 *
 * Concurrency:
 *   The enrichment LLM call is the dominant cost. We pass concurrency
 *   straight through to enrichBulk so callers can tune by batch size.
 */

import Product from "../Model/product.model.js";
import { enrichBulk } from "./productEnricher.service.js";
import { correctOemCode } from "./ocrFuzzy.service.js";

// Price-jump tolerance — within this band we treat the change as noise
// and don't require explicit merchant action.
const PRICE_DRIFT_TOLERANCE = 0.05;  // ±5%

/**
 * Look up every (sellerId, cleaned_oem) combination in ONE round-trip.
 * Returns a Map keyed by uppercased OEM → existing lean Product doc.
 *
 * Doing this in a single $in query (rather than per-row find) keeps the
 * preview latency proportional to N round-trips ≈ O(1) on the DB side,
 * which matters when sellers paste 500-row sheets.
 */
const fetchExistingByOem = async (sellerId, oemList) => {
  const cleaned = [...new Set(oemList.map((o) => String(o || "").trim().toUpperCase()).filter(Boolean))];
  if (cleaned.length === 0) return new Map();

  const docs = await Product.find({ seller: sellerId, oem: { $in: cleaned } })
    .select("name oem price stockQty status warehouseLocation costPrice")
    .lean();
  return new Map(docs.map((d) => [String(d.oem || "").toUpperCase(), d]));
};

/**
 * Decide the recommended action for a row given the incoming vs existing
 * state. The seller can always override in the UI — this is only a
 * default hint.
 *
 *   no existing            → "create"
 *   exists, price/qty same → "skip"     (no-op duplicate)
 *   exists, price drifted  → "merge_stock"  (safe additive default)
 *   exists, price huge     → "review"   (force seller to decide)
 */
const suggestAction = ({ existing, newPrice, newStock }) => {
  if (!existing) return "create";

  const priceChanged =
    existing.price > 0 &&
    Math.abs(newPrice - existing.price) / existing.price > PRICE_DRIFT_TOLERANCE;
  const stockChanged = (existing.stockQty || 0) !== newStock;

  if (!priceChanged && !stockChanged) return "skip";
  if (priceChanged && Math.abs(newPrice - existing.price) / Math.max(existing.price, 1) > 0.30) {
    return "review";  // >30% jump deserves manual review
  }
  return "merge_stock";
};

/**
 * Decorate one row with its conflict block (or null if no conflict).
 * Pure function — receives the existing doc from the precomputed map
 * so it never hits the DB itself.
 */
const annotateConflict = (row, existing) => {
  if (!existing) return null;

  const newPrice = Number(row.price || 0);
  const newStock = Number(row.stock || 0);
  const oldPrice = Number(existing.price || 0);
  const oldStock = Number(existing.stockQty || 0);

  return {
    existingId:       String(existing._id),
    existingName:     existing.name,
    existingPrice:    oldPrice,
    existingStock:    oldStock,
    existingStatus:   existing.status,
    incomingPrice:    newPrice,
    incomingStock:    newStock,
    priceDelta:       newPrice - oldPrice,
    priceDeltaPct:    oldPrice > 0 ? Math.round(((newPrice - oldPrice) / oldPrice) * 100) : null,
    stockDelta:       newStock - oldStock,
    suggestedAction:  suggestAction({ existing, newPrice, newStock }),
  };
};

/**
 * Compute a single confidence score per row that combines the OCR-fix
 * confidence and the enrichment confidence. The wizard uses this to
 * highlight rows (<70% = yellow, <50% = red).
 *
 * Heuristic: take the min of the two signals. A row with great OCR but
 * poor enrichment (or vice-versa) should still be flagged.
 */
const compositeConfidence = (ocrConf, enrichmentConf) => {
  const o = Number.isFinite(ocrConf) ? ocrConf : 0.5;
  const e = Number.isFinite(enrichmentConf) ? enrichmentConf : 0.5;
  return +Math.min(o, e).toFixed(2);
};

/**
 * Main entry — turn raw parsed rows into reviewable preview rows.
 *
 *   sellerId : ObjectId  — used to scope the conflict lookup
 *   rows     : RawRow[]  — output of sellerImport.parseUploadedFile
 *   opts     : { concurrency?: number }
 *
 * Returns:
 *   {
 *     rows: PreviewRow[],
 *     summary: { total, newCount, conflictCount, reviewCount, lowConfidenceCount }
 *   }
 *
 * Where each PreviewRow is the enriched shape PLUS:
 *   {
 *     ocrFix:        { original, corrected, edits, brand, confidence, rule }
 *     conflict:      null | { existingId, existingPrice, ..., suggestedAction }
 *     confidence:    composite 0–1
 *     requiresReview: bool
 *     action:        recommended action (mirror of conflict.suggestedAction or "create")
 *   }
 */
export const buildPreview = async (sellerId, rows, { concurrency = 5 } = {}) => {
  if (!sellerId)               throw new Error("sellerId required");
  if (!Array.isArray(rows))    throw new Error("rows must be array");
  if (rows.length === 0) {
    return { rows: [], summary: { total: 0, newCount: 0, conflictCount: 0, reviewCount: 0, lowConfidenceCount: 0 } };
  }

  // ── Step 1: OCR fuzzy correction (cheap, deterministic, no LLM) ──
  // Done BEFORE enrichment so the enricher sees the corrected OEM and
  // doesn't waste its first pass on a garbled code.
  const preCorrected = rows.map((r) => {
    const fix = correctOemCode(r.input_code || "");
    return {
      raw:    r,
      ocrFix: fix,
      // Mutate a *copy* of the raw row with the corrected code so the
      // LLM never sees the bogus OCR string.
      enrichInput: { ...r, input_code: fix.corrected || r.input_code },
    };
  });

  // ── Step 2: LLM enrichment in bounded-concurrency batch ─────────
  const enriched = await enrichBulk(
    preCorrected.map((p) => p.enrichInput),
    { concurrency },
  );

  // ── Step 3: Conflict lookup — single $in query ──────────────────
  const oemList = enriched.map((e) => e.cleaned_oem_code).filter(Boolean);
  const existingMap = await fetchExistingByOem(sellerId, oemList);

  // ── Step 4: Compose preview rows ────────────────────────────────
  const previewRows = enriched.map((e, idx) => {
    const ocrFix = preCorrected[idx].ocrFix;
    const existing = e.cleaned_oem_code
      ? existingMap.get(String(e.cleaned_oem_code).toUpperCase())
      : null;
    const conflict = annotateConflict(e, existing);
    const confidence = compositeConfidence(ocrFix.confidence, e.confidence);
    const action = conflict ? conflict.suggestedAction : "create";

    return {
      ...e,
      ocrFix,
      conflict,
      confidence,
      requiresReview: confidence < 0.70 || ocrFix.requiresReview || action === "review",
      action,
    };
  });

  // ── Step 5: Aggregate summary for the wizard header ─────────────
  const summary = {
    total:               previewRows.length,
    newCount:            previewRows.filter((r) => !r.conflict).length,
    conflictCount:       previewRows.filter((r) =>  r.conflict).length,
    reviewCount:         previewRows.filter((r) =>  r.requiresReview).length,
    lowConfidenceCount:  previewRows.filter((r) =>  r.confidence < 0.70).length,
  };

  return { rows: previewRows, summary };
};

// Test exports
export const __internal = Object.freeze({
  PRICE_DRIFT_TOLERANCE,
  fetchExistingByOem,
  suggestAction,
  annotateConflict,
  compositeConfidence,
});
