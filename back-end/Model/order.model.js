import mongoose from "mongoose";

const orderItemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    name: { type: String, required: true },
    oem: { type: String, required: true },
    price: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1 },
    deliveryType: { type: String, enum: ["fast", "normal", "cheap"], default: "normal" },
  },
  { _id: false },
);

const orderSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    items: { type: [orderItemSchema], required: true, validate: v => v.length > 0 },
    total: { type: Number, required: true, min: 0 },
    deliveryFee: { type: Number, default: 0 },
    address: { type: String, required: true },
    phone: { type: String, required: true },
    paymentMethod: { type: String, enum: ["qpay", "wallet", "card"], required: true },
    qpayInvoice: {
      invoice_id: String,
      qr_text: String,
      qr_image: String,
      urls: { type: mongoose.Schema.Types.Mixed },
      qPay_shortUrl: String,
      created_at: Date,
      paid_at: Date,
    },
    status: {
      type: String,
      enum: ["pending", "paid", "processing", "shipped", "delivered", "cancelled"],
      default: "pending",
    },
  },
  { timestamps: true },
);

export default mongoose.model("Order", orderSchema);
