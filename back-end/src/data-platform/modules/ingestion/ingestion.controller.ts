/**
 * HTTP handlers for ingestion. Thin: validate → call service → respond.
 * All errors are forwarded to the central error handler via `next`.
 */

import type { Request, Response, NextFunction } from "express";
import { Types } from "mongoose";
import { manualProductDto } from "./ingestion.dto.js";
import { ingestManualProduct } from "./ingestion.service.js";
import { ImportJobModel } from "./importJob.model.js";
import { RawProductModel } from "./rawProduct.model.js";
import { NormalizedProductModel } from "../normalization/normalizedProduct.model.js";
import { enqueueImport } from "./import.queue.js";
import { ValidationError, NotFoundError, PayloadTooLargeError } from "../../shared/errors.js";

const OBJECT_ID_RE = /^[a-f\d]{24}$/i;

/** POST /api/v1/ingest/products — manual single product. */
export async function createProduct(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = manualProductDto.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError("Барааны мэдээлэл буруу байна", parsed.error.flatten());
    }
    const result = await ingestManualProduct(parsed.data);
    res.status(202).json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
}

/** POST /api/v1/ingest/import — CSV/Excel upload (async, returns jobId). */
export async function importProducts(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const file = req.file;
    if (!file) throw new ValidationError("Файл оруулна уу (form field: 'file')");

    const sellerId = String(req.body?.sellerId ?? "");
    if (!OBJECT_ID_RE.test(sellerId)) throw new ValidationError("sellerId буруу (ObjectId биш)");

    const lower = file.originalname.toLowerCase();
    if (!/\.(csv|xlsx|xls)$/.test(lower)) {
      throw new ValidationError("Зөвхөн .csv / .xlsx / .xls файл дэмжинэ");
    }
    if (file.size === 0) throw new ValidationError("Файл хоосон байна");
    if (file.size > 25 * 1024 * 1024) throw new PayloadTooLargeError();

    const source = lower.endsWith(".csv") ? "csv" : "excel";
    const job = await ImportJobModel.create({
      sellerId: new Types.ObjectId(sellerId),
      filename: file.originalname,
      source,
      status: "queued",
    });

    await enqueueImport({
      importJobId: String(job._id),
      sellerId,
      filePath: file.path,
      source,
      filename: file.originalname,
    });

    res.status(202).json({ ok: true, jobId: String(job._id), status: "queued" });
  } catch (err) {
    next(err);
  }
}

/** GET /api/v1/ingest/import/:id — import job progress. */
export async function getImportJob(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const job = await ImportJobModel.findById(req.params.id).lean();
    if (!job) throw new NotFoundError("Import job олдсонгүй");
    res.json({ ok: true, job });
  } catch (err) {
    next(err);
  }
}

/** GET /api/v1/raw/:id — inspect a raw product (debug/admin). */
export async function getRaw(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const raw = await RawProductModel.findById(req.params.id).lean();
    if (!raw) throw new NotFoundError("Raw бараа олдсонгүй");
    res.json({ ok: true, raw });
  } catch (err) {
    next(err);
  }
}

/** GET /api/v1/normalized/:rawId — latest interpretation for a raw product. */
export async function getNormalized(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const doc = await NormalizedProductModel.findOne({ rawProductId: req.params.rawId })
      .sort({ version: -1 })
      .lean();
    if (!doc) throw new NotFoundError("Normalized өгөгдөл алга (M2-д хэрэгжинэ)");
    res.json({ ok: true, normalized: doc });
  } catch (err) {
    next(err);
  }
}
