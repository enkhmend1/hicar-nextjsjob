/**
 * Dispute service — state machine for the buyer↔seller↔AI↔admin flow.
 *
 * Every external entrypoint goes through exactly one of these functions
 * so the legal transitions are documented in code rather than scattered
 * across controllers:
 *
 *   createDispute(buyerId, orderId, payload)        → status = open → awaiting_seller
 *   submitSellerResponse(disputeId, sellerId, …)    → awaiting_seller → ai_analyzing → awaiting_buyer/escalated
 *   buyerAcceptOffer(disputeId, buyerId)            → awaiting_buyer → resolved_refund
 *   buyerRejectOffer(disputeId, buyerId)            → awaiting_buyer → escalated_admin
 *   escalateToAdmin(disputeId, who)                 → * → escalated_admin
 *   adminResolve(disputeId, adminId, action, …)     → escalated_admin → resolved_*
 *   withdrawDispute(disputeId, buyerId)             → open|awaiting_* → cancelled
 *   addMessage(disputeId, who, text, images)        → keeps current status, appends to thread
 *   handleDeadlineExpired(disputeId, expectedStatus)→ worker-only, time-driven transitions
 *
 * Side effects (refunds, escrow release, notifications, deadline scheduling)
 * all flow through this file — controllers stay thin transport adapters.
 */

import chalk from "chalk";

import Dispute from "../Model/dispute.model.js";
import Order from "../Model/order.model.js";

import { notify, notifyAdmins } from "./notification.service.js";
import { analyseDispute } from "./fraud.service.js";
import { refundPayment } from "./qpay.service.js";
import { applyResolutionDelta } from "./trustScore.service.js";
import { appendAudit } from "./financialAudit.service.js";
// releaseEscrow is not called directly here — all release paths go through
// scheduleRelease (BullMQ delayed job), which lets the escrow service stay
// the single owner of the "is this releasable?" guard.
import {
  scheduleDeadline, cancelDeadline,
  SELLER_RESPONSE_WINDOW_MS, BUYER_RESPONSE_WINDOW_MS,
} from "../Queue/disputeDeadline.queue.js";
import { cancelScheduledRelease } from "../Queue/escrowRelease.queue.js";

const shortId = (id) => String(id).slice(-8).toUpperCase();

/* ──────────────────────────────────────────────────────────────────────
 * Helpers
 * ────────────────────────────────────────────────────────────────────── */

/**
 * Apply a refund. Pure orchestration:
 *   1. Hit QPay refund API (real or mock based on qpayEnabled).
 *   2. Update Order.refundedAmount + paymentStatus (PAID → REFUNDED or PARTIAL_REFUND).
 *   3. Adjust the seller's totalSales if escrow had been released already (rare).
 *
 * Idempotent against double-call: we only proceed if refundedAmount + amount
 * is ≤ escrowAmount.
 */
const applyRefund = async ({ order, amount, note }) => {
  if (amount <= 0) throw new Error("Refund amount must be positive");
  const currentlyRefunded = order.refundedAmount || 0;
  if (currentlyRefunded + amount > order.escrowAmount) {
    throw new Error(`Refund amount ₮${amount} exceeds escrow balance`);
  }

  // Go to QPay first — if it fails we don't want a half-refunded local state.
  const qpay = await refundPayment({
    invoiceId: order.qpayInvoice?.invoice_id,
    amount,
    note,
  });

  const newRefunded = currentlyRefunded + amount;
  const fullyRefunded = newRefunded >= order.escrowAmount;
  const fresh = await Order.findOneAndUpdate(
    { _id: order._id },
    {
      $set: {
        refundedAmount: newRefunded,
        refundedAt: new Date(),
        paymentStatus: fullyRefunded ? "REFUNDED" : "PARTIAL_REFUND",
      },
    },
    { returnDocument: "after" },
  );

  // Audit the refund. Append-only — no further mutation of this row.
  await appendAudit({
    type: "refund_issued",
    orderId: fresh._id,
    buyerId: fresh.user,
    actor:   "system",
    amount,
    before: {
      paymentStatus: order.paymentStatus,
      refundedAmount: currentlyRefunded,
    },
    after: {
      paymentStatus: fresh.paymentStatus,
      refundedAmount: fresh.refundedAmount,
    },
    metadata: {
      qpayRefundId: qpay.refundId,
      qpayMocked: Boolean(qpay.mocked),
      note,
    },
  });

  return { qpayRefundId: qpay.refundId, fullyRefunded, order: fresh };
};

/**
 * Sync the order's dispute flags with the live state of its disputes.
 *
 * Two responsibilities:
 *   ① Set hasOpenDispute boolean from the live count of non-terminal disputes.
 *   ② When the last dispute resolves AND paymentStatus is still in the
 *      DISPUTED lock state (i.e. resolveWithRelease was called, no refund
 *      happened), restore paymentStatus to whatever it should be given the
 *      refundedAmount on the order. Without this restoration, an order
 *      whose dispute ends in "release to seller" would stay DISPUTED
 *      forever and the auto-payout worker would refuse to release it.
 *
 * Idempotent — safe to call multiple times.
 */
const recomputeOpenDisputeFlag = async (orderId) => {
  const openCount = await Dispute.countDocuments({
    order: orderId,
    status: { $nin: ["resolved_refund", "resolved_release", "resolved_partial", "cancelled"] },
  });
  if (openCount > 0) {
    await Order.updateOne({ _id: orderId }, { $set: { hasOpenDispute: true } });
    return;
  }

  const order = await Order.findById(orderId).select("paymentStatus refundedAmount escrowAmount");
  if (!order) return;

  // If applyRefund already moved paymentStatus to REFUNDED / PARTIAL_REFUND,
  // we leave it alone. Only the DISPUTED-lock state needs unwinding.
  let nextStatus = order.paymentStatus;
  if (order.paymentStatus === "DISPUTED") {
    const refunded = order.refundedAmount || 0;
    if (refunded <= 0)                       nextStatus = "PAID";
    else if (refunded >= order.escrowAmount) nextStatus = "REFUNDED";
    else                                     nextStatus = "PARTIAL_REFUND";
  }
  await Order.updateOne(
    { _id: orderId },
    { $set: { hasOpenDispute: false, paymentStatus: nextStatus } },
  );
};

/* ──────────────────────────────────────────────────────────────────────
 * Public API
 * ────────────────────────────────────────────────────────────────────── */

/**
 * Create a dispute.
 *
 * Bulletproof creation flow:
 *   1. Read-only validations against the loaded order (cheap, fail-fast).
 *   2. ATOMIC LOCK — a single findOneAndUpdate that flips
 *      `paymentStatus PAID|PARTIAL_REFUND → DISPUTED` AND
 *      `hasOpenDispute false → true` in one go. Two buyers racing to file
 *      disputes on the same order can both pass step 1, but only ONE will
 *      see the lock succeed — the other gets null and bails out without
 *      leaving the order in a bad state.
 *   3. Cancel the pending escrow-release worker job (best-effort).
 *   4. Insert the Dispute document.
 *   5. Schedule the seller-response deadline.
 *   If steps 4 or 5 throw, ROLLBACK the order lock so the order isn't
 *   stranded in DISPUTED forever.
 */
export const createDispute = async (buyerId, orderId, payload) => {
  const order = await Order.findById(orderId);
  if (!order) throw new Error("Захиалга олдсонгүй");
  if (String(order.user) !== String(buyerId)) {
    throw new Error("Энэ захиалгыг та өгөөгүй");
  }
  if (!["paid", "processing", "shipped", "delivered"].includes(order.status)) {
    throw new Error(`Энэ төлөвт маргаан гаргах боломжгүй: ${order.status}`);
  }
  if (order.paymentStatus !== "PAID" && order.paymentStatus !== "PARTIAL_REFUND") {
    throw new Error("Төлбөргүй захиалгад маргаан гаргах боломжгүй");
  }
  if (order.hasOpenDispute) {
    throw new Error("Энэ захиалгад хэдийнэ нээлттэй маргаан байна");
  }

  const refundable = order.escrowAmount - (order.refundedAmount || 0);
  const requested = Math.min(Math.max(0, Number(payload.requestedRefundAmount) || 0), refundable);
  if (requested <= 0) throw new Error("Буцаах боломжтой дүн алга");

  // Pick the seller for the disputed items. If the buyer doesn't specify
  // line items, default to "all sellers in this order".
  const lineItems = payload.itemProductIds?.length
    ? order.items.filter((i) => payload.itemProductIds.map(String).includes(String(i.product)))
    : order.items;
  if (lineItems.length === 0) throw new Error("Тухайн бараа захиалгад байхгүй");

  const sellerSet = [...new Set(lineItems.map((i) => i.seller && String(i.seller)).filter(Boolean))];
  if (sellerSet.length !== 1) {
    throw new Error("Олон seller-тэй захиалгад тус тусд нь маргаан гаргана уу");
  }
  const sellerId = sellerSet[0];

  // ── ② Atomic escrow lock ─────────────────────────────────────────
  // Conditional update — only proceeds if the order is still in a
  // disputable state. Returns null otherwise (concurrent dispute race).
  const lockedOrder = await Order.findOneAndUpdate(
    {
      _id: order._id,
      paymentStatus: { $in: ["PAID", "PARTIAL_REFUND"] },
      hasOpenDispute: false,
      status: { $in: ["paid", "processing", "shipped", "delivered"] },
    },
    { $set: { hasOpenDispute: true, paymentStatus: "DISPUTED" } },
    { returnDocument: "after" },
  );
  if (!lockedOrder) {
    throw new Error("Захиалгыг өөр процесс өөрчилсөн байж магадгүй — дахин оролдоно уу");
  }

  // ── ③ Cancel the pending escrow release worker ───────────────────
  // The hasOpenDispute flag + DISPUTED paymentStatus already block the
  // worker from paying out, but cancelling the actual job is cleaner.
  await cancelScheduledRelease(lockedOrder).catch(() => {});

  // ── ④/⑤ Insert dispute + schedule deadline — with rollback ───────
  let dispute = null;
  try {
    dispute = await Dispute.create({
      order: order._id,
      buyer: buyerId,
      seller: sellerId,
      itemProductIds: lineItems.map((i) => i.product),
      reason: payload.reason,
      description: payload.description,
      evidenceImages: payload.evidenceImages || [],
      requestedRefundAmount: requested,
      status: "awaiting_seller",
      messages: [
        {
          author: "system",
          text: `Маргаан үүсгэгдсэн. Шалтгаан: ${payload.reason}. Хүсэлт: ₮${requested.toLocaleString()}.`,
        },
      ],
    });

    const { jobId, deadlineAt } = await scheduleDeadline(dispute, SELLER_RESPONSE_WINDOW_MS);
    dispute.deadlineJobId = jobId;
    dispute.responseDeadline = deadlineAt;
    await dispute.save();
  } catch (err) {
    // ROLLBACK the lock. Best-effort — we WANT this to succeed but if it
    // somehow doesn't, the standalone cron job that reconciles orphaned
    // DISPUTED orders will pick it up. For now, log loudly.
    const refunded = lockedOrder.refundedAmount || 0;
    const restoredStatus = refunded > 0 ? "PARTIAL_REFUND" : "PAID";
    await Order.updateOne(
      { _id: order._id, paymentStatus: "DISPUTED" },
      { $set: { hasOpenDispute: false, paymentStatus: restoredStatus } },
    ).catch((e) => console.error(chalk.red(`[createDispute rollback] ${e.message}`)));

    if (dispute?._id) {
      await Dispute.deleteOne({ _id: dispute._id }).catch(() => {});
    }

    // Re-schedule the release we cancelled, if the order had reached delivery.
    if (lockedOrder.status === "delivered") {
      const { scheduleRelease } = await import("../Queue/escrowRelease.queue.js");
      const fresh = await Order.findById(order._id);
      if (fresh) await scheduleRelease(fresh).catch(() => {});
    }
    throw err;
  }

  // Tell the seller, loud.
  notify({
    user: sellerId,
    type: "dispute_opened",
    title: "Маргаан ⚠️",
    body: `#${shortId(order._id)} — ${payload.reason}. 48 цагт хариу өгнө үү.`,
    link: "/seller/disputes",
    data: { disputeId: String(dispute._id), orderId: String(order._id) },
    email: true,
  });

  return dispute;
};

/**
 * Seller responds to an awaiting_seller dispute.
 *
 * action:
 *   "refund_offered"          → offer full requested refund
 *   "partial_refund_offered"  → offer some amount < requested
 *   "rejected"                → deny the claim entirely
 *
 * Triggers AI analysis after the response and moves to awaiting_buyer
 * (if the AI's recommendation aligns with the seller's offer) or to
 * escalated_admin (if the AI disagrees or is uncertain).
 */
export const submitSellerResponse = async (disputeId, sellerId, { action, offeredAmount, message }) => {
  if (!["refund_offered", "partial_refund_offered", "rejected"].includes(action)) {
    throw new Error("Үйлдэл буруу");
  }
  const dispute = await Dispute.findById(disputeId);
  if (!dispute) throw new Error("Маргаан олдсонгүй");
  if (String(dispute.seller) !== String(sellerId)) throw new Error("Эрхгүй");
  if (dispute.status !== "awaiting_seller") {
    throw new Error(`Энэ төлөвт хариу өгөх боломжгүй: ${dispute.status}`);
  }

  const amt = Number(offeredAmount) || 0;
  if (action === "partial_refund_offered" && (amt <= 0 || amt >= dispute.requestedRefundAmount)) {
    throw new Error("Хэсэгчилсэн буцаалт дүн зөв оруулна уу");
  }

  dispute.sellerResponse = {
    action,
    offeredAmount: action === "refund_offered" ? dispute.requestedRefundAmount
      : action === "partial_refund_offered" ? amt
      : 0,
    message: (message || "").slice(0, 2000),
    respondedAt: new Date(),
  };
  dispute.messages.push({
    author: "seller",
    text: message || (action === "rejected"
      ? "Худалдагч маргааныг хүлээн зөвшөөрөхгүй."
      : action === "partial_refund_offered"
        ? `Худалдагч хэсэгчилсэн буцаалт санал болгож байна: ₮${amt.toLocaleString()}`
        : `Худалдагч бүрэн буцаалт зөвшөөрсөн: ₮${dispute.requestedRefundAmount.toLocaleString()}`),
  });
  dispute.status = "ai_analyzing";
  await cancelDeadline(dispute).catch(() => {});
  await dispute.save();

  // Run AI analysis (returns a payload to write into aiAnalysis).
  const ai = await analyseDispute(dispute);
  dispute.aiAnalysis = ai;
  dispute.messages.push({
    author: "ai",
    text: `AI үнэлгээ: ${ai.reasoning} (fraudScore=${ai.fraudScore}, confidence=${ai.confidence}, action=${ai.recommendedAction})`,
  });

  // Decide next state.
  //   - If seller offered full refund: skip the buyer-accept step, refund now.
  //   - If AI is confident the buyer is honest AND seller rejected → escalate.
  //   - If AI is confident the buyer is fraudulent → release escrow to seller.
  //   - Otherwise → awaiting_buyer (buyer reviews seller's offer).
  let nextStatus;
  if (action === "refund_offered") {
    // Seller pre-agreed to full refund — short-circuit.
    nextStatus = await resolveWithRefund(dispute, dispute.requestedRefundAmount, "seller_agreed");
    return dispute.populate(["order", "buyer", "seller"]);
  }

  if (ai.recommendedAction === "release_seller" && ai.confidence >= 70) {
    // AI is sure the claim is fraudulent → release escrow, end dispute.
    nextStatus = await resolveWithRelease(dispute, "ai_auto");
    return dispute.populate(["order", "buyer", "seller"]);
  }

  if (ai.recommendedAction === "refund_full" && ai.confidence >= 70 && action === "rejected") {
    // Seller stonewalled but AI says claim is legit. Auto-refund.
    nextStatus = await resolveWithRefund(dispute, dispute.requestedRefundAmount, "ai_auto");
    return dispute.populate(["order", "buyer", "seller"]);
  }

  if (ai.recommendedAction === "escalate" || ai.confidence < 60) {
    dispute.status = "escalated_admin";
    dispute.escalatedAt = new Date();
    dispute.responseDeadline = null;
    dispute.deadlineJobId = null;
    await dispute.save();
    notifyAdmins({
      type: "dispute_escalated",
      title: "Маргаан — admin шийдэх",
      body: `#${shortId(dispute.order)} AI uncertain (score=${ai.fraudScore}, conf=${ai.confidence})`,
      link: "/admin/disputes",
      data: { disputeId: String(dispute._id) },
    });
    return dispute.populate(["order", "buyer", "seller"]);
  }

  // Default: ball is in the buyer's court — they review the seller's
  // (partial-refund or rejection) and pick accept/reject.
  dispute.status = "awaiting_buyer";
  const { jobId, deadlineAt } = await scheduleDeadline(dispute, BUYER_RESPONSE_WINDOW_MS);
  dispute.deadlineJobId = jobId;
  dispute.responseDeadline = deadlineAt;
  await dispute.save();

  notify({
    user: dispute.buyer,
    type: "dispute_response",
    title: "Худалдагч хариу өгсөн",
    body: action === "rejected"
      ? "Худалдагч таны нэхэмжлэлийг зөвшөөрөхгүй байна — 48 цагт шийдэхээ илэрхийлнэ үү."
      : `Худалдагч ₮${amt.toLocaleString()} буцаалт санал болгож байна.`,
    link: `/orders`,
    data: { disputeId: String(dispute._id) },
    email: true,
  });
  return dispute.populate(["order", "buyer", "seller"]);
};

/** Buyer accepts the seller's offer. */
export const buyerAcceptOffer = async (disputeId, buyerId) => {
  const dispute = await Dispute.findById(disputeId);
  if (!dispute) throw new Error("Маргаан олдсонгүй");
  if (String(dispute.buyer) !== String(buyerId)) throw new Error("Эрхгүй");
  if (dispute.status !== "awaiting_buyer") throw new Error(`Бус төлөв: ${dispute.status}`);

  await cancelDeadline(dispute).catch(() => {});
  const offer = dispute.sellerResponse?.offeredAmount || 0;
  if (offer > 0) {
    await resolveWithRefund(dispute, offer, "buyer_accepted");
  } else {
    // Seller rejected, buyer accepts the rejection → release escrow.
    await resolveWithRelease(dispute, "buyer_accepted");
  }
  return dispute.populate(["order", "buyer", "seller"]);
};

/** Buyer rejects the seller's offer → escalate to admin. */
export const buyerRejectOffer = async (disputeId, buyerId, message = "") => {
  const dispute = await Dispute.findById(disputeId);
  if (!dispute) throw new Error("Маргаан олдсонгүй");
  if (String(dispute.buyer) !== String(buyerId)) throw new Error("Эрхгүй");
  if (dispute.status !== "awaiting_buyer") throw new Error(`Бус төлөв: ${dispute.status}`);

  await cancelDeadline(dispute).catch(() => {});
  dispute.status = "escalated_admin";
  dispute.escalatedAt = new Date();
  dispute.responseDeadline = null;
  dispute.deadlineJobId = null;
  dispute.messages.push({
    author: "buyer",
    text: message?.trim() || "Худалдан авагч санал зөвшөөрөхгүй — admin шийднэ үү.",
  });
  await dispute.save();

  notifyAdmins({
    type: "dispute_escalated",
    title: "Маргаан — admin шийдэх",
    body: `#${shortId(dispute.order)} buyer rejected seller offer`,
    link: "/admin/disputes",
    data: { disputeId: String(dispute._id) },
  });
  return dispute;
};

/**
 * Admin's final say.
 *
 * Body fields:
 *   action                  — refund_full | refund_partial | release_seller | reject_claim
 *   amount                  — required for refund_partial (₮)
 *   notes                   — admin audit note
 *   returnShippingPenalty   — optional. When the dispute is the seller's
 *     fault (wrong item, damaged, etc.) and the buyer needs to ship the
 *     item back, admin can deduct the shipping cost from the seller's
 *     eventual payout. Applied at escrow-release time (escrow.service).
 */
export const adminResolve = async (disputeId, adminId, { action, amount, notes, returnShippingPenalty }) => {
  if (!["refund_full", "refund_partial", "release_seller", "reject_claim"].includes(action)) {
    throw new Error("Үйлдэл буруу");
  }
  const dispute = await Dispute.findById(disputeId);
  if (!dispute) throw new Error("Маргаан олдсонгүй");
  if (!["escalated_admin", "ai_analyzing", "awaiting_buyer", "awaiting_seller"].includes(dispute.status)) {
    throw new Error(`Шийдэгдсэн маргаан: ${dispute.status}`);
  }

  // Penalty is admin-only and optional. Negative / NaN → 0.
  const penalty = Math.max(0, Math.round(Number(returnShippingPenalty) || 0));

  await cancelDeadline(dispute).catch(() => {});
  dispute.messages.push({
    author: "admin",
    text: (notes || `Admin шийдэв: ${action}`).slice(0, 2000),
  });

  if (action === "refund_full") {
    await resolveWithRefund(dispute, dispute.requestedRefundAmount, "admin",
      { adminId, notes, returnShippingPenalty: penalty });
  } else if (action === "refund_partial") {
    const n = Math.max(1, Math.min(dispute.requestedRefundAmount, Number(amount) || 0));
    await resolveWithRefund(dispute, n, "admin",
      { adminId, notes, partial: true, returnShippingPenalty: penalty });
  } else if (action === "release_seller" || action === "reject_claim") {
    await resolveWithRelease(dispute, "admin",
      { adminId, notes, rejected: action === "reject_claim", returnShippingPenalty: penalty });
  }
  return dispute.populate(["order", "buyer", "seller"]);
};

/**
 * Buyer withdraws an open dispute (before resolution).
 *
 * Flow:
 *   1. Mark dispute cancelled with resolution metadata (audit trail).
 *   2. recomputeOpenDisputeFlag → unlock paymentStatus DISPUTED → PAID
 *      (or PARTIAL_REFUND if there was a prior partial), clear hasOpenDispute.
 *   3. RE-SCHEDULE the escrow release (we cancelled it on dispute open).
 *      We do NOT release immediately — premature payout on a still-shipping
 *      order would lose buyer protection on the rest of the dispute window.
 *      Instead let the worker fire on the normal trust-based schedule
 *      (only if delivered; pre-delivery orders simply wait for the
 *      delivered transition in order.controller.updateStatus).
 */
export const withdrawDispute = async (disputeId, buyerId) => {
  const dispute = await Dispute.findById(disputeId);
  if (!dispute) throw new Error("Маргаан олдсонгүй");
  if (String(dispute.buyer) !== String(buyerId)) throw new Error("Эрхгүй");
  if (["resolved_refund", "resolved_release", "resolved_partial", "cancelled"].includes(dispute.status)) {
    throw new Error("Хэдийнэ шийдэгдсэн");
  }
  await cancelDeadline(dispute).catch(() => {});
  dispute.status = "cancelled";
  dispute.resolution = {
    action: "release_seller",
    amount: 0,
    returnShippingPenalty: 0,
    notes: "Buyer withdrew",
    resolvedBy: "buyer_withdrew",
    resolvedAt: new Date(),
    refundTxId: `withdraw-${dispute._id}`,
  };
  dispute.messages.push({ author: "buyer", text: "Маргааныг буцаав." });
  await dispute.save();

  // Unlock the order — DISPUTED → PAID/PARTIAL_REFUND — and clear hasOpenDispute.
  await recomputeOpenDisputeFlag(dispute.order);

  // Re-arm the escrow worker IF the order has actually been delivered.
  // Pre-delivery orders will be scheduled when they hit "delivered" via the
  // updateStatus controller.
  const fresh = await Order.findById(dispute.order);
  if (fresh
      && ["PAID", "PARTIAL_REFUND"].includes(fresh.paymentStatus)
      && !fresh.hasOpenDispute
      && fresh.status === "delivered") {
    const { scheduleRelease } = await import("../Queue/escrowRelease.queue.js");
    await scheduleRelease(fresh).catch((e) =>
      console.warn(chalk.yellow(`[dispute.withdraw] reschedule failed: ${e.message}`)));
  }
  return dispute;
};

/** Append a message to the dispute thread (no status change). */
export const addMessage = async (disputeId, { author, authorId, text, images = [] }) => {
  const dispute = await Dispute.findById(disputeId);
  if (!dispute) throw new Error("Маргаан олдсонгүй");
  // Permission: only the dispute's buyer / seller / admin may post.
  if (author === "buyer" && String(dispute.buyer) !== String(authorId)) throw new Error("Эрхгүй");
  if (author === "seller" && String(dispute.seller) !== String(authorId)) throw new Error("Эрхгүй");
  // Don't allow new messages after terminal resolution.
  if (["resolved_refund", "resolved_release", "resolved_partial", "cancelled"].includes(dispute.status)) {
    throw new Error("Хэдийнэ шийдэгдсэн");
  }
  dispute.messages.push({
    author,
    text: String(text || "").slice(0, 2000),
    images: Array.isArray(images) ? images.slice(0, 8) : [],
  });
  await dispute.save();
  return dispute;
};

/**
 * Worker entry — fired by the deadline queue when a response window
 * expires. Pulls the latest dispute state and checks it still matches
 * `expectedStatus` (early responses cancel the job, but a race can still
 * deliver the fire). Only transitions if the dispute is genuinely stuck.
 */
export const handleDeadlineExpired = async (disputeId, expectedStatus) => {
  const dispute = await Dispute.findById(disputeId);
  if (!dispute) return { transitioned: false, reason: "not_found" };
  if (dispute.status !== expectedStatus) {
    return { transitioned: false, reason: `status_changed:${dispute.status}` };
  }

  if (expectedStatus === "awaiting_seller") {
    // Seller never responded → auto-full-refund (buyer protection).
    dispute.messages.push({
      author: "system",
      text: "Худалдагч 48 цагт хариу өгөөгүй тул автомат бүрэн буцаалт хийгдэв.",
    });
    await resolveWithRefund(dispute, dispute.requestedRefundAmount, "deadline_seller");
    return { transitioned: true, newStatus: dispute.status };
  }

  if (expectedStatus === "awaiting_buyer") {
    // Buyer didn't accept/reject the seller's offer.
    //   If there's an offer with amount > 0 → treat as buyer-accepted (refund that amount).
    //   If seller had rejected the claim → release escrow to seller.
    const offer = dispute.sellerResponse?.offeredAmount || 0;
    dispute.messages.push({
      author: "system",
      text: offer > 0
        ? "Худалдан авагч 48 цагт хариу өгөөгүй — санал болгосон буцаалтыг автоматаар хүлээж авав."
        : "Худалдан авагч 48 цагт хариу өгөөгүй — escrow худалдагчид олгогдов.",
    });
    if (offer > 0) {
      await resolveWithRefund(dispute, offer, "deadline_buyer");
    } else {
      await resolveWithRelease(dispute, "deadline_buyer");
    }
    return { transitioned: true, newStatus: dispute.status };
  }

  return { transitioned: false, reason: `not_handled:${expectedStatus}` };
};

/* ──────────────────────────────────────────────────────────────────────
 * Terminal transitions — internal
 * ────────────────────────────────────────────────────────────────────── */

/**
 * Move a dispute to resolved_refund (or resolved_partial when not full)
 * and execute the actual refund against the order.
 *
 * extra:
 *   notes                 — admin audit text
 *   adminId               — set when resolvedBy === "admin"
 *   partial               — true for refund_partial actions (cosmetic)
 *   returnShippingPenalty — additive ₮ deducted from seller's payout at
 *                           release time. Persisted onto the Order so the
 *                           escrow worker can subtract it without joining
 *                           through Dispute.
 */
const resolveWithRefund = async (dispute, amount, resolvedBy, extra = {}) => {
  const order = await Order.findById(dispute.order);
  if (!order) throw new Error("Захиалга олдсонгүй");

  const { qpayRefundId, fullyRefunded } = await applyRefund({
    order, amount,
    note: `Dispute ${dispute._id} resolved by ${resolvedBy}`,
  });

  // Penalty handling: bump the order's running penalty so the release
  // worker subtracts the right amount. Multiple sub-disputes can add up.
  const penalty = Math.max(0, Math.round(extra.returnShippingPenalty || 0));
  if (penalty > 0) {
    await Order.updateOne(
      { _id: order._id },
      { $inc: { returnShippingPenalty: penalty } },
    );
  }

  dispute.status = fullyRefunded ? "resolved_refund" : "resolved_partial";
  dispute.resolution = {
    action: fullyRefunded ? "refund_full" : "refund_partial",
    amount,
    returnShippingPenalty: penalty,
    notes: extra.notes || "",
    resolvedBy,
    resolvedAt: new Date(),
    refundTxId: qpayRefundId,
  };
  dispute.responseDeadline = null;
  dispute.deadlineJobId = null;
  await dispute.save();
  await recomputeOpenDisputeFlag(dispute.order);

  // Reputation update — atomic + idempotent via the trust-score service's
  // per-dispute CAS lock. Pass dispute._id as the idempotency key so
  // BullMQ retries / admin double-clicks cannot apply the delta twice.
  // Fire-and-forget: a missed trust update is recoverable via the
  // reconciliation watchdog, but a thrown error here would surface as a
  // 500 from the controller, which would be wrong — the dispute itself
  // resolved successfully.
  applyResolutionDelta(dispute._id, dispute.seller, dispute.status).catch((e) =>
    console.warn(chalk.yellow(`[trustScore] refund delta failed: ${e.message}`)));

  // Notify both sides via the outbox. `idempotencyKey` collapses the
  // notification if THIS function runs twice for the same dispute (which
  // shouldn't happen — applyResolutionDelta's CAS lock prevents it — but
  // belt + braces costs us nothing).
  notify({
    user: dispute.buyer,
    type: "dispute_resolved_refund",
    title: "Буцаалт хийгдэв ✓",
    body: `#${shortId(order._id)} — ₮${amount.toLocaleString()} таны дансаар буцаагдана.`,
    link: "/orders",
    data: { disputeId: String(dispute._id) },
    email: true,
    idempotencyKey: `dispute:${dispute._id}:refund:buyer`,
  });
  notify({
    user: dispute.seller,
    type: "dispute_resolved_refund",
    title: fullyRefunded ? "Маргаан — Бүрэн буцаалт" : "Маргаан — Хэсэгчилсэн буцаалт",
    body: `#${shortId(order._id)} — ₮${amount.toLocaleString()}${penalty > 0 ? ` + ₮${penalty.toLocaleString()} буцаалтын зардал` : ""}${resolvedBy ? ` (${resolvedBy})` : ""}`,
    link: "/seller/disputes",
    data: { disputeId: String(dispute._id) },
    email: true,
    idempotencyKey: `dispute:${dispute._id}:refund:seller`,
  });

  // If we only partially refunded AND the order has been delivered, the
  // remaining escrow should still release on schedule. Re-fetch the order
  // so we evaluate the schedule guard against POST-refund state (the
  // in-memory `order` snapshot was loaded before applyRefund and would
  // report stale paymentStatus/hasOpenDispute values).
  if (!fullyRefunded) {
    const refreshed = await Order.findById(order._id);
    if (refreshed && refreshed.status === "delivered" && !refreshed.hasOpenDispute) {
      const { scheduleRelease } = await import("../Queue/escrowRelease.queue.js");
      await scheduleRelease(refreshed);
    }
  }

  return dispute.status;
};

/**
 * Move a dispute to resolved_release — buyer loses the claim, escrow goes
 * to seller. Refund-related fields stay zero; an optional return-shipping
 * penalty can still be applied (e.g. admin found the dispute frivolous
 * but still wants to charge the buyer's return shipping back to them —
 * this is rare but the schema accepts it).
 */
const resolveWithRelease = async (dispute, resolvedBy, extra = {}) => {
  const penalty = Math.max(0, Math.round(extra.returnShippingPenalty || 0));
  if (penalty > 0) {
    await Order.updateOne(
      { _id: dispute.order },
      { $inc: { returnShippingPenalty: penalty } },
    );
  }

  dispute.status = "resolved_release";
  dispute.resolution = {
    action: extra.rejected ? "reject_claim" : "release_seller",
    amount: 0,
    returnShippingPenalty: penalty,
    notes: extra.notes || "",
    resolvedBy,
    resolvedAt: new Date(),
    // Synthetic ID for audit log — this path issues no QPay refund.
    refundTxId: `release-${dispute._id}`,
  };
  dispute.responseDeadline = null;
  dispute.deadlineJobId = null;
  await dispute.save();
  // recompute will flip paymentStatus DISPUTED → PAID/PARTIAL_REFUND and
  // clear hasOpenDispute in a single atomic update. After this returns,
  // the order is in the correct post-dispute state.
  await recomputeOpenDisputeFlag(dispute.order);

  // Reputation reward — releases lift the seller's trust score so future
  // payouts come faster. reject_claim (admin actively ruled buyer wrong)
  // is a STRONGER positive signal than buyer-withdrew or release; we map
  // through dispute.resolution.action so trust deltas reflect the real
  // adjudication outcome rather than the dispute's terminal status alone.
  // Idempotency: dispute._id is the CAS key — retries are no-ops.
  applyResolutionDelta(dispute._id, dispute.seller, dispute.resolution.action).catch((e) =>
    console.warn(chalk.yellow(`[trustScore] release delta failed: ${e.message}`)));

  notify({
    user: dispute.buyer,
    type: "dispute_resolved_release",
    title: "Маргаан хаагдсан",
    body: "Шийдэвчилгээгээр буцаалт хийгдэхгүй.",
    link: "/orders",
    data: { disputeId: String(dispute._id) },
    email: true,
  });
  notify({
    user: dispute.seller,
    type: "dispute_resolved_release",
    title: "Маргаан — Худалдагчийн талд",
    body: penalty > 0
      ? `Escrow удахгүй суллагдана. Буцаалтын зардал ₮${penalty.toLocaleString()} хасагдаж тооцоно.`
      : "Escrow таны төлөвлөгөөт хугацаандаа суллагдана.",
    link: "/seller/disputes",
    data: { disputeId: String(dispute._id) },
  });

  // Re-arm the escrow-release worker. recomputeOpenDisputeFlag may have
  // moved the order from DISPUTED back to PAID (or PARTIAL_REFUND if there
  // was a prior partial refund) — both are eligible to release.
  const fresh = await Order.findById(dispute.order);
  if (fresh
      && ["PAID", "PARTIAL_REFUND"].includes(fresh.paymentStatus)
      && !fresh.hasOpenDispute
      && fresh.status === "delivered") {
    const { scheduleRelease } = await import("../Queue/escrowRelease.queue.js");
    await scheduleRelease(fresh);
  }
  return dispute.status;
};
