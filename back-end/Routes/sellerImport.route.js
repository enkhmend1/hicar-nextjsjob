import express from "express";
import {
  enrichOne, enrichBulkHandler, parseUploadedFile, commitHandler, ocrHandler,
} from "../Controller/sellerImport.controller.js";
import { protect, approvedSeller } from "../Middleware/auth.middleware.js";

const router = express.Router();
router.use(protect, approvedSeller);

router.post("/enrich",       enrichOne);
router.post("/enrich-bulk",  enrichBulkHandler);
router.post("/parse",        ...parseUploadedFile);  // multer middleware spread
router.post("/commit",       commitHandler);
router.post("/ocr",          ocrHandler);

export default router;
