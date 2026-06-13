/**
 * RFQ routes — Request For Quotation (B2B roadmap #4).
 *
 *   Buyer:
 *     POST   /api/rfq                — request a quote
 *     GET    /api/rfq/mine           — my requests
 *     PATCH  /api/rfq/:id/accept     — accept a quote
 *     PATCH  /api/rfq/:id/cancel     — withdraw a request
 *
 *   Seller (approved):
 *     GET    /api/rfq/seller         — requests addressed to me
 *     PATCH  /api/rfq/:id/quote      — answer with a unit price
 *     PATCH  /api/rfq/:id/decline    — refuse a request
 *
 * The negotiated unit price is applied SERVER-SIDE at order create
 * (order.controller.js reads the accepted RFQ — the client never supplies
 * the price).
 */

import express from "express";
import {
  createRfq, listMyRfqs, listSellerRfqs,
  quoteRfq, declineRfq, acceptRfq, cancelRfq,
} from "../Controller/rfq.controller.js";
import { protect, approvedSeller } from "../Middleware/auth.middleware.js";
import { userLimit } from "../Middleware/rateLimit.middleware.js";

const router = express.Router();

// Spam guard — a single buyer blasting quote requests at sellers is the
// canonical griefing vector. 30 / hour / user is generous for real use.
const createRfqLimit = userLimit(30, 60 * 60);

// Buyer ────────────────────────────────────────────────────────
router.post  ("/",             protect, createRfqLimit, createRfq);
router.get   ("/mine",         protect, listMyRfqs);
router.patch ("/:id/accept",   protect, acceptRfq);
router.patch ("/:id/cancel",   protect, cancelRfq);

// Seller ───────────────────────────────────────────────────────
router.get   ("/seller",       protect, approvedSeller, listSellerRfqs);
router.patch ("/:id/quote",    protect, approvedSeller, quoteRfq);
router.patch ("/:id/decline",  protect, approvedSeller, declineRfq);

export default router;
