/**
 * Central Express error handler. Maps AppError / ZodError / known Mongoose
 * errors to sanitized JSON. Unknown errors are logged with a stack and
 * returned as a generic 500 (never leak internals to the client).
 */

import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { AppError } from "../shared/errors.js";
import { logger } from "../shared/logger.js";

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(err);
    return;
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json({ ok: false, code: err.code, message: err.message, details: err.details });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({ ok: false, code: "VALIDATION_ERROR", message: "Оролт буруу", details: err.flatten() });
    return;
  }

  const e = err as { name?: string; code?: number; message?: string; stack?: string };
  if (e?.name === "CastError") {
    res.status(400).json({ ok: false, code: "BAD_ID", message: "ID буруу форматтай" });
    return;
  }
  if (e?.code === 11000) {
    res.status(409).json({ ok: false, code: "DUPLICATE", message: "Давхцсан бичлэг" });
    return;
  }

  logger.error("unhandled.error", { err: e?.message, stack: e?.stack });
  res.status(500).json({ ok: false, code: "INTERNAL", message: "Дотоод алдаа гарлаа" });
}
