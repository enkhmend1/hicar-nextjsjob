/**
 * Ingestion service — the write side of LAYER 1.
 *
 * Both intake paths (manual + bulk import) funnel through `upsertRaw`, which:
 *   • computes a content hash so identical re-submissions are idempotent
 *     (the unique {sellerId, contentHash} index is the source of truth — we
 *     catch the 11000 duplicate-key error rather than read-then-write, which
 *     would race),
 *   • inserts an immutable raw_products row,
 *   • enqueues normalization ONLY for genuinely-new rows.
 *
 * Raw data is never overwritten here.
 */

import crypto from "node:crypto";
import { Types } from "mongoose";
import { RawProductModel, type RawSource } from "./rawProduct.model.js";
import { ImportJobModel } from "./importJob.model.js";
import { parseImportFile, applyColumnRemapping, parseMoney } from "./importParser.service.js";
import { aiMapColumnHeaders } from "./columnMapping.service.js";
import { enqueueNormalize } from "../normalization/normalize.queue.js";
import type { ManualProductInput } from "./ingestion.dto.js";
import type { ImportJobData } from "./import.queue.js";
import { logger } from "../../shared/logger.js";

interface RawFields {
  sellerId: Types.ObjectId;
  source: RawSource;
  importJobId?: Types.ObjectId;
  rawTitle: string;
  rawDescription?: string;
  rawBrand?: string;
  rawCategory?: string;
  rawPrice?: string;
  rawOem?: string;
  rawAttributes?: Record<string, string>;
  images?: string[];
  price?: number;
  stockQty?: number;
}

/** Stable hash over the meaningful raw content (case/space-insensitive). */
function computeContentHash(f: RawFields): string {
  const basis = JSON.stringify({
    s: String(f.sellerId),
    t: f.rawTitle?.trim().toLowerCase() ?? "",
    b: f.rawBrand?.trim().toLowerCase() ?? "",
    o: f.rawOem?.trim().toLowerCase() ?? "",
    c: f.rawCategory?.trim().toLowerCase() ?? "",
    d: f.rawDescription?.trim().toLowerCase() ?? "",
  });
  return crypto.createHash("sha256").update(basis).digest("hex");
}

/** Insert one raw row idempotently. Returns whether it was newly inserted. */
async function upsertRaw(fields: RawFields): Promise<{ id: string; inserted: boolean }> {
  const contentHash = computeContentHash(fields);
  try {
    const doc = await RawProductModel.create({ ...fields, contentHash, currency: "MNT", status: "received" });
    return { id: String(doc._id), inserted: true };
  } catch (err) {
    // Unique {sellerId, contentHash} violation → this content already exists.
    if ((err as { code?: number }).code === 11000) {
      const existing = await RawProductModel.findOne({ sellerId: fields.sellerId, contentHash })
        .select("_id")
        .lean();
      return { id: existing ? String(existing._id) : "", inserted: false };
    }
    throw err;
  }
}

/** Manual single-product ingestion. */
export async function ingestManualProduct(
  input: ManualProductInput,
): Promise<{ rawProductId: string; duplicate: boolean }> {
  const rawPrice = input.rawPrice != null ? String(input.rawPrice) : undefined;
  const { id, inserted } = await upsertRaw({
    sellerId: new Types.ObjectId(input.sellerId),
    source: "manual",
    rawTitle: input.rawTitle,
    rawDescription: input.rawDescription,
    rawBrand: input.rawBrand,
    rawCategory: input.rawCategory,
    rawPrice,
    rawOem: input.rawOem,
    rawAttributes: input.rawAttributes,
    images: input.images,
    price: input.price ?? parseMoney(rawPrice),
    stockQty: input.stockQty,
  });
  if (inserted && id) await enqueueNormalize(id);
  return { rawProductId: id, duplicate: !inserted };
}

/**
 * Bulk-import worker body. Parses the file, runs AI header remapping once per
 * file, then streams rows into raw_products. Per-row failures are recorded
 * (capped) and never abort the whole job. Called by the import worker (which
 * owns temp-file cleanup).
 */
export async function processImportFile(data: ImportJobData): Promise<void> {
  const job = await ImportJobModel.findById(data.importJobId);
  if (!job) throw new Error(`ImportJob ${data.importJobId} not found`);
  const sellerId = new Types.ObjectId(data.sellerId);

  job.status = "parsing";
  await job.save();

  let rows;
  let unmappedHeaders: string[];
  try {
    ({ rows, unmappedHeaders } = parseImportFile(data.filePath));
  } catch (err) {
    job.status = "failed";
    job.errors.push({ row: 0, reason: `Файл уншиж чадсангүй: ${(err as Error).message}` });
    job.finishedAt = new Date();
    await job.save();
    throw err;
  }

  // ONE AI call per file to map unusual Mongolian/custom column headers.
  // Best-effort: if AI is disabled or fails, remapping is a no-op.
  if (unmappedHeaders.length > 0) {
    try {
      const remapping = await aiMapColumnHeaders(unmappedHeaders);
      if (remapping.size > 0) {
        rows = applyColumnRemapping(rows, remapping);
        job.aiHeadersApplied = true;
      }
    } catch (err) {
      logger.warn("import.ai_header_map_failed", { err: (err as Error).message });
    }
  }

  job.totalRows = rows.length;
  job.status = "ingesting";
  await job.save();

  let processed = 0;
  let failed = 0;
  let skipped = 0;
  let duplicates = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    try {
      if (!r.rawTitle || !r.rawTitle.trim()) {
        skipped++;
        if (job.errors.length < 500) job.errors.push({ row: i + 1, reason: "Гарчиг (нэр) хоосон" });
        continue;
      }
      const { id, inserted } = await upsertRaw({
        sellerId,
        source: data.source,
        importJobId: job._id,
        rawTitle: r.rawTitle,
        rawDescription: r.rawDescription,
        rawBrand: r.rawBrand,
        rawCategory: r.rawCategory,
        rawPrice: r.rawPrice,
        rawOem: r.rawOem,
        rawAttributes: r.rawAttributes,
        images: r.images,
        price: r.price,
        stockQty: r.stockQty,
      });
      if (inserted && id) {
        await enqueueNormalize(id);
        processed++;
      } else {
        duplicates++;
      }
    } catch (err) {
      failed++;
      if (job.errors.length < 500) job.errors.push({ row: i + 1, reason: (err as Error).message });
    }
    // Flush every 50 rows so the client poll sees live movement on large files.
    if (i % 50 === 0) {
      job.processed = processed;
      job.failed = failed;
      job.skippedCount = skipped;
      job.duplicateCount = duplicates;
      await job.save();
    }
  }

  job.processed = processed;
  job.failed = failed;
  job.skippedCount = skipped;
  job.duplicateCount = duplicates;
  job.status = "done";
  job.finishedAt = new Date();
  await job.save();
  logger.info("import.done", {
    importJobId: String(job._id),
    processed,
    duplicates,
    skipped,
    failed,
    aiHeadersApplied: job.aiHeadersApplied,
  });
}
