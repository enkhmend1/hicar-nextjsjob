import express from "express";
import {
  createOrder, myOrders, listOrders, updateStatus, buyerConfirmDelivery,
} from "../Controller/order.controller.js";
import { protect, adminOnly } from "../Middleware/auth.middleware.js";
import { userLimit } from "../Middleware/rateLimit.middleware.js";

const router = express.Router();

// ── Order creation guard ──────────────────────────────────────────────
// Each createOrder computes escrow server-side AND mints a QPay invoice
// (external API call that costs money / can be abused). Per-user cap of
// 20 / 10 min is generous for a real buyer but stops scripted spam.
router.post("/", protect, userLimit(20, 60 * 10), createOrder);
router.get("/mine", protect, userLimit(120, 60), myOrders);
// Phase AQ.5 — buyer's "I got the parcel" button. Schedules escrow release,
// so a hijacked session bursting it could race the release pipeline; cap it.
router.post(
  "/:id/confirm-delivery",
  protect,
  userLimit(30, 60 * 10),
  buyerConfirmDelivery,
);

router.get("/", protect, adminOnly, listOrders);
router.patch("/:id/status", protect, adminOnly, updateStatus);

export default router;
