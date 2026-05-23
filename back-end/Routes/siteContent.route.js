import express from "express";
import {
  getSiteContent, getHomepageCategories, patchSiteContent,
} from "../Controller/siteContent.controller.js";
import { protect, adminOnly } from "../Middleware/auth.middleware.js";

const router = express.Router();

// ── Public — no auth required ─────────────────────────────────────────
router.get("/",                  getSiteContent);
router.get("/categories",        getHomepageCategories);

// ── Admin — write ─────────────────────────────────────────────────────
router.patch("/", protect, adminOnly, patchSiteContent);

export default router;
