import mongoose from "mongoose";

/**
 * Support ticket / operator-chat model.
 *
 * General helpdesk (NOT order-scoped like disputes): any authenticated user
 * — buyer OR seller — opens a ticket about a problem and has a threaded
 * conversation with admin/operator. Admin replies from an admin inbox.
 *
 * Status state machine (driven by support.controller transitions):
 *
 *   awaiting_admin   ◀── user opens ticket / user replies
 *     │  admin reads (no transition) · admin replies ──▶ awaiting_user
 *     ▼
 *   awaiting_user    ◀── admin replies
 *     │  user reads (no transition) · user replies ──▶ awaiting_admin
 *     ▼
 *   open             ── neutral working state an admin can set via setStatus
 *   resolved         ── admin marks done (re-openable: user reply → awaiting_admin)
 *   closed           ── terminal (user/admin closes); no more messages accepted
 *
 * `awaiting_admin` / `awaiting_user` simply track "whose turn is it"; `open`
 * is a generic admin-set working state. Reads never change status — they only
 * clear the per-side unread flag that drives the inbox badge.
 *
 * The `messages` subdocument mirrors dispute.model's shape (author enum +
 * text + images + createdAt) so both conversation features stay consistent.
 */

const TICKET_STATUS = [
  "open",
  "awaiting_admin",
  "awaiting_user",
  "resolved",
  "closed",
];

const TICKET_CATEGORY = ["order", "payment", "delivery", "account", "seller", "other"];

const TICKET_PRIORITY = ["low", "normal", "high"];

const messageSchema = new mongoose.Schema(
  {
    /** Who wrote it. `system` is reserved for status-transition log entries. */
    author: { type: String, enum: ["user", "admin", "system"], required: true },
    /** Which admin authored an `admin` message (null for user/system). */
    adminUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    text: { type: String, trim: true, maxlength: 2000 },
    /** Optional attachments — Cloudinary URLs. */
    images: { type: [String], default: [] },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true },
);

const supportTicketSchema = new mongoose.Schema(
  {
    /** The opener — buyer or seller. Immutable after creation. */
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

    subject: { type: String, required: true, trim: true, maxlength: 140 },
    category: { type: String, enum: TICKET_CATEGORY, default: "other" },
    status: { type: String, enum: TICKET_STATUS, default: "awaiting_admin", index: true },
    priority: { type: String, enum: TICKET_PRIORITY, default: "normal" },

    /** Optional link to an order this ticket is about (helpdesk context only). */
    relatedOrder: { type: mongoose.Schema.Types.ObjectId, ref: "Order", default: null },

    // ── Conversation log ─────────────────────────────────────────────
    messages: { type: [messageSchema], default: [] },

    /** Admin who picked the ticket up (set on first admin reply). */
    assignedAdmin: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    /** Set to now on create + every new message. Drives inbox sort. */
    lastMessageAt: { type: Date, index: true },

    // ── Inbox badges ─────────────────────────────────────────────────
    /** Unseen by the admin side (true after a user message, false on admin read). */
    unreadForAdmin: { type: Boolean, default: true },
    /** Unseen by the opener (true after an admin message, false on user read). */
    unreadForUser: { type: Boolean, default: false },
  },
  { timestamps: true },
);

// ── Indexes ────────────────────────────────────────────────────────────
// User's "my tickets" list, newest activity first.
supportTicketSchema.index({ user: 1, lastMessageAt: -1 });
// Admin inbox: filter by status, newest activity first.
supportTicketSchema.index({ status: 1, lastMessageAt: -1 });

// Static helpers — referenced from controllers for validation.
supportTicketSchema.statics.STATUS = TICKET_STATUS;
supportTicketSchema.statics.CATEGORY = TICKET_CATEGORY;
supportTicketSchema.statics.PRIORITY = TICKET_PRIORITY;

export default mongoose.model("SupportTicket", supportTicketSchema);
