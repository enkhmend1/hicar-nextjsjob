/**
 * Notification outbox service.
 *
 * Three responsibilities:
 *
 *   ① enqueue(payload, opts) — write a row to the outbox table. This is
 *      what business logic calls in place of the old fire-and-forget
 *      notify(). Synchronous (DB-only), never touches the network.
 *
 *   ② deliverBatch() — pulled by the outbox worker on every tick. Claims
 *      up to BATCH_SIZE pending rows via an atomic findOneAndUpdate
 *      lease, delivers each, marks delivered or schedules a retry.
 *
 *   ③ deadLetter(id) / requeueDeadLetter(id) — admin recovery actions.
 *
 * Retry policy:
 *   attempt 1 → next try at +30s
 *   attempt 2 → +2min
 *   attempt 3 → +10min
 *   attempt 4 → +1h
 *   attempt 5 → +6h
 *   After 5 attempts → dead_letter for admin review.
 */

import chalk from "chalk";
import nodemailer from "nodemailer";

import NotificationOutbox from "../Model/notificationOutbox.model.js";
import Notification from "../Model/notification.model.js";
import User from "../Model/user.model.js";

// Reuse the same transport as the legacy notification.service. Keeping it
// here avoids importing notification.service to dodge a circular dep — the
// old notify() function is being replaced by enqueue() and lives on only
// for the unauthenticated sendMail() (password reset emails).
const SMTP_HOST = process.env.SMTP_HOST;
const emailEnabled = Boolean(SMTP_HOST);
const transporter = emailEnabled
  ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    })
  : null;
const FROM = process.env.SMTP_FROM || "no-reply@hicar.mn";

const BATCH_SIZE   = Number(process.env.OUTBOX_BATCH_SIZE) || 25;
const CLAIM_TTL_MS = Number(process.env.OUTBOX_CLAIM_TTL_MS) || 60 * 1000;
const MAX_ATTEMPTS = Number(process.env.OUTBOX_MAX_ATTEMPTS) || 5;

/** Exponential backoff: seconds-since-first-attempt at each step. */
const RETRY_DELAYS_MS = [
  30 * 1000,           //  1 → 30s
   2 * 60 * 1000,      //  2 →  2m
  10 * 60 * 1000,      //  3 → 10m
  60 * 60 * 1000,      //  4 →  1h
   6 * 60 * 60 * 1000, //  5 →  6h
];

const workerId = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

/* ──────────────────────────────────────────────────────────────────────
 * Public API — write side
 * ────────────────────────────────────────────────────────────────────── */

/**
 * Schedule a notification for delivery. Idempotent against `idempotencyKey`
 * — passing the same key twice writes only once.
 *
 * Returns the outbox doc (or the pre-existing one on idempotent retry).
 */
export const enqueue = async ({
  user, type, title, body, link = "", data = {}, email = false,
  idempotencyKey,
}) => {
  if (!user || !type || !title || !body) {
    throw new Error("notificationOutbox.enqueue: user/type/title/body required");
  }

  // Idempotent path: try insert, swallow duplicate-key, return existing.
  try {
    return await NotificationOutbox.create({
      user, type, title, body, link, data, email,
      idempotencyKey: idempotencyKey || undefined,
    });
  } catch (e) {
    if (e?.code === 11000 && idempotencyKey) {
      return await NotificationOutbox.findOne({ idempotencyKey });
    }
    throw e;
  }
};

/** Fan out an enqueue to every admin. */
export const enqueueAdmins = async (payload) => {
  const admins = await User.find({ role: "admin" }).select("_id").lean();
  return Promise.all(
    admins.map((a) => enqueue({ ...payload, user: a._id })),
  );
};

/* ──────────────────────────────────────────────────────────────────────
 * Public API — worker side
 * ────────────────────────────────────────────────────────────────────── */

/**
 * Atomic LEASE on a single pending row. Sets `claimedBy` + `claimUntil`
 * so other workers skip it. If two workers race, only one sees the row.
 *
 * `status` flips to "delivering" so the next select-query won't pick it
 * even if claimUntil somehow lingers past expiry on a clock skew.
 */
const claimOne = async () => {
  const now = new Date();
  const claimUntil = new Date(now.getTime() + CLAIM_TTL_MS);
  return NotificationOutbox.findOneAndUpdate(
    {
      $or: [
        { status: "pending", nextAttemptAt: { $lte: now } },
        // Pick up rows whose previous worker died (claim expired).
        { status: "delivering", claimUntil: { $lt: now } },
      ],
    },
    {
      $set: {
        status: "delivering",
        claimedBy: workerId,
        claimUntil,
      },
      $inc: { attempts: 1 },
    },
    { returnDocument: "after", sort: { nextAttemptAt: 1 } },
  );
};

const deliver = async (row) => {
  // 1. In-app notification — write to the Notification collection.
  await Notification.create({
    user:  row.user,
    type:  row.type,
    title: row.title,
    body:  row.body,
    link:  row.link,
    data:  row.data,
  });

  // 2. Optional email.
  if (row.email && emailEnabled) {
    const u = await User.findById(row.user).select("email name").lean();
    if (u?.email) {
      await transporter.sendMail({
        from: FROM,
        to: u.email,
        subject: row.title,
        text: row.body,
        html: `<p>${row.body}</p>${row.link ? `<p><a href="${row.link}">${row.link}</a></p>` : ""}`,
      });
    }
  }
};

/**
 * Drain up to BATCH_SIZE pending rows. Returns { delivered, failed, deadLettered }.
 * Called by the outbox queue worker on a setInterval — or invoked manually
 * for tests.
 */
export const deliverBatch = async () => {
  let delivered = 0;
  let failed = 0;
  let deadLettered = 0;

  for (let i = 0; i < BATCH_SIZE; i++) {
    const row = await claimOne();
    if (!row) break; // nothing pending

    try {
      await deliver(row);
      await NotificationOutbox.updateOne(
        { _id: row._id },
        {
          $set: {
            status: "delivered",
            deliveredAt: new Date(),
            lastError: "",
            claimedBy: null,
            claimUntil: null,
          },
        },
      );
      delivered++;
    } catch (err) {
      if (row.attempts >= MAX_ATTEMPTS) {
        // Out of retries — park for human review.
        await NotificationOutbox.updateOne(
          { _id: row._id },
          {
            $set: {
              status: "dead_letter",
              lastError: err.message.slice(0, 500),
              claimedBy: null,
              claimUntil: null,
            },
          },
        );
        deadLettered++;
        console.warn(chalk.red(
          `[outbox] dead_letter id=${row._id} type=${row.type} reason=${err.message}`,
        ));
      } else {
        // Schedule a retry with exponential backoff.
        const delay = RETRY_DELAYS_MS[Math.min(row.attempts - 1, RETRY_DELAYS_MS.length - 1)];
        await NotificationOutbox.updateOne(
          { _id: row._id },
          {
            $set: {
              status: "pending",
              nextAttemptAt: new Date(Date.now() + delay),
              lastError: err.message.slice(0, 500),
              claimedBy: null,
              claimUntil: null,
            },
          },
        );
        failed++;
      }
    }
  }

  return { delivered, failed, deadLettered };
};

/* ──────────────────────────────────────────────────────────────────────
 * Admin recovery
 * ────────────────────────────────────────────────────────────────────── */

/** Force a dead-letter row back to pending with a clean attempt counter. */
export const requeueDeadLetter = async (id) => {
  return NotificationOutbox.findOneAndUpdate(
    { _id: id, status: "dead_letter" },
    {
      $set: {
        status: "pending",
        attempts: 0,
        nextAttemptAt: new Date(),
        lastError: "",
      },
    },
    { returnDocument: "after" },
  );
};
