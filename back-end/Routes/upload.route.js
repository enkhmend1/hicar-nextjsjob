import express from "express";
import { upload } from "../Middleware/upload.middleware.js";
import { uploadImage, uploadMany, deleteImage } from "../Controller/upload.controller.js";
import { protect, adminOnly } from "../Middleware/auth.middleware.js";

const router = express.Router();

router.use(protect, adminOnly);

router.post("/", upload.single("image"), uploadImage);
router.post("/many", upload.array("images", 10), uploadMany);
router.delete("/:filename", deleteImage);

export default router;
