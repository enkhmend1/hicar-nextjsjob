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
