import express from "express";
import { getWishlist, addToWishlist, removeFromWishlist } from "../Controller/wishlist.controller.js";
import { protect } from "../Middleware/auth.middleware.js";

const router = express.Router();
router.use(protect);

router.get("/", getWishlist);
router.post("/", addToWishlist);
router.delete("/:productId", removeFromWishlist);

export default router;
