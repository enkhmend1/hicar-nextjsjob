import express from "express";
import {
  listProducts, listMyProducts, listAllProducts,
  getProduct, createProduct, updateProduct, deleteProduct,
  moderateProduct, getCategories, fitmentTree,
} from "../Controller/product.controller.js";
import {
  listReviews, createReview, updateReview, deleteReview,
} from "../Controller/review.controller.js";
import { protect, adminOnly, approvedSeller } from "../Middleware/auth.middleware.js";

const router = express.Router();

// Public
router.get("/", listProducts);
router.get("/categories", getCategories);
router.get("/fitment-tree", fitmentTree);

// Authenticated views — must come BEFORE /:id route
router.get("/mine", protect, approvedSeller, listMyProducts);
router.get("/admin/all", protect, adminOnly, listAllProducts);
router.patch("/:id/moderate", protect, adminOnly, moderateProduct);

// Reviews (must be before /:id catch-all)
router.get("/:id/reviews", listReviews);
router.post("/:id/reviews", protect, createReview);
router.put("/:id/reviews", protect, updateReview);
router.delete("/:id/reviews", protect, deleteReview);

// Public single product (with owner/admin gating inside controller)
router.get("/:id", getProduct);

// Create — seller (approved) OR admin
router.post("/", protect, approvedSeller, createProduct);

// Update / delete — owner OR admin (enforced in controller)
router.put("/:id", protect, updateProduct);
router.delete("/:id", protect, deleteProduct);

export default router;
