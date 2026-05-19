import express from "express";
import { smartSearchHandler } from "../Controller/smartSearch.controller.js";
import { protect } from "../Middleware/auth.middleware.js";
import { ipLimit, userLimit } from "../Middleware/rateLimit.middleware.js";

const router = express.Router();

// Anonymous searches allowed — but with strict per-IP throttling to deter
// scraping. Logged-in users get a more generous bucket.
const optionalProtect = (req, res, next) => {
  if (!req.headers.authorization) return next();
  return protect(req, res, next);
};

router.post(
  "/smart",
  optionalProtect,
  ipLimit(15, 60),    // 15 / minute per IP
  userLimit(60, 60),  // 60 / minute per user
  smartSearchHandler,
);

export default router;
