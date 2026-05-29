import express from "express";
import {
  createOrder, myOrders, listOrders, updateStatus, buyerConfirmDelivery,
} from "../Controller/order.controller.js";
import { protect, adminOnly } from "../Middleware/auth.middleware.js";

const router = express.Router();

router.post("/", protect, createOrder);
router.get("/mine", protect, myOrders);
// Phase AQ.5 — buyer's "I got the parcel" button. Schedules escrow release.
router.post("/:id/confirm-delivery", protect, buyerConfirmDelivery);

router.get("/", protect, adminOnly, listOrders);
router.patch("/:id/status", protect, adminOnly, updateStatus);

export default router;
