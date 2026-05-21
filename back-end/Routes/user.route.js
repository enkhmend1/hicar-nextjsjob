import express from "express";
import {
  listUsers, updateRole, deleteUser,
  listSellers, moderateSeller, resetUserPassword,
  updateSellerEconomics,
} from "../Controller/user.controller.js";
import { protect, adminOnly } from "../Middleware/auth.middleware.js";
import { userLimit } from "../Middleware/rateLimit.middleware.js";

const router = express.Router();

router.use(protect, adminOnly);

// Admin-initiated password reset is sensitive: each call generates a NEW
// temp password (invalidating the previous one) and triggers a notification.
// 10/hour per admin is more than enough for legitimate help-desk usage and
// stops accidental fat-finger floods.
const resetPasswordLimit = userLimit(10, 60 * 60);

router.get("/", listUsers);
router.get("/sellers", listSellers);
router.patch("/:id/role", updateRole);
router.patch("/:id/seller", moderateSeller);
router.patch("/:id/economics", updateSellerEconomics); // platform fee + bank info
router.post ("/:id/reset-password", resetPasswordLimit, resetUserPassword);
router.delete("/:id", deleteUser);

export default router;
