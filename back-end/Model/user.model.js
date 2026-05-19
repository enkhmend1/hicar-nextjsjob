import mongoose from "mongoose";
import argon2 from "argon2";

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: {
      type: String, required: true, unique: true, lowercase: true, trim: true,
      match: [/\S+@\S+\.\S+/, "И-мэйл хаяг буруу байна"],
    },
    password: { type: String, required: true, minlength: 6, select: false },
    phone: { type: String, trim: true, default: "" },
    role: { type: String, enum: ["user", "seller", "admin"], default: "user" },
    wishlist: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Product" }], default: [] },
    // Seller-specific
    sellerStatus: { type: String, enum: ["none", "pending", "approved", "rejected"], default: "none" },
    sellerProfile: {
      shopName: { type: String, trim: true, default: "" },
      description: { type: String, default: "" },
      logo: { type: String, default: "" },        // Cloudinary URL

      // ── Platform economics (per-seller commission split) ──────────
      /** Percentage the platform keeps from every paid order (0–50). */
      platformFeePercent: { type: Number, default: 5, min: 0, max: 50 },

      // ── Seller's real bank account (escrow payout destination) ────
      bankName:        { type: String, default: "" },   // "Хаан банк", "ТDB", …
      bankAccount:     { type: String, default: "" },   // 5001 1234 5678
      bankHolderName:  { type: String, default: "" },   // акаунт эзэмшигчийн нэр

      // ── Trust + reputation ────────────────────────────────────────
      /** Affects escrow release window: high trust = fast payout. 0–100. */
      trustScore: { type: Number, default: 50, min: 0, max: 100 },
      rating: { type: Number, default: 0, min: 0, max: 5 },
      ratingCount: { type: Number, default: 0 },
      totalSales: { type: Number, default: 0 },

      appliedAt:      { type: Date },
      approvedAt:     { type: Date },
      rejectedReason: { type: String, default: "" },

      // Inventory alert preferences
      defaultLowStockThreshold: { type: Number, default: 5, min: 0, max: 1000 },
      emailAlertsEnabled: { type: Boolean, default: true },

      // Free-text history (autocomplete from seller's own past inputs)
      customSources:    { type: [String], default: [] },
      customCategories: { type: [String], default: [] },
      customBrands:     { type: [String], default: [] },
      customTags:       { type: [String], default: [] },
    },
  },
  { timestamps: true },
);

userSchema.pre("save", async function () {
  if (!this.isModified("password")) return;
  this.password = await argon2.hash(this.password);
});

userSchema.methods.verifyPassword = async function (plain) {
  return argon2.verify(this.password, plain);
};

userSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  delete obj.__v;
  return obj;
};

export default mongoose.model("User", userSchema);
