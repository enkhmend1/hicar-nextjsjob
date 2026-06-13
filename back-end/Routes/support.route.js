/**
 * Support ticket routes — general helpdesk / operator chat.
 *
 *   User (any authenticated buyer/seller):
 *     POST   /api/support              — open a ticket (with first message)
 *     GET    /api/support/mine         — my tickets
 *     GET    /api/support/:id          — one of my tickets (full thread)
 *     POST   /api/support/:id/messages — append a message
 *     PATCH  /api/support/:id/close    — close my ticket
 *
 *   Admin:
 *     GET    /api/support/admin            — all tickets (?status= filter)
 *     GET    /api/support/admin/:id        — one ticket (full thread)
 *     POST   /api/support/admin/:id/reply  — reply to a ticket
 *     PATCH  /api/support/admin/:id/status — set status (resolved | open)
 *
 * The literal `/admin` + `/admin/:id` routes are registered BEFORE the
 * `/:id` user route so "admin" is never captured as an :id param.
 */

import express from "express";
import {
  createTicket, listMyTickets, getMyTicket, addMyMessage, closeMyTicket,
  adminListTickets, adminGetTicket, adminReply, adminSetStatus,
} from "../Controller/support.controller.js";
import { protect, adminOnly } from "../Middleware/auth.middleware.js";
import { userLimit } from "../Middleware/rateLimit.middleware.js";

const router = express.Router();

// Spam guards — a single user opening dozens of tickets, or flooding a thread
// with messages, is the canonical griefing vector. Generous for real use.
const createTicketLimit = userLimit(20, 60 * 60);   // 20 new tickets / hour / user
const messageLimit = userLimit(60, 60 * 60);        // 60 messages / hour / user

// Admin ─────────────────────────────────────────────────────────
// MUST come before "/:id" so "admin" isn't matched as a ticket id.
router.get   ("/admin",            protect, adminOnly, adminListTickets);
router.get   ("/admin/:id",        protect, adminOnly, adminGetTicket);
router.post  ("/admin/:id/reply",  protect, adminOnly, messageLimit, adminReply);
router.patch ("/admin/:id/status", protect, adminOnly, adminSetStatus);

// User ──────────────────────────────────────────────────────────
router.post  ("/",                 protect, createTicketLimit, createTicket);
router.get   ("/mine",             protect, listMyTickets);
router.get   ("/:id",              protect, getMyTicket);
router.post  ("/:id/messages",     protect, messageLimit, addMyMessage);
router.patch ("/:id/close",        protect, closeMyTicket);

export default router;
