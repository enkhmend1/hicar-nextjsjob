import express from "express";
import multer from "multer";
import {
  handleAIRequest, handleMemoryGet, handleSetActiveVehicle, handleClearActiveVehicle,
} from "../Controller/ai.controller.js";
import { protect } from "../Middleware/auth.middleware.js";
import { upload } from "../Middleware/upload.middleware.js";

const router = express.Router();

// Optional auth: if token provided, req.user is set. Anonymous chat allowed for product search.
const optionalProtect = (req, res, next) => {
  if (!req.headers.authorization) return next();
  return protect(req, res, next);
};

/**
 * Composite middleware:
 *
 *   ① if Content-Type is multipart/form-data → run multer to populate
 *      req.file (Cloudinary URL at req.file.path).
 *   ② otherwise → skip multer, body parses as JSON via the global
 *      express.json() middleware (256kb limit).
 *
 * This lets the SAME endpoint accept either shape without forcing the
 * frontend to commit. Vision requests upload via multipart; pure-text
 * chats stay JSON.
 *
 * Errors from multer (file too big, wrong mime) surface as 400 to the
 * client — they're caller-recoverable.
 */
const conditionalUpload = (req, res, next) => {
  const ct = String(req.headers["content-type"] || "");
  if (!ct.toLowerCase().startsWith("multipart/form-data")) return next();
  upload.single("image")(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      return res.status(400).json({
        code: "UPLOAD_INVALID",
        message: err.code === "LIMIT_FILE_SIZE"
          ? "Зураг 5MB-аас бага байх ёстой"
          : err.message,
      });
    }
    return res.status(400).json({ code: "UPLOAD_INVALID", message: err.message });
  });
};

router.post("/chat", optionalProtect, conditionalUpload, handleAIRequest);

// ── Phase G: cross-session AI memory ────────────────────────────
// Frontend uses these to hydrate the vehicle switcher widget without
// going through the LLM. All require auth — anonymous users have no
// persistent memory (their state lives in localStorage via Zustand
// persist middleware).
router.get   ("/memory",                  protect, handleMemoryGet);
router.post  ("/memory/active-vehicle",   protect, handleSetActiveVehicle);
router.delete("/memory/active-vehicle",   protect, handleClearActiveVehicle);

export default router;
