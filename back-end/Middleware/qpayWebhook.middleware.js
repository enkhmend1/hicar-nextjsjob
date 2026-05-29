/**
 * QPay callback authentication + abuse protection.
 *
 * The QPay v2 callback URL is public — QPay POSTs to it whenever a payment
 * lands. Without verification, ANYONE who guesses the URL + an orderId can
 * trigger our settlement flow (which then re-verifies with QPay before
 * actually changing anything, but the spam is still expensive).
 *
 * This middleware closes 3 doors:
 *
 *   ① Shared-secret token
 *      QPay v2 lets you embed any query/header you want in the callback
 *      URL — we register `…/callback?secret=$QPAY_CALLBACK_SECRET` with QPay
 *      and reject anything that doesn't match. Constant-time compare so a
 *      timing attack can't tease out the secret character-by-character.
 *
 *   ② ObjectId validation on `orderId`
 *      Stops blind injection of arbitrary strings into the downstream
 *      Order.findById call. (Mongoose tolerates non-ObjectId strings but
 *      explicit guards are cheaper than letting bad input travel deep.)
 *
 *   ③ Short replay window
 *      A correctly-signed callback arriving repeatedly within 10 seconds is
 *      QPay (or an attacker who got hold of the secret) retrying — we
 *      already drove the settlement on the first call. The replay guard
 *      saves a wasteful checkPayment round-trip and keeps the upstream
 *      polite. Backed by Redis SETEX; falls open if Redis is offline
 *      (settleOrderPaid is itself idempotent so duplicates are safe).
 */

import crypto from "crypto";
import mongoose from "mongoose";
import { redis, redisEnabled } from "../Config/redis.js";

const CALLBACK_SECRET = process.env.QPAY_CALLBACK_SECRET || "";
const REPLAY_WINDOW_SECONDS = Number(process.env.QPAY_REPLAY_WINDOW_S) || 10;

/**
 * Constant-time string compare. `crypto.timingSafeEqual` requires equal-
 * length buffers, so we pad one side if needed — but ONLY when the lengths
 * match in the first place (a length mismatch already means "wrong" and
 * is safe to short-circuit, since the length of the secret is not itself
 * a secret).
 */
const safeEqual = (a, b) => {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  const A = Buffer.from(a);
  const B = Buffer.from(b);
  return crypto.timingSafeEqual(A, B);
};

export const verifyQpayCallback = async (req, res, next) => {
  // ── ① Shared-secret check ──────────────────────────────────────────
  // Accept the secret from a query string (QPay v2 default), or an
  // `X-QPay-Signature` header for setups that prefer headers.
  if (CALLBACK_SECRET) {
    const provided =
      String(req.query?.secret || req.headers["x-qpay-signature"] || "");
    if (!provided || !safeEqual(provided, CALLBACK_SECRET)) {
      return res.status(401).json({ message: "Invalid callback signature" });
    }
  } else {
    // No secret configured. In production this is a security hole — anyone
    // who knows the callback URL can trigger settlement attempts. Reject the
    // request with a 503 so QPay retries later (after the secret is set in
    // env). In non-production environments, skip the check and log loudly.
    const isProd = process.env.NODE_ENV === "production";
    if (isProd) {
      console.error(
        "[qpay.callback] FATAL: QPAY_CALLBACK_SECRET is not set in production — rejecting callback",
      );
      return res.status(503).json({ message: "Payment callback misconfigured — contact admin" });
    }
    console.warn(
      "[qpay.callback] WARNING: QPAY_CALLBACK_SECRET is not set — callback is unauthenticated (dev only)",
    );
  }

  // ── ② orderId shape check ──────────────────────────────────────────
  const orderId = req.query?.orderId || req.body?.orderId;
  if (!orderId || !mongoose.Types.ObjectId.isValid(String(orderId))) {
    return res.status(400).json({ message: "Invalid orderId" });
  }

  // ── ③ Replay guard ─────────────────────────────────────────────────
  // Use Redis SET NX (set-if-not-exists) as a one-shot lock per orderId.
  // If the key already exists, another callback for this order landed
  // within the last REPLAY_WINDOW_SECONDS — respond 200 OK without
  // re-driving settlement (settleOrderPaid is idempotent anyway, but
  // saving the checkPayment round-trip keeps the upstream polite).
  if (redisEnabled && redis) {
    try {
      const key = `qpay:cb:${orderId}`;
      const set = await redis.set(key, "1", "EX", REPLAY_WINDOW_SECONDS, "NX");
      if (set === null) {
        return res.status(200).json({ ok: true, replayed: true });
      }
    } catch {
      // Redis blip — fail open. Downstream idempotency carries us.
    }
  }

  next();
};
