/**
 * Dispute routes.
 *
 *   Buyer:
 *     POST   /api/disputes                 — file a dispute
 *     GET    /api/disputes/mine            — my disputes
 *     POST   /api/disputes/:id/accept      — accept seller offer
 *     POST   /api/disputes/:id/reject      — reject seller offer (escalate)
 *     POST   /api/disputes/:id/withdraw    — withdraw an open dispute
 *
 *   Seller:
 *     GET    /api/disputes/seller          — disputes against me
 *     POST   /api/disputes/:id/respond     — submit seller response
 *
 *   Both:
 *     GET    /api/disputes/:id             — single dispute
 *     POST   /api/disputes/:id/messages    — thread message
 *
 *   Admin:
 *     GET    /api/disputes/admin           — all disputes
 *     POST   /api/disputes/:id/resolve     — final admin resolution
 */

import express from "express";
import {
  myDisputes, sellerDisputes, allDisputes, getDispute,
  create, sellerRespond, buyerAccept, buyerReject, withdraw,
  postMessage, adminResolve,
} from "../Controller/dispute.controller.js";
import { protect, adminOnly, approvedSeller } from "../Middleware/auth.middleware.js";

const router = express.Router();

// Buyer ────────────────────────────────────────────────────────
router.post  ("/",                protect, create);
router.get   ("/mine",            protect, myDisputes);
router.post  ("/:id/accept",      protect, buyerAccept);
router.post  ("/:id/reject",      protect, buyerReject);
router.post  ("/:id/withdraw",    protect, withdraw);

// Seller ───────────────────────────────────────────────────────
router.get   ("/seller",          protect, approvedSeller, sellerDisputes);
router.post  ("/:id/respond",     protect, approvedSeller, sellerRespond);

// Admin ────────────────────────────────────────────────────────
router.get   ("/admin",           protect, adminOnly, allDisputes);
router.post  ("/:id/resolve",     protect, adminOnly, adminResolve);

// Either side (controller does its own auth) ───────────────────
router.get   ("/:id",             protect, getDispute);
router.post  ("/:id/messages",    protect, postMessage);

export default router;
