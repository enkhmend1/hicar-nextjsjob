import express from "express";
import { dashboard, lowStock } from "../Controller/stats.controller.js";
import { protect, adminOnly } from "../Middleware/auth.middleware.js";

const router = express.Router();

router.get("/dashboard", protect, adminOnly, dashboard);
router.get("/low-stock", protect, adminOnly, lowStock);

export default router;
