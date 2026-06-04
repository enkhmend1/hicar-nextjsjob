/**
 * HTTP handlers for the feedback loop: review queue, corrections, change log.
 */

import type { Request, Response, NextFunction } from "express";
import { correctionDto } from "./feedback.dto.js";
import { applyCorrection, listCorrections } from "./correction.service.js";
import { listReviewQueue } from "./reviewQueue.service.js";
import { getEntityHistory } from "./changeLog.service.js";
import type { ChangeEntity } from "./changeLog.model.js";
import type { NormalizedStatus } from "../normalization/normalizedProduct.model.js";
import { ValidationError } from "../../shared/errors.js";

const VALID_ENTITIES: ChangeEntity[] = [
  "normalized_product",
  "canonical_part",
  "part_alias",
  "fitment",
];

/** GET /api/v1/review/queue?status=&limit=&skip= */
export async function getReviewQueue(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const status = req.query.status as NormalizedStatus | undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const skip = req.query.skip ? Number(req.query.skip) : undefined;
    const result = await listReviewQueue({ status, limit, skip });
    res.json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
}

/** POST /api/v1/feedback/corrections */
export async function postCorrection(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = correctionDto.safeParse(req.body);
    if (!parsed.success) throw new ValidationError("Засварын мэдээлэл буруу", parsed.error.flatten());
    const result = await applyCorrection(parsed.data);
    res.status(200).json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
}

/** GET /api/v1/feedback/corrections/:normalizedProductId */
export async function getCorrections(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const items = await listCorrections(String(req.params.normalizedProductId));
    res.json({ ok: true, items });
  } catch (err) {
    next(err);
  }
}

/** GET /api/v1/changelog/:entity/:entityId */
export async function getChangeLog(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const entity = String(req.params.entity) as ChangeEntity;
    if (!VALID_ENTITIES.includes(entity)) throw new ValidationError("entity буруу");
    const items = await getEntityHistory(entity, String(req.params.entityId));
    res.json({ ok: true, items });
  } catch (err) {
    next(err);
  }
}
