import express from "express";
import {
  apply, updateProfile, updateSettings, facets,
  dashboard, analytics, analyticsExport, myOrders,
} from "../Controller/seller.controller.js";
import { protect, approvedSeller } from "../Middleware/auth.middleware.js";

const router = express.Router();

router.use(protect);

router.post("/apply", apply);
router.patch("/profile", updateProfile);
router.patch("/settings", approvedSeller, updateSettings);
router.get("/facets", approvedSeller, facets);

router.get("/dashboard", approvedSeller, dashboard);
router.get("/analytics", approvedSeller, analytics);
router.get("/analytics/export", approvedSeller, analyticsExport);

router.get("/orders", approvedSeller, myOrders);

export default router;
