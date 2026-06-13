import mongoose from "mongoose";

/**
 * RFQ — Request For Quotation (B2B roadmap #4).
 *
 * A buyer asks a seller for a custom price on a specific product +
 * quantity; the seller answers with a unit price valid until a date;
 * the buyer accepts and orders at that price. The negotiated unit is
 * applied SERVER-SIDE at order create (order.controller.js reads this
 * document — the client never supplies the price).
 *
 * Lifecycle:
 *   pending   → buyer sent, seller hasn't answered
 *   quoted    → seller answered (quote.* filled)
 *   accepted  → buyer locked the quote in; `order` is set once used
 *   declined  → seller refused
 *   cancelled → buyer withdrew
 * Expiry is checked against quote.validUntil at accept/order time
 * rather than via a cron — no background job to operate.
 */
const rfqSchema = new mongoose.Schema(
  {
    buyer:   { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    seller:  { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true, index: true },

    /** Snapshot so the thread stays readable if the product changes. */
    productSnapshot: {
      name:      { type: String, default: "" },
      oem:       { type: String, default: "" },
      sku:       { type: String, default: "" },
      image:     { type: String, default: "" },
      basePrice: { type: Number, default: 0 },
    },

    qty:     { type: Number, required: true, min: 1 },
    message: { type: String, default: "", trim: true, maxlength: 1000 },

    status: {
      type: String,
      enum: ["pending", "quoted", "accepted", "declined", "cancelled"],
      default: "pending",
      index: true,
    },

    quote: {
      /** Integer MNT — the negotiated UNIT price. */
      unitPrice:  { type: Number, min: 1 },
      note:       { type: String, default: "", trim: true, maxlength: 500 },
      validUntil: { type: Date },
      quotedAt:   { type: Date },
    },

    /** Set once the quote has been consumed by an order — single use. */
    order: { type: mongoose.Schema.Types.ObjectId, ref: "Order", default: null },

    respondedAt: { type: Date },
    acceptedAt:  { type: Date },
  },
  { timestamps: true },
);

rfqSchema.index({ seller: 1, status: 1, createdAt: -1 });
rfqSchema.index({ buyer: 1, createdAt: -1 });

export default mongoose.model("Rfq", rfqSchema);
