/**
 * Notification outbox — durable, retry-safe message queue.
 *
 * Why an outbox?
 *   The previous design fired notifications fire-and-forget from inside
 *   business logic — `notify({ user, type, ... }).catch(...)`. If the
 *   Notification.create or transporter.sendMail call failed (SMTP outage,
 *   DB blip, slow upstream), the recipient never learned about the event.
 *   For "your refund of ₮25,000 was issued" that is unacceptable.
 *
 *   The outbox pattern decouples the EMIT from the DELIVER:
 *     1. Business logic INSERTs into outbox in (effectively) the same
 *        transaction as the state change. The insert never touches the
 *        network — it's just a Mongo write to the same connection. If the
 *        state change committed, the outbox row committed too.
 *     2. A dedicated worker reads pending outbox rows and delivers them
 *        (in-app + email). Failures retry with exponential backoff. After
 *        N attempts the row is marked `dead_letter` for admin review.
 *
 *   Result: notifications are exactly-once at the user's mailbox even
 *   when SMTP or our process dies mid-send.
 */

import mongoose from "mongoose";

const STATUS = ["pending", "delivering", "delivered", "dead_letter"];

const notificationOutboxSchema = new mongoose.Schema(
  {
    /** notify-style fields — preserved verbatim from the old in-line API. */
    user:  { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    type:  { type: String, required: true },
    title: { type: String, required: true, maxlength: 200 },
    body:  { type: String, required: true, maxlength: 2000 },
    link:  { type: String, default: "" },
    data:  { type: mongoose.Schema.Types.Mixed, default: {} },
    /** Whether to send email too. */
    email: { type: Boolean, default: false },

    /**
     * Idempotency key — optional but RECOMMENDED for high-stakes events.
     * Two emits with the same `idempotencyKey` collapse into one outbox
     * row, so a BullMQ retry or controller double-fire can't double-notify
     * the user. Unique-sparse index below.
     */
    idempotencyKey: { type: String },

    // ── Delivery state machine ──────────────────────────────────────
    status: {
      type: String,
      enum: STATUS,
      default: "pending",
      index: true,
    },
    /** Increments on each delivery attempt — capped before dead_letter. */
    attempts:   { type: Number, default: 0, min: 0 },
    /** When we can try again. Set after a failed attempt for backoff. */
    nextAttemptAt: { type: Date, default: Date.now, index: true },
    /** Surface of the last failure — for the admin review queue. */
    lastError:  { type: String, default: "" },
    /** Stamped when status flips to "delivered". */
    deliveredAt: { type: Date },
    /**
     * Worker lock — claimed via findOneAndUpdate so multi-replica workers
     * don't double-process the same row. Set with a short TTL via
     * `claimUntil` so a crashed worker's rows go back to the pool.
     */
    claimedBy:   { type: String },
    claimUntil:  { type: Date },
  },
  { timestamps: true },
);

// Two pull queries used by the worker — both wanting (status, nextAttemptAt).
notificationOutboxSchema.index({ status: 1, nextAttemptAt: 1 });

// Idempotency: if `idempotencyKey` is set, no two rows can share it.
notificationOutboxSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });

notificationOutboxSchema.statics.STATUS = STATUS;

export default mongoose.model("NotificationOutbox", notificationOutboxSchema);
