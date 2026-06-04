/**
 * Image routes. Uses multer memory storage so the Buffer is available
 * in req.file.buffer for direct pass-through to Cloudinary.
 */

import { Router } from "express";
import multer from "multer";
import { uploadImage } from "./images.controller.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 }, // 10 MB cap
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Зөвхөн зураг файл хүлээн авна (image/*)"));
    }
  },
});

/** Mounted at /api/v1/images */
export const imagesRouter = Router();
imagesRouter.post("/upload", upload.single("file"), uploadImage);
