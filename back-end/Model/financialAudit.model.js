/**
 * Financial audit log — immutable, hash-chained ledger of every event that
 * moves money or affects payout math.
 *
 * Why a separate model rather than relying on `createdAt`/`updatedAt` on
 * the Order + Dispute tables?
 *
 *   ① Tamper detection. Each entry carries `currHash =
 *      sha256(prevHash || payload)`. Modifying any historical row breaks
 *      the chain — the next entry's hash no longer matches a verifier's
 *      recomputed value. A simple `verifyChain()` admin endpoint replays
 *      the full chain to detect inserts/edits/deletes.
 *
 *   ② Append-only enforcement. Schema-level guards reject `findOneAndUpdate`
 *      / `updateOne` / `deleteOne` on this collection. The only way to add
 *      data is via `appendAudit()`. No application code, including admin
 *      controllers, can amend the ledger after the fact.
 *
 *   ③ Regulatory / forensic value. Mongolian payment regulation may require
 *      a 5-year audit trail. This is the lowest-overhead way to provide it
 *      without entangling business logic.
 *
 * Event types currently emitted:
 *   payment_settled          — escrow.settleOrderPaid succeeded
 *   refund_issued            — applyRefund completed (QPay + local state)
 *   escrow_released          — releaseEscrow succeeded
 *   trust_score_changed      — applyResolutionDelta committed
 *   dispute_resolved         — dispute reached terminal state
 *   return_penalty_applied   — admin set a returnShippingPenalty
 *
 * Each row's `payload` shape is event-specific but always includes amounts
 * in MNT and the relevant order/dispute/seller IDs.
 */

import crypto from "crypto";
import mongoose from "mongoose";

const EVENT_TYPES = [
  "payment_settled",
  "refund_issued",
  "escrow_released",
  "trust_score_changed",
  "dispute_resolved",
  "return_penalty_applied",
];

const sha256Hex = (s) => crypto.createHash("sha256").update(s).digest("hex");

const financialAuditSchema = new mongoose.Schema(
  {
    type: { type: String, enum: EVENT_TYPES, required: true, index: true },

    // Cross-reference IDs. All optional — different event types touch
    // different combinations. Indexed for forensic queries
    // ("show me every event for order X").
    orderId:   { type: mongoose.Schema.Types.ObjectId, ref: "Order",   index: true },
    disputeId: { type: mongoose.Schema.Types.ObjectId, ref: "Dispute", index: true },
    sellerId:  { type: mongoose.Schema.Types.ObjectId, ref: "User",    index: true },
    buyerId:   { type: mongoose.Schema.Types.ObjectId, ref: "User",    index: true },

    /** Who initiated this — admin user id, or a synthetic ("system", "ai_auto"). */
    actor: { type: String, required: true },

    /** The ₮ amount this event moved (or 0 for non-money events like trust). */
    amount: { type: Number, default: 0, min: 0 },

    /**
     * Before/after snapshot of the relevant value (e.g.
     * { previous: 50, next: 47 } for trust score). Free-form per event.
     */
    before:  { type: mongoose.Schema.Types.Mixed },
    after:   { type: mongoose.Schema.Types.Mixed },

    /** Anything else useful for forensics — kept small. */
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },

    // ── Hash chain ───────────────────────────────────────────────────
    /** Hash of the IMMEDIATELY PREVIOUS row's `currHash`. Genesis row uses "". */
    prevHash: { type: String, required: true, default: "" },
    /**
     * Hash of this row's canonical payload (type, ids, amount, before,
     * after, metadata, prevHash). Used by both verification and by the
     * NEXT row's prevHash. Computed at insert time and never updated.
     */
    currHash: { type: String, required: true },
  },
  {
    timestamps: true,
    // Strict: reject any field we didn't declare. Audit data should be
    // tightly schema-bound, not free-form mongo soup.
    strict: "throw",
  },
);

// Compound index for tailing the chain quickly.
financialAuditSchema.index({ createdAt: 1, _id: 1 });

// ── Append-only enforcement ────────────────────────────────────────────
// We can't truly prevent privileged mongo shell access, but we CAN ensure
// no application code path mutates an audit row. Every update / delete
// middleware throws.
function refuse() {
  throw new Error(
    "FinancialAudit is append-only. Use appendAudit() — never updateOne, " +
    "findOneAndUpdate, deleteOne, or .save() on an existing audit doc.",
  );
}
financialAuditSchema.pre("updateOne",        refuse);
financialAuditSchema.pre("updateMany",       refuse);
financialAuditSchema.pre("findOneAndUpdate", refuse);
financialAuditSchema.pre("deleteOne",        refuse);
financialAuditSchema.pre("deleteMany",       refuse);
financialAuditSchema.pre("findOneAndDelete", refuse);
financialAuditSchema.pre("save", function (next) {
  // Reject re-saves of an existing doc.
  if (!this.isNew) return next(new Error("FinancialAudit rows are immutable"));
  next();
});

// Static helpers
financialAuditSchema.statics.EVENT_TYPES = EVENT_TYPES;

/**
 * Compute the canonical hash input for a row. Order matters — any change
 * here invalidates every existing chain. If we ever need to evolve the
 * format, do it via a new event type, not by mutating this function.
 */
financialAuditSchema.statics.canonicalString = function (entry) {
  return JSON.stringify({
    type:      entry.type,
    orderId:   entry.orderId   ? String(entry.orderId)   : null,
    disputeId: entry.disputeId ? String(entry.disputeId) : null,
    sellerId:  entry.sellerId  ? String(entry.sellerId)  : null,
    buyerId:   entry.buyerId   ? String(entry.buyerId)   : null,
    actor:     entry.actor,
    amount:    Math.round(entry.amount || 0),
    before:    entry.before ?? null,
    after:     entry.after  ?? null,
    metadata:  entry.metadata ?? {},
    prevHash:  entry.prevHash || "",
  });
};

financialAuditSchema.statics.computeHash = function (entry) {
  return sha256Hex(this.canonicalString(entry));
};

export default mongoose.model("FinancialAudit", financialAuditSchema);
