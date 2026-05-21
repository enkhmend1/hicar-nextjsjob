import express from "express";
import { createOrderInvoice, checkOrderPayment, callback } from "../Controller/qpay.controller.js";
import { protect } from "../Middleware/auth.middleware.js";
import { ipLimit, userLimit } from "../Middleware/rateLimit.middleware.js";
import { verifyQpayCallback } from "../Middleware/qpayWebhook.middleware.js";

const router = express.Router();

// User-facing — polling endpoints get a generous per-user limit (3s frontend
// poll → 20 calls/min is normal; 200/min catches abuse without blocking UX).
router.post("/invoice", protect, userLimit(60, 60), createOrderInvoice);
router.get ("/check/:orderId", protect, userLimit(200, 60), checkOrderPayment);

// Public callback from QPay.
// SECURITY LAYERS (in order):
//   1. ipLimit  — DoS guard. Even with a leaked secret an attacker can't
//                 hammer the endpoint faster than 60 req/min/IP.
//   2. verifyQpayCallback — shared-secret + orderId validation + replay guard.
//   3. callback — still re-checks with QPay before mutating anything.
router.post("/callback", ipLimit(60, 60), verifyQpayCallback, callback);
router.get ("/callback", ipLimit(60, 60), verifyQpayCallback, callback);

export default router;
