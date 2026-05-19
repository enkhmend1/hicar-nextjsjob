import express from "express";
import {
  register, login, me, refresh, logout,
  forgotPassword, checkResetToken, resetPassword,
} from "../Controller/auth.controller.js";
import { protect } from "../Middleware/auth.middleware.js";
import { ipLimit } from "../Middleware/rateLimit.middleware.js";

const router = express.Router();

router.post("/register", register);
router.post("/login",    login);
router.post("/refresh",  refresh);
router.post("/logout",   logout);
router.get ("/me",       protect, me);

// ── Password recovery (self-serve) ────────────────────────────────────
// Rate limits below are crucial: forgot-password is an unauthenticated
// endpoint that triggers email sends, so abuse here costs money + risks
// the SMTP IP reputation. The reset-password endpoint is similarly
// expensive (argon2 hashing) so we cap it too.

router.post(
  "/forgot-password",
  ipLimit(5, 60 * 15),  //   5 requests / 15 min per IP
  forgotPassword,
);
router.get(
  "/reset-password/check/:token",
  ipLimit(20, 60),      //  20 requests / minute per IP (cheap read)
  checkResetToken,
);
router.post(
  "/reset-password",
  ipLimit(10, 60 * 15), //  10 attempts  / 15 min per IP
  resetPassword,
);

export default router;
