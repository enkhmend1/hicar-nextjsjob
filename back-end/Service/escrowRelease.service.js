/**
 * Escrow release service.
 *
 * Owns the "release money from platform escrow to the seller" transition.
 * Pure orchestration — the actual bank disbursement is downstream (manual
 * transfer or a future Mongolian bank API). What we do here is:
 *
 *   1. Verify the order is still in a releasable state (paid, no open
 *      dispute, not already paid out).
 *   2. Mark `paymentStatus = "PAID_OUT"` and stamp `escrowReleasedAt`.
 *   3. Bump the seller's `totalSales` lifetime counter.
 *   4. Notify the seller so they know payout is queued.
 *
 * Idempotent — calling release on an already-released order is a no-op.
 *
 * Release WINDOW is computed from the seller's trust score. Higher trust =
 * shorter window (faster payout), capped at 3 days minimum so there's
 * always SOME dispute window for the buyer.
 */

import Order from "../Model/order.model.js";
import User from "../Model/user.model.js";
import { notify } from "./notification.service.js";
import { appendAudit } from "./financialAudit.service.js";

const MIN_HOLD_DAYS = 3;
const MAX_HOLD_DAYS = 14;
const DEFAULT_HOLD_DAYS = 7;

/**
 * Compute when the escrow should release for a freshly-delivered order.
 * Higher trustScore = faster release (linear, clamped).
 */
export const computeReleaseDate = (sellerTrustScore = 50, now = new Date()) => {
  const t = Math.max(0, Math.min(100, sellerTrustScore));
  // Linear: trust=0 → 14d, trust=100 → 3d
  const days = Math.round(MAX_HOLD_DAYS - (t / 100) * (MAX_HOLD_DAYS - MIN_HOLD_DAYS));
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
};

/**
 * Resolve the average trust score across all sellers in an order (a single
 * order can contain items from multiple sellers — we pick the SLOWEST hold
 * so every seller has the same dispute window).
 */
export const computeHoldForOrder = async (order) => {
  const sellerIds = [...new Set(order.items.map((i) => i.seller && String(i.seller)).filter(Boolean))];
  if (sellerIds.length === 0) {
    return { releaseAt: new Date(Date.now() + DEFAULT_HOLD_DAYS * 24 * 60 * 60 * 1000) };
  }
  const sellers = await User.find({ _id: { $in: sellerIds } })
    .select("sellerProfile.trustScore")
    .lean();
  const minTrust = sellers
    .map((s) => s.sellerProfile?.trustScore ?? 50)
    .reduce((acc, t) => Math.min(acc, t), 100);
  return { releaseAt: computeReleaseDate(minTrust) };
};

/**
 * Distribute a per-order penalty across the seller payouts proportionally
 * to each seller's share of the original payout total. Pure function.
 *
 * Why proportional? In a multi-seller order, the penalty might be due to
 * one seller's fault, but for Phase-2 simplicity the order-level field is
 * a single number. Splitting it proportionally is a reasonable default —
 * the dispute service only allows single-seller disputes anyway, so in
 * practice this maps the entire penalty onto the at-fault seller.
 *
 * Rounds individual deductions HALF-UP and absorbs the residual on the
 * first seller, so Σ(deductions) === penalty exactly (no lost MNT).
 */
export const distributePenalty = (perSellerPayouts, penalty) => {
  if (!(penalty > 0) || perSellerPayouts.size === 0) return new Map(perSellerPayouts);
  const total = [...perSellerPayouts.values()].reduce((a, b) => a + b, 0);
  if (total <= 0) return new Map(perSellerPayouts);

  const entries = [...perSellerPayouts.entries()];
  const deductions = entries.map(([, p]) => Math.round((p / total) * penalty));
  // Reconcile rounding residual onto the first entry so the sum is exact.
  const residual = penalty - deductions.reduce((a, b) => a + b, 0);
  if (residual !== 0) deductions[0] += residual;

  return new Map(entries.map(([s, p], i) => [s, Math.max(0, p - deductions[i])]));
};

/**
 * Actually release the escrow. Pure status transition + side effects.
 * Returns { released: boolean, reason?: string }.
 *
 * Money math:
 *   gross    = order.sellerPayoutTotal       (sum of per-item sellerPayout)
 *   refunded = order.refundedAmount          (cumulative refunds to buyer)
 *   penalty  = order.returnShippingPenalty   (deducted, kept by platform)
 *   payable  = max(0, gross − refunded − penalty)
 *
 * The penalty is deducted from the seller's payout and remains with the
 * platform — it's neither refunded to the buyer (already done separately
 * via the dispute refund) nor paid out.
 */
export const releaseEscrow = async (orderId) => {
  const order = await Order.findById(orderId);
  if (!order) return { released: false, reason: "order_not_found" };

  // Idempotency + safety guards. Accept PAID (clean) and PARTIAL_REFUND
  // (where a previous partial refund left money to release). Reject the
  // DISPUTED lock state outright — it's the schema-level twin of
  // hasOpenDispute and forms our defence-in-depth against a stale flag.
  if (!["PAID", "PARTIAL_REFUND"].includes(order.paymentStatus)) {
    return { released: false, reason: `not_releasable:${order.paymentStatus}` };
  }
  if (order.hasOpenDispute)         return { released: false, reason: "open_dispute" };
  if (order.status === "cancelled") return { released: false, reason: "cancelled" };
  if (order.escrowAmount <= 0)      return { released: false, reason: "no_escrow" };

  const releaseAmount = Math.max(0,
    order.escrowAmount - (order.refundedAmount || 0) - (order.returnShippingPenalty || 0));
  if (releaseAmount <= 0) return { released: false, reason: "fully_refunded_or_penalised" };

  // Atomic transition. Conditional on still being PAID/PARTIAL_REFUND AND
  // hasOpenDispute=false so a race with the dispute flow doesn't
  // double-release.
  const updated = await Order.findOneAndUpdate(
    {
      _id: order._id,
      paymentStatus: { $in: ["PAID", "PARTIAL_REFUND"] },
      hasOpenDispute: false,
    },
    {
      $set: {
        paymentStatus: "PAID_OUT",
        escrowReleasedAt: new Date(),
        escrowReleaseScheduledAt: null,
      },
    },
    { returnDocument: "after" },
  );
  if (!updated) return { released: false, reason: "race_lost" };

  // Build per-seller payout map from the frozen line items. Then apply the
  // refund + penalty deductions in proportion to each seller's gross share.
  const perSellerGross = new Map();
  for (const it of updated.items) {
    const key = it.seller && String(it.seller);
    if (!key) continue;
    perSellerGross.set(key, (perSellerGross.get(key) || 0) + (it.sellerPayout || 0));
  }
  // Deduct refunds (already paid to buyer) and penalty (kept by platform).
  // Refunds reduce specific sellers' obligations — but for a single-seller
  // dispute (which is all we currently support) it falls on the one seller.
  // For simplicity we apply both deductions proportionally.
  const totalDeduction = (updated.refundedAmount || 0) + (updated.returnShippingPenalty || 0);
  const perSeller = distributePenalty(perSellerGross, totalDeduction);

  // Lifetime sales counter — bumped per seller.
  await Promise.all(
    [...perSeller.entries()].map(([sellerId, payout]) =>
      User.updateOne(
        { _id: sellerId },
        { $inc: { "sellerProfile.totalSales": payout } },
      ),
    ),
  );

  // Fire-and-forget seller notifications.
  for (const [sellerId, payout] of perSeller) {
    notify({
      user: sellerId,
      type: "escrow_released",
      title: "Escrow төлбөр шилжүүлж байна ✓",
      body: `Захиалга #${String(updated._id).slice(-8).toUpperCase()} — ₮${payout.toLocaleString()} таны дансаар явна.`,
      link: "/seller/orders",
      data: { orderId: String(updated._id), amount: payout },
      email: true,
    });
  }

  // Append one audit row per seller that received a payout. Per-seller
  // granularity makes the audit log queryable by seller (e.g. for tax
  // reporting or seller payment reconciliation).
  for (const [sellerId, payout] of perSeller) {
    await appendAudit({
      type: "escrow_released",
      orderId: updated._id,
      sellerId,
      actor: "system",
      amount: payout,
      before: { paymentStatus: order.paymentStatus },
      after:  { paymentStatus: "PAID_OUT" },
      metadata: {
        refundedAmount: updated.refundedAmount || 0,
        returnShippingPenalty: updated.returnShippingPenalty || 0,
        grossPayout: perSellerGross.get(sellerId),
      },
    });
  }

  return {
    released: true,
    amount: releaseAmount,
    refundedAmount: updated.refundedAmount || 0,
    returnShippingPenalty: updated.returnShippingPenalty || 0,
    sellers: [...perSeller.keys()],
  };
};
