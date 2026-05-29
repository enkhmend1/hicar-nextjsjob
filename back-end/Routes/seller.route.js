import express from "express";
import {
  apply, updateProfile, updateSettings, facets,
  dashboard, analytics, analyticsExport, myOrders,
  publicStorefront,
} from "../Controller/seller.controller.js";
import { sellerUpdateOrderStatus } from "../Controller/order.controller.js";
import { protect, approvedSeller } from "../Middleware/auth.middleware.js";

const router = express.Router();

// Phase P.1: PUBLIC storefront — mounted BEFORE router.use(protect)
// so anonymous buyers can browse seller pages without a session.
// Returns server-sanitized payload (no email/phone/bank/commission).
router.get("/store/:id", publicStorefront);

router.use(protect);

router.post("/apply", apply);
router.patch("/profile", updateProfile);
router.patch("/settings", approvedSeller, updateSettings);
router.get("/facets", approvedSeller, facets);

router.get("/dashboard", approvedSeller, dashboard);
router.get("/analytics", approvedSeller, analytics);
router.get("/analytics/export", approvedSeller, analyticsExport);

router.get("/orders", approvedSeller, myOrders);
// Phase AQ.1: seller marks own orders processing/shipped (+ tracking).
router.patch("/orders/:id/status", approvedSeller, sellerUpdateOrderStatus);

export default router;
