import express from "express";
import {
  enrichOne, enrichBulkHandler, parseUploadedFile, commitHandler, ocrHandler,
  previewHandler, commitV2Handler,
} from "../Controller/sellerImport.controller.js";
import { protect, approvedSeller } from "../Middleware/auth.middleware.js";

const router = express.Router();
router.use(protect, approvedSeller);

router.post("/enrich",       enrichOne);
router.post("/enrich-bulk",  enrichBulkHandler);
router.post("/parse",        ...parseUploadedFile);  // multer middleware spread
router.post("/commit",       commitHandler);
router.post("/ocr",          ocrHandler);
// Phase D — conflict-aware wizard endpoints (preferred path; legacy
// /enrich-bulk + /commit stay for backwards compatibility while the
// frontend rolls over).
router.post("/preview",      previewHandler);
router.post("/commit-v2",    commitV2Handler);

export default router;
