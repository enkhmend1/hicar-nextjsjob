import express from "express";
import { upload } from "../Middleware/upload.middleware.js";
import { uploadImage, uploadMany, deleteImage } from "../Controller/upload.controller.js";
import { protect, adminOnly, approvedSeller } from "../Middleware/auth.middleware.js";
import { userLimit } from "../Middleware/rateLimit.middleware.js";

const router = express.Router();

// All upload endpoints require a valid session at minimum. Per-route
// role gates below; we do NOT router.use(adminOnly) anymore because
// sellers ALSO need to upload product photos.
router.use(protect);

// Cloudinary uploads cost money + bandwidth; cap them. 30/hour single +
// 10/hour multi (which can upload 10 files each = 100 uploads/hour) is
// far more than any legitimate seller/admin workflow needs.
const singleUploadLimit = userLimit(30, 60 * 60);
const manyUploadLimit   = userLimit(10, 60 * 60);

// Phase O.2: upload (POST) is open to approvedSeller + admin.
// Previous bug — router.use(protect, adminOnly) blocked sellers from
// uploading their own product photos, so the new-product wizard at
// /seller/products/new returned 403 "Admin эрх шаардлагатай" the
// moment they clicked "Add image".
router.post("/",     approvedSeller, singleUploadLimit, upload.single("image"),  uploadImage);
router.post("/many", approvedSeller, manyUploadLimit,   upload.array("images", 10), uploadMany);

// DELETE stays admin-only on purpose: the controller has no ownership
// check on the Cloudinary URL, so letting sellers call it freely would
// let one seller wipe another seller's images. Until we add a per-asset
// owner table or seller-scoped delete logic, admin-gated is the safer
// floor for the destructive endpoint.
router.delete("/:filename", adminOnly, deleteImage);

export default router;
