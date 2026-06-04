/**
 * HTTP handlers for image upload. Thin layer: validate → call service → respond.
 */

import type { Request, Response, NextFunction } from "express";
import { uploadImageStream } from "../../services/cloudinary.service.js";
import { cloudinaryServiceEnabled } from "../../services/cloudinary.service.js";
import { ValidationError, UpstreamError } from "../../shared/errors.js";

const VALID_FOLDER_TYPES = new Set(["raw", "canonical"]);

/** POST /api/v1/images/upload */
export async function uploadImage(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!cloudinaryServiceEnabled()) {
      throw new UpstreamError("Cloudinary тохиргоогүй — зураг байршуулах боломжгүй");
    }

    const file = req.file;
    if (!file) throw new ValidationError("Зураг файл оруулна уу (form field: 'file')");

    const folderType = String(req.body?.folderType ?? "raw") as "raw" | "canonical";
    if (!VALID_FOLDER_TYPES.has(folderType)) {
      throw new ValidationError("folderType нь 'raw' эсвэл 'canonical' байх ёстой");
    }

    const identifier = String(req.body?.identifier ?? "upload").trim().slice(0, 100);
    if (!identifier) throw new ValidationError("identifier талбар шаардлагатай");

    const result = await uploadImageStream(file.buffer, folderType, identifier);

    res.status(201).json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
}
