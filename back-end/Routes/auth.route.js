import express from "express";
import {
  register, login, me, refresh, logout,
  forgotPassword, checkResetToken, resetPassword,
} from "../Controller/auth.controller.js";
import { protect } from "../Middleware/auth.middleware.js";
import { ipLimit, rateLimit } from "../Middleware/rateLimit.middleware.js";

const router = express.Router();

// ── Account creation + login brute-force guard ─────────────────────────
// Login: 10 attempts per 15 min per IP, AND a per-email bucket so an
// attacker can't multiplex across 1000 IPs against one victim's email.
// Register: 3 / hour per IP — stops scripted spam-account creation.
const loginByIp    = ipLimit(10, 60 * 15);
const loginByEmail = rateLimit({
  prefix: "rl-login-email",
  window: 60 * 15,
  max: 10,
  key: (req) => (req.body?.email || "").toString().toLowerCase().trim() || req.ip,
});
const registerLimit = ipLimit(3, 60 * 60);

router.post("/register", registerLimit, register);
router.post("/login",    loginByIp, loginByEmail, login);
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
