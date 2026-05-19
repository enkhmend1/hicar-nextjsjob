import express from "express";
import {
  listUsers, updateRole, deleteUser,
  listSellers, moderateSeller, resetUserPassword,
  updateSellerEconomics,
} from "../Controller/user.controller.js";
import { protect, adminOnly } from "../Middleware/auth.middleware.js";

const router = express.Router();

router.use(protect, adminOnly);

router.get("/", listUsers);
router.get("/sellers", listSellers);
router.patch("/:id/role", updateRole);
router.patch("/:id/seller", moderateSeller);
router.patch("/:id/economics", updateSellerEconomics); // platform fee + bank info
router.post ("/:id/reset-password", resetUserPassword);
router.delete("/:id", deleteUser);

export default router;
