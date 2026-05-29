import mongoose from "mongoose";

/**
 * One line in an order.
 *
 * Phase-1 escrow note:
 *   When the order is paid (QPay callback), every line item is "frozen" with
 *   the seller's commission percentage and bank info AT THAT MOMENT. This
 *   way, if an admin later changes the seller's commission rate or bank
 *   account, in-flight orders still pay out exactly what was agreed when the
 *   customer paid. Snapshots are the difference between "promise" accounting
 *   and "live-lookup" accounting — the former is correct.
 */
const orderItemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    /** Denormalised — needed for per-seller payout queries without populate. */
    seller:  { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    name:  { type: String, required: true },
    oem:   { type: String, required: true },
    price: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1 },
    deliveryType: { type: String, enum: ["fast", "normal", "cheap"], default: "normal" },

    // ── Escrow split (frozen at payment time) ───────────────────────────
    /** Gross line revenue = price × quantity. */
    lineRevenue:      { type: Number, default: 0, min: 0 },
    /** Platform fee for this line = lineRevenue × sellerFeePercent / 100. */
    platformFee:      { type: Number, default: 0, min: 0 },
    /** Amount seller is owed for this line = lineRevenue − platformFee. */
    sellerPayout:     { type: Number, default: 0, min: 0 },
    /** Snapshot of the seller's commission % at the moment of payment. */
    sellerFeePercent: { type: Number, default: 0, min: 0, max: 50 },
    /** Snapshot of the seller's payout bank info at the moment of payment. */
    bankSnapshot: {
      bankName:       { type: String, default: "" },
      bankAccount:    { type: String, default: "" },
      bankHolderName: { type: String, default: "" },
    },
  },
  { _id: false },
);

const orderSchema = new mongoose.Schema(
  {
    user:  { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    items: { type: [orderItemSchema], required: true, validate: v => v.length > 0 },

    total:       { type: Number, required: true, min: 0 },
    deliveryFee: { type: Number, default: 0 },
    address: { type: String, required: true },
    phone:   { type: String, required: true },

    /**
     * Phase-1: QPay is the only real payment processor. "card" is kept for
     * future direct-card integration but currently routes through QPay too.
     * `wallet` is intentionally removed — there is no in-app wallet anymore.
     */
    paymentMethod: { type: String, enum: ["qpay", "card"], required: true },

    qpayInvoice: {
      invoice_id: String,
      qr_text: String,
      qr_image: String,
      urls: { type: mongoose.Schema.Types.Mixed },
      qPay_shortUrl: String,
      created_at: Date,
      paid_at: Date,
    },

    /**
     * Lifecycle of the goods themselves.
     *   pending  → buyer hasn't paid yet
     *   paid     → money received, awaiting seller to start preparing
     *   processing → seller is packing
     *   shipped  → handed to courier
     *   delivered → buyer received the goods
     *   cancelled → cancelled at any point before delivery (stock rolled back)
     */
    status: {
      type: String,
      enum: ["pending", "paid", "processing", "shipped", "delivered", "cancelled"],
      default: "pending",
      index: true,
    },

    /**
     * Lifecycle of the MONEY (orthogonal to `status`).
     *   PENDING        → invoice issued, awaiting QPay confirmation
     *   PAID           → money received and held in platform escrow
     *   DISPUTED       → escrow LOCKED — there is at least one open dispute on
     *                    this order and the auto-release worker MUST NOT pay
     *                    out the seller. This is the schema-level twin of the
     *                    `hasOpenDispute` boolean (defence in depth: even if
     *                    the boolean drifts, the release worker rejects on
     *                    paymentStatus too).
     *   REFUNDED       → full refund issued back to buyer
     *   PARTIAL_REFUND → some refunded, rest still in escrow / paid out
     *   PAID_OUT       → escrow released to seller (Phase 2 worker)
     *   FAILED         → payment attempt failed / abandoned
     */
    paymentStatus: {
      type: String,
      enum: ["PENDING", "PAID", "DISPUTED", "REFUNDED", "PARTIAL_REFUND", "PAID_OUT", "FAILED"],
      default: "PENDING",
      index: true,
    },

    // ── Escrow totals (sum of per-item fields, populated by QPay callback)
    /** Amount currently held in platform escrow (≤ total). */
    escrowAmount:      { type: Number, default: 0, min: 0 },
    /** Total platform fee across all items in this order. */
    platformFeeTotal:  { type: Number, default: 0, min: 0 },
    /** Total amount owed to sellers across all items in this order. */
    sellerPayoutTotal: { type: Number, default: 0, min: 0 },
    /**
     * Charged back to the seller's payout if the buyer returns the goods due
     * to genuine seller fault (wrong part, damaged on arrival, etc.) and the
     * shipping cost falls on the seller. Default 0 — set by dispute flow.
     */
    returnShippingPenalty: { type: Number, default: 0, min: 0 },

    paidAt:            { type: Date },
    deliveredAt:       { type: Date },
    /**
     * Phase AQ — courier tracking number set by the seller when they
     * mark the order as `shipped`. Optional (some local hand-deliveries
     * have no tracking). Free-form string so the same field works for
     * GoGo / DHL / TNTL / hand-written notes.
     */
    trackingNumber:    { type: String, default: "" },
    /**
     * Phase AQ — set when the BUYER confirms delivery on /orders.
     * Distinct from `deliveredAt` (which can be admin-set or buyer-set)
     * because the escrow release worker uses this as the ground truth:
     * only release when the buyer themselves acknowledged receipt OR
     * the auto-release deadline elapsed with no complaint.
     */
    buyerConfirmedDeliveryAt: { type: Date },
    /**
     * When the escrow-release worker is scheduled to fire. Set when the
     * order transitions to "delivered". Cleared if a dispute opens — the
     * worker checks for an open dispute before releasing.
     */
    escrowReleaseScheduledAt: { type: Date },
    /** BullMQ job id for the pending release — set by escrowRelease.queue.scheduleRelease. */
    escrowReleaseJobId:       { type: String },
    escrowReleasedAt:  { type: Date },
    /** Cumulative refund (handles partial refunds across multiple disputes). */
    refundedAmount:    { type: Number, default: 0, min: 0 },
    refundedAt:        { type: Date },
    /** Fast lookup flag — kept in sync by dispute.service. */
    hasOpenDispute:    { type: Boolean, default: false, index: true },
  },
  { timestamps: true },
);

// Convenience: quickly find every order touching a given seller.
orderSchema.index({ "items.seller": 1, status: 1 });
orderSchema.index({ paymentStatus: 1, paidAt: 1 });

export default mongoose.model("Order", orderSchema);
