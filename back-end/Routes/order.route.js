import express from "express";
import {
  createOrder, myOrders, listOrders, updateStatus,
} from "../Controller/order.controller.js";
import { protect, adminOnly } from "../Middleware/auth.middleware.js";

const router = express.Router();

router.post("/", protect, createOrder);
router.get("/mine", protect, myOrders);

router.get("/", protect, adminOnly, listOrders);
router.patch("/:id/status", protect, adminOnly, updateStatus);

export default router;
