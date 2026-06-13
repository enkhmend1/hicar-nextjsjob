import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    type: {
      type: String,
      enum: [
        "order_placed", "order_status_changed", "payment_received",
        "seller_application", "seller_approved", "seller_rejected",
        "product_pending", "product_approved", "product_rejected",
        "low_stock", "review_received", "system",
        // B2B roadmap #4 — RFQ (request-for-quote) lifecycle pings.
        "rfq_received", "rfq_quoted", "rfq_accepted", "rfq_declined",
        // Support helpdesk — ticket opened + threaded replies (both sides).
        "support_opened", "support_reply",
        // Phase L — proactive background-agent insights. The `data`
        // field carries a `kind` discriminator
        // (deadstock_alert / market_gap_digest / financial_summary)
        // so we don't bloat the enum with one entry per agent check.
        "ai_insight",
      ],
      required: true,
    },
    title: { type: String, required: true },
    body: { type: String, default: "" },
    link: { type: String, default: "" },
    read: { type: Boolean, default: false, index: true },
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

notificationSchema.index({ user: 1, read: 1, createdAt: -1 });

export default mongoose.model("Notification", notificationSchema);
