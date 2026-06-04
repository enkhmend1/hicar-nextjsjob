/**
 * Ingestion routes. Bulk upload uses multer disk storage to the OS temp dir;
 * the import worker deletes the temp file when done. File-size limit is
 * enforced both here (multer) and in the controller.
 */

import { Router } from "express";
import multer from "multer";
import os from "node:os";
import { env } from "../../shared/env.js";
import {
  createProduct,
  importProducts,
  getImportJob,
  getRaw,
  getNormalized,
} from "./ingestion.controller.js";

const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: env.maxUploadBytes, files: 1 },
});

/** Mounted at /api/v1/ingest */
export const ingestionRouter = Router();
ingestionRouter.post("/products", createProduct);
ingestionRouter.post("/import", upload.single("file"), importProducts);
ingestionRouter.get("/import/:id", getImportJob);

/** Mounted at /api/v1/raw */
export const rawRouter = Router();
rawRouter.get("/:id", getRaw);

/** Mounted at /api/v1/normalized */
export const normalizedRouter = Router();
normalizedRouter.get("/:rawId", getNormalized);
