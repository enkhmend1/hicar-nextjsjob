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
import { userLimit } from "../Middleware/rateLimit.middleware.js";

const router = express.Router();

// Spam guard — a single buyer filing dozens of disputes is the canonical
// griefing vector. 5 filings / day / user is generous for legitimate use
// (most buyers open 0 disputes, problem buyers maybe 1-2 / week).
const fileDisputeLimit = userLimit(5, 60 * 60 * 24);
// Message thread: 30 messages per dispute window — covers any reasonable
// back-and-forth but stops chat-spam floods.
const messageLimit = userLimit(30, 60 * 60);
// Resolution attempts: 20 / hour / admin — prevents accidental rapid-fire.
const adminResolveLimit = userLimit(20, 60 * 60);

// Buyer ────────────────────────────────────────────────────────
router.post  ("/",                protect, fileDisputeLimit, create);
router.get   ("/mine",            protect, myDisputes);
router.post  ("/:id/accept",      protect, buyerAccept);
router.post  ("/:id/reject",      protect, buyerReject);
router.post  ("/:id/withdraw",    protect, withdraw);

// Seller ───────────────────────────────────────────────────────
router.get   ("/seller",          protect, approvedSeller, sellerDisputes);
router.post  ("/:id/respond",     protect, approvedSeller, sellerRespond);

// Admin ────────────────────────────────────────────────────────
router.get   ("/admin",           protect, adminOnly, allDisputes);
router.post  ("/:id/resolve",     protect, adminOnly, adminResolveLimit, adminResolve);

// Either side (controller does its own auth) ───────────────────
router.get   ("/:id",             protect, getDispute);
router.post  ("/:id/messages",    protect, messageLimit, postMessage);

export default router;
