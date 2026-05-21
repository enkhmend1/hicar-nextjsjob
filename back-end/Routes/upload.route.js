import express from "express";
import { upload } from "../Middleware/upload.middleware.js";
import { uploadImage, uploadMany, deleteImage } from "../Controller/upload.controller.js";
import { protect, adminOnly } from "../Middleware/auth.middleware.js";
import { userLimit } from "../Middleware/rateLimit.middleware.js";

const router = express.Router();

router.use(protect, adminOnly);

// Cloudinary uploads cost money + bandwidth; cap them. 30/hour single +
// 10/hour multi (which can upload 10 files each = 100 uploads/hour) is
// far more than any legitimate admin workflow needs.
const singleUploadLimit = userLimit(30, 60 * 60);
const manyUploadLimit   = userLimit(10, 60 * 60);

router.post("/", singleUploadLimit, upload.single("image"), uploadImage);
router.post("/many", manyUploadLimit, upload.array("images", 10), uploadMany);
router.delete("/:filename", deleteImage);

export default router;
