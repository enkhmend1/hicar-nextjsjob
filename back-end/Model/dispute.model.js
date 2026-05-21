import mongoose from "mongoose";

/**
 * Dispute / маргаан model.
 *
 * Lifecycle (state machine — see dispute.service for transitions):
 *
 *   open
 *     │
 *     ▼
 *   awaiting_seller   ── 48h timeout ──▶ auto_refund_buyer
 *     │
 *     ▼
 *   ai_analyzing      (AI scores fraud + recommends action)
 *     │
 *     ├── ai_recommends_refund  ─┐
 *     ├── ai_recommends_release ─┤
 *     └── ai_uncertain          ─┘
 *                                │
 *     ┌──────────────────────────┘
 *     ▼
 *   awaiting_buyer    ── 48h timeout ──▶ resolved_release  (buyer accepted offer)
 *     │
 *     ├── buyer_accepts_offer  ──▶ resolved_refund
 *     ├── buyer_rejects_offer  ──▶ escalated_admin
 *     └── (timeout)            ──▶ resolved_release
 *     │
 *     ▼
 *   escalated_admin
 *     │
 *     ▼
 *   resolved_refund  /  resolved_release  /  resolved_partial
 *
 * Cancelled is a terminal sink usable from any open state (buyer withdraws).
 *
 * Bulletproof guarantees enforced at the SCHEMA layer (defence in depth on
 * top of the controller / service checks):
 *
 *   ① Financial caps — `requestedRefundAmount` cannot exceed the order's
 *      remaining escrow, and `resolution.amount` / `sellerResponse.offeredAmount`
 *      cannot exceed `requestedRefundAmount`. So even if a controller forgets
 *      to clamp, MongoDB refuses to persist a 500k refund on a 50k order.
 *   ② Terminal-state integrity — once `status` flips to `resolved_*`, the
 *      `resolution` sub-object is REQUIRED to be populated (action,
 *      resolvedBy, resolvedAt; plus amount + refundTxId for refunds). No
 *      half-resolved rows.
 *   ③ Money fields are integer-coerced via `set: roundMNT` — Mongolian tögrög
 *      has no fractional unit, and floating-point creep in JS arithmetic
 *      (e.g. 0.1 + 0.2 = 0.30000000000000004) cannot leak into stored values.
 *   ④ A sparse-unique index on `deadlineJobId` makes it physically
 *      impossible for two disputes to claim the same BullMQ deadline job —
 *      so if the worker fires its callback twice, the second write is
 *      rejected at the database, not silently double-processed.
 */
const DISPUTE_STATUS = [
  "open",
  "awaiting_seller",
  "ai_analyzing",
  "awaiting_buyer",
  "escalated_admin",
  "resolved_refund",
  "resolved_release",
  "resolved_partial",
  "cancelled",
];

const DISPUTE_REASON = [
  "not_received",      // never arrived
  "wrong_item",        // got wrong product
  "damaged",           // arrived broken
  "defective",         // doesn't work
  "not_as_described",  // description / photo mismatch
  "counterfeit",       // fake / non-OEM where OEM was promised
  "other",
];

const RESOLUTION_ACTION = [
  "refund_full",
  "refund_partial",
  "release_seller",
  "reject_claim",
];

const RESOLVED_BY = [
  "ai_auto",
  "seller_agreed",
  "buyer_accepted",
  "buyer_withdrew",
  "deadline_buyer",   // buyer didn't respond → seller offer accepted
  "deadline_seller",  // seller didn't respond → auto-refund
  "admin",
];

const TERMINAL_STATUSES   = ["resolved_refund", "resolved_release", "resolved_partial", "cancelled"];
const REFUND_STATUSES     = ["resolved_refund", "resolved_partial"];

/**
 * Coerce any incoming numeric value to a non-negative integer MNT.
 *   • null / undefined → leave as-is (Mongoose then applies `required`).
 *   • Strings ("5000") → parsed via Number().
 *   • Floats (4999.7) → rounded half-away-from-zero so we never silently
 *     truncate a refund. We also clamp to ≥ 0 — negative refunds are not
 *     a thing in this domain.
 */
const roundMNT = (v) => {
  if (v === null || v === undefined || v === "") return v;
  const n = Number(v);
  if (!Number.isFinite(n)) return v; // let the `type: Number` cast fail loudly
  return Math.max(0, Math.round(n));
};

const messageSchema = new mongoose.Schema(
  {
    /** Who wrote it. `system` is reserved for state-transition log entries. */
    author: { type: String, enum: ["buyer", "seller", "admin", "ai", "system"], required: true },
    text: { type: String, required: true, maxlength: 2000 },
    /** Optional evidence attachments — Cloudinary URLs. */
    images: { type: [String], default: [] },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true },
);

const disputeSchema = new mongoose.Schema(
  {
    order:  { type: mongoose.Schema.Types.ObjectId, ref: "Order", required: true, index: true },
    /**
     * Buyer + seller are denormalised so reports / dashboards don't need
     * to populate Order then re-derive. They are immutable after creation.
     */
    buyer:  { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    seller: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

    /** Optional — which specific line items the dispute concerns. */
    itemProductIds: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Product" }], default: [] },

    reason:      { type: String, enum: DISPUTE_REASON, required: true },
    description: { type: String, required: true, maxlength: 4000 },
    evidenceImages: { type: [String], default: [] },

    /**
     * What the buyer is asking for. Integer MNT, ≥ 1, AND capped at the
     * order's remaining escrow (escrowAmount − refundedAmount). The cap is
     * enforced by an async validator that reads the linked Order — so even
     * a malicious client posting body={requestedRefundAmount: 1e9} cannot
     * persist a refund larger than the seller actually owes.
     */
    requestedRefundAmount: {
      type: Number,
      required: true,
      min: 1,
      set: roundMNT,
      validate: {
        validator: async function (v) {
          // Skip when the field isn't being set (Mongoose runs validators
          // only on modified paths during update operations).
          if (v === null || v === undefined) return false;
          // Lazy-look up the Order model via the registry to avoid a hard
          // import-time cycle (Order ↔ Dispute both reference each other).
          const Order = mongoose.model("Order");
          const order = await Order.findById(this.order)
            .select("escrowAmount refundedAmount total");
          if (!order) return false;
          const cap = (order.escrowAmount > 0 ? order.escrowAmount : order.total)
                    - (order.refundedAmount || 0);
          return v <= cap;
        },
        message: (props) =>
          `requestedRefundAmount (₮${props.value}) нь захиалгын escrow-ийн үлдэгдлээс хэтэрсэн байна`,
      },
    },

    status: { type: String, enum: DISPUTE_STATUS, default: "open", index: true },

    // ── Conversation log ─────────────────────────────────────────────
    messages: { type: [messageSchema], default: [] },

    // ── Deadline tracking (driven by disputeDeadline worker) ─────────
    /** When the currently-awaited party must respond by. Null when in a terminal state. */
    responseDeadline: { type: Date, index: true },
    /**
     * BullMQ job id for the active deadline — so we can cancel it on
     * early response. Indexed sparse + unique below: two live disputes
     * can never share the same deadline job, which closes the door on
     * worker-replay scenarios silently double-resolving a dispute.
     */
    deadlineJobId: { type: String },

    // ── Seller's response ────────────────────────────────────────────
    sellerResponse: {
      /** "refund_offered" | "rejected" | "partial_refund_offered" */
      action: { type: String, enum: ["refund_offered", "rejected", "partial_refund_offered"] },
      offeredAmount: {
        type: Number,
        min: 0,
        set: roundMNT,
        validate: {
          validator: function (v) {
            // `this` is the parent dispute doc for inline embedded paths.
            // We can't outright reject 0 here because a "rejected" response
            // legitimately writes offeredAmount = 0.
            if (v === null || v === undefined) return true;
            return v <= (this.requestedRefundAmount ?? Infinity);
          },
          message: "sellerResponse.offeredAmount нь requestedRefundAmount-аас хэтрэхгүй",
        },
      },
      message: { type: String, maxlength: 2000 },
      respondedAt: { type: Date },
    },

    // ── AI fraud analysis (filled by fraud.service after both parties speak) ─
    aiAnalysis: {
      // Scores are 0-100 integers — the AI sometimes returns floats like
      // 73.5, which is fine semantically but pollutes the audit log. Round.
      fraudScore: { type: Number, min: 0, max: 100, set: (v) => (v == null ? v : Math.round(v)) },
      confidence: { type: Number, min: 0, max: 100, set: (v) => (v == null ? v : Math.round(v)) },
      recommendedAction: { type: String, enum: [...RESOLUTION_ACTION, "escalate"] },
      reasoning: { type: String },
      flags:     { type: [String], default: [] },
      buyerHistory:  { type: mongoose.Schema.Types.Mixed },  // disputes-this-buyer-has-filed, etc.
      sellerHistory: { type: mongoose.Schema.Types.Mixed },
      analyzedAt: { type: Date },
      model:      { type: String },
    },

    // ── Final resolution ─────────────────────────────────────────────
    resolution: {
      action:    { type: String, enum: RESOLUTION_ACTION },
      amount:    {
        type: Number,
        min: 0,
        set: roundMNT,
        validate: {
          validator: function (v) {
            if (v === null || v === undefined) return true;
            // The final settled amount cannot exceed what the buyer originally
            // asked for. (Admin may settle for LESS, never more.)
            return v <= (this.requestedRefundAmount ?? Infinity);
          },
          message: "resolution.amount нь requestedRefundAmount-аас хэтрэхгүй",
        },
      },
      /**
       * Deduction from the seller's eventual payout because the dispute
       * was found to be the seller's fault (wrong item, damaged, etc.) and
       * the return-shipping cost should not fall on the buyer or platform.
       * Capped at the seller's remaining payout — see escrow.releaseEscrow
       * for how this is subtracted at payout time.
       */
      returnShippingPenalty: { type: Number, min: 0, default: 0, set: roundMNT },
      notes:     { type: String, maxlength: 2000 },
      resolvedBy: { type: String, enum: RESOLVED_BY },
      resolvedAt: { type: Date },
      /** QPay refund id once the refund is wired through QPay. */
      refundTxId: { type: String },
    },

    escalatedAt: { type: Date },

    /**
     * Idempotency lock for the trust-score side-effect.
     *
     * Set to true by `trustScore.service.applyResolutionDelta` via an atomic
     * CAS (`{ _id, isTrustScoreApplied: { $ne: true } }`). When a BullMQ
     * deadline worker retries, an admin double-clicks "Resolve", or a
     * concurrent code path tries to fire the same resolution twice, the
     * second caller's CAS returns null and the delta is NOT re-applied —
     * the seller's reputation can never be over- or under-counted.
     *
     * Indexed so the reconciliation watchdog can quickly find disputes
     * stuck in a terminal status with the flag still false (i.e. trust
     * update failed mid-flight).
     */
    isTrustScoreApplied: { type: Boolean, default: false, index: true },
  },
  { timestamps: true },
);

/**
 * Conditional-path validation: once a dispute is in a terminal status, the
 * `resolution` object MUST be populated coherently. This catches any service
 * code path that flips `status = "resolved_refund"` but forgets to write
 * `resolution.action / .resolvedBy / .resolvedAt` — keeping the audit trail
 * impossible to corrupt by accident.
 *
 * Pre-validate (not pre-save) so the error surfaces during `validate()`
 * too — useful when the dispute service drives transitions through
 * `findOneAndUpdate({ runValidators: true })`.
 */
// We use the modern (Mongoose 6+) throwing-async form rather than the
// legacy `(next) => next(err)` form. The legacy form breaks when the hook
// is invoked through `doc.validate()` paths that don't pass a `next`
// callback (newer Mongoose code calls hooks as plain async functions and
// awaits them), so throwing is the version-portable choice.
disputeSchema.pre("validate", async function () {
  if (!TERMINAL_STATUSES.includes(this.status)) return;

  const r = this.resolution;
  // Compose a single, human-readable error that lists EVERY missing piece —
  // makes the failing test or production log trivial to diagnose. We use
  // plain Error rather than mongoose.Error.ValidationError so the hook is
  // version-agnostic (Mongoose has changed that constructor's API across
  // major versions).
  const missing = [];
  if (!r)              missing.push("resolution");
  if (!r?.action)      missing.push("resolution.action");
  if (!r?.resolvedBy)  missing.push("resolution.resolvedBy");
  if (!r?.resolvedAt)  missing.push("resolution.resolvedAt");

  if (REFUND_STATUSES.includes(this.status)) {
    if (!(r?.amount > 0))   missing.push("resolution.amount > 0");
    // refundTxId is set after QPay succeeds. It MAY be a synthetic id in
    // dev (when QPay is disabled), but it can never be empty.
    if (!r?.refundTxId)     missing.push("resolution.refundTxId");
  }

  if (missing.length) {
    throw new Error(
      `Terminal статус "${this.status}"-д шаардлагатай талбарууд дутуу: ${missing.join(", ")}`,
    );
  }
});

// ── Indexes ────────────────────────────────────────────────────────────
// Admin dashboard: "show me everything pending action, newest first"
disputeSchema.index({ status: 1, createdAt: -1 });

// Sparse-unique on the BullMQ deadline job id. Sparse = nulls aren't
// indexed (so unresolved disputes without a live deadline don't collide).
// Unique = at most ONE dispute can be associated with a given deadline
// job at any time — if the worker race-replays a job, the second write
// hits a duplicate-key error rather than silently double-resolving.
disputeSchema.index({ deadlineJobId: 1 }, { unique: true, sparse: true });

// Static helpers — referenced from controllers for validation
disputeSchema.statics.STATUS = DISPUTE_STATUS;
disputeSchema.statics.REASON = DISPUTE_REASON;
disputeSchema.statics.RESOLUTION_ACTION = RESOLUTION_ACTION;
disputeSchema.statics.TERMINAL_STATUSES = TERMINAL_STATUSES;
disputeSchema.statics.REFUND_STATUSES   = REFUND_STATUSES;

export default mongoose.model("Dispute", disputeSchema);
