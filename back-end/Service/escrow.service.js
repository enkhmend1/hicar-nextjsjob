/**
 * Escrow service — owns the money-split math.
 *
 * Phase-1 scope: at payment time, freeze every line item's commission rate
 * and bank info from each seller's profile, compute the platform fee, and
 * write totals onto the order. The money itself stays in the platform's
 * bank account (the escrow) until Phase-2 release.
 *
 * Everything here is pure data manipulation — no I/O — so it's trivially
 * unit-testable and can be called from either the QPay callback or the
 * polling check (whichever lands first).
 */

import mongoose from "mongoose";
import Order from "../Model/order.model.js";
import User from "../Model/user.model.js";
import { appendAudit } from "./financialAudit.service.js";

/**
 * Round to integer MNT — Mongolian tögrög has no fractional unit in practice.
 * We round HALF-AWAY-FROM-ZERO so 50.5 → 51, −50.5 → −51, never 50.0.
 */
const roundMNT = (n) => Math.sign(n) * Math.round(Math.abs(n));

/**
 * Compute the escrow split for an order WITHOUT persisting it.
 * Pure function — easy to unit-test.
 *
 * @param {object} order   - Mongoose Order document (or plain object)
 * @param {Map}    feeMap  - Map<sellerIdString, { feePercent, bankSnapshot }>
 * @returns {{
 *   items: Array<{ lineRevenue, platformFee, sellerPayout, sellerFeePercent, bankSnapshot }>,
 *   platformFeeTotal: number,
 *   sellerPayoutTotal: number,
 *   escrowAmount: number,
 * }}
 */
export const computeSplit = (order, feeMap) => {
  const itemsOut = [];
  let platformFeeTotal = 0;
  let sellerPayoutTotal = 0;

  for (const it of order.items) {
    const lineRevenue = roundMNT((it.price || 0) * (it.quantity || 0));
    const sellerKey = String(it.seller || "");
    const meta = feeMap.get(sellerKey) || {
      feePercent: 5,
      bankSnapshot: { bankName: "", bankAccount: "", bankHolderName: "" },
    };
    const platformFee  = roundMNT((lineRevenue * meta.feePercent) / 100);
    const sellerPayout = lineRevenue - platformFee;

    platformFeeTotal  += platformFee;
    sellerPayoutTotal += sellerPayout;

    itemsOut.push({
      lineRevenue,
      platformFee,
      sellerPayout,
      sellerFeePercent: meta.feePercent,
      bankSnapshot: meta.bankSnapshot,
    });
  }

  // Escrow holds the seller-payout portion; the platform fee is income
  // recognised on payment. Delivery fee is NOT escrowed — it's a logistics
  // pass-through (Phase-2 will route it to the courier or absorb it).
  return {
    items: itemsOut,
    platformFeeTotal,
    sellerPayoutTotal,
    escrowAmount: sellerPayoutTotal,
  };
};

/**
 * Load the fee+bank metadata for every seller referenced by the order's
 * line items. One round-trip to Mongo regardless of how many items.
 */
const loadFeeMap = async (order, session) => {
  const sellerIds = [
    ...new Set(
      order.items
        .map((i) => i.seller && String(i.seller))
        .filter(Boolean),
    ),
  ];
  if (sellerIds.length === 0) return new Map();

  const query = User.find(
    { _id: { $in: sellerIds } },
    "sellerProfile.platformFeePercent sellerProfile.bankName sellerProfile.bankAccount sellerProfile.bankHolderName",
  );
  if (session) query.session(session);
  const sellers = await query.lean();

  const map = new Map();
  for (const s of sellers) {
    const sp = s.sellerProfile || {};
    map.set(String(s._id), {
      feePercent: typeof sp.platformFeePercent === "number" ? sp.platformFeePercent : 5,
      bankSnapshot: {
        bankName:       sp.bankName       || "",
        bankAccount:    sp.bankAccount    || "",
        bankHolderName: sp.bankHolderName || "",
      },
    });
  }
  return map;
};

/**
 * Atomically mark an order PAID and freeze its escrow split.
 *
 * Idempotent: safe to call multiple times — if the order is already PAID,
 * this is a no-op and returns false. Concurrency-safe via a Mongoose
 * transaction (the order is reloaded inside the txn under the same session).
 *
 * Returns `true` if THIS call was the one that actually marked it paid
 * (callers use this signal to fire the "payment confirmed" notification
 * exactly once).
 */
export const settleOrderPaid = async (orderId) => {
  // Standalone mongo (no replset) doesn't support transactions. Detect that
  // up-front and fall back to a non-transactional path. This keeps local
  // dev working without docker-compose-replica gymnastics.
  const supportsTxn = mongoose.connection?.client?.topology?.hasSessionSupport?.() ?? false;

  if (!supportsTxn) {
    return settleOrderPaidNoTxn(orderId);
  }

  const session = await mongoose.startSession();
  try {
    let didTransition = false;
    await session.withTransaction(async () => {
      const order = await Order.findById(orderId).session(session);
      if (!order) throw new Error("Захиалга олдсонгүй");

      // Idempotency: only the first caller transitions PENDING → PAID.
      if (order.paymentStatus !== "PENDING") {
        didTransition = false;
        return;
      }

      const feeMap = await loadFeeMap(order, session);
      const split = computeSplit(order, feeMap);

      // Apply the per-item snapshot. Mongoose subdocs don't react to in-place
      // mutation of an array element's nested object cleanly, so we rebuild.
      order.items = order.items.map((it, idx) => {
        const s = split.items[idx];
        return {
          ...(it.toObject ? it.toObject() : it),
          lineRevenue: s.lineRevenue,
          platformFee: s.platformFee,
          sellerPayout: s.sellerPayout,
          sellerFeePercent: s.sellerFeePercent,
          bankSnapshot: s.bankSnapshot,
        };
      });

      order.platformFeeTotal  = split.platformFeeTotal;
      order.sellerPayoutTotal = split.sellerPayoutTotal;
      order.escrowAmount      = split.escrowAmount;
      order.paymentStatus     = "PAID";
      order.status            = "paid";
      order.paidAt            = new Date();
      if (order.qpayInvoice) order.qpayInvoice.paid_at = order.paidAt;

      await order.save({ session });
      didTransition = true;
    });
    if (didTransition) {
      // Append a payment_settled event AFTER the transaction commits, so
      // the audit row reflects the canonical persisted state.
      const fresh = await Order.findById(orderId).select(
        "platformFeeTotal sellerPayoutTotal escrowAmount paidAt user items",
      ).lean();
      await appendAudit({
        type: "payment_settled",
        orderId,
        buyerId: fresh?.user,
        actor: "system",
        amount: fresh?.escrowAmount || 0,
        before: { paymentStatus: "PENDING" },
        after:  {
          paymentStatus: "PAID",
          platformFeeTotal:  fresh?.platformFeeTotal,
          sellerPayoutTotal: fresh?.sellerPayoutTotal,
          escrowAmount:      fresh?.escrowAmount,
        },
      });
    }
    return didTransition;
  } finally {
    await session.endSession();
  }
};

/**
 * Non-transactional fallback for standalone Mongo deployments.
 *
 * Relies on a single conditional `findOneAndUpdate` (PENDING → PAID) to
 * provide atomic transition; if two callers race, only one observes the
 * pre-image and only that one returns `true`.
 */
const settleOrderPaidNoTxn = async (orderId) => {
  const order = await Order.findById(orderId);
  if (!order) throw new Error("Захиалга олдсонгүй");
  if (order.paymentStatus !== "PENDING") return false;

  const feeMap = await loadFeeMap(order, null);
  const split = computeSplit(order, feeMap);

  const now = new Date();
  // Atomic test-and-set on paymentStatus. If another caller already moved
  // us off PENDING, this returns null and we report no transition.
  const updated = await Order.findOneAndUpdate(
    { _id: order._id, paymentStatus: "PENDING" },
    {
      $set: {
        items: order.items.map((it, idx) => {
          const s = split.items[idx];
          return {
            ...(it.toObject ? it.toObject() : it),
            lineRevenue: s.lineRevenue,
            platformFee: s.platformFee,
            sellerPayout: s.sellerPayout,
            sellerFeePercent: s.sellerFeePercent,
            bankSnapshot: s.bankSnapshot,
          };
        }),
        platformFeeTotal: split.platformFeeTotal,
        sellerPayoutTotal: split.sellerPayoutTotal,
        escrowAmount: split.escrowAmount,
        paymentStatus: "PAID",
        status: "paid",
        paidAt: now,
        "qpayInvoice.paid_at": now,
      },
    },
    { returnDocument: "after" },
  );
  if (updated) {
    await appendAudit({
      type: "payment_settled",
      orderId: updated._id,
      buyerId: updated.user,
      actor: "system",
      amount: updated.escrowAmount,
      before: { paymentStatus: "PENDING" },
      after: {
        paymentStatus: "PAID",
        platformFeeTotal:  updated.platformFeeTotal,
        sellerPayoutTotal: updated.sellerPayoutTotal,
        escrowAmount:      updated.escrowAmount,
      },
    });
  }
  return Boolean(updated);
};
