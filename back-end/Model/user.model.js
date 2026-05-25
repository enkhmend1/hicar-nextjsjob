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
      logo: { type: String, default: "" },        // Cloudinary URL (1:1 avatar)
      // Phase Q.1: optional cover banner shown at the top of the
      // public /store/[id] storefront. Recommended 16:5 aspect ratio
      // (e.g. 1600×500). Falls back to a generated gradient when empty.
      coverImage: { type: String, default: "" },

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

/**
 * Trust-score range guard — DEFENCE IN DEPTH.
 *
 * The trustScore.service uses an aggregation-pipeline update with
 * server-side `$max` / `$min` clamping, so writes from THAT path are
 * already bounded. These middleware hooks catch every OTHER possible
 * write path (admin manual override via the user controller, future
 * scripts that set the field directly, .save() on a hydrated User
 * document) and clamp them to [0, 100].
 *
 * Note: aggregation-pipeline updates BYPASS Mongoose query middleware —
 * that's not a regression here, it's the whole point. The pipeline
 * already clamps server-side; these hooks cover the non-pipeline paths.
 */
const TRUST_MIN = 0;
const TRUST_MAX = 100;
const clampTrust = (n) => {
  if (typeof n !== "number" || !Number.isFinite(n)) return n;
  return Math.max(TRUST_MIN, Math.min(TRUST_MAX, n));
};

// Modern Mongoose hook signature: async function with NO `next` arg.
// (Mongoose 9 removed support for the legacy `function(next)` callback
// style — calling next() raises `TypeError: next is not a function` and
// User.create() returns a 500 to the auth controller. Bug found by the
// /api/auth/register smoke test.)
userSchema.pre("save", function () {
  if (this.sellerProfile && typeof this.sellerProfile.trustScore === "number") {
    this.sellerProfile.trustScore = clampTrust(this.sellerProfile.trustScore);
  }
});

// Query-level middleware fires for *.findOneAndUpdate / *.updateOne /
// *.updateMany. `this` is the Query object → use getUpdate() / setUpdate().
function clampTrustInQueryUpdate() {
  const update = this.getUpdate();
  if (!update) return;
  // Aggregation pipeline updates are arrays → skip; the pipeline does its
  // own clamping. Treat anything else as a classic update object.
  if (Array.isArray(update)) return;

  // Paths can be written as flat dotted ("sellerProfile.trustScore") or
  // nested object form ({ sellerProfile: { trustScore: 50 } }). Patch both.
  const ops = ["$set", "$setOnInsert"];
  for (const op of ops) {
    const block = update[op];
    if (!block) continue;
    if (typeof block["sellerProfile.trustScore"] === "number") {
      block["sellerProfile.trustScore"] = clampTrust(block["sellerProfile.trustScore"]);
    }
    if (block.sellerProfile && typeof block.sellerProfile.trustScore === "number") {
      block.sellerProfile.trustScore = clampTrust(block.sellerProfile.trustScore);
    }
  }
  // Top-level (no $set) — Mongoose treats this as implicit $set.
  if (typeof update["sellerProfile.trustScore"] === "number") {
    update["sellerProfile.trustScore"] = clampTrust(update["sellerProfile.trustScore"]);
  }
  if (update.sellerProfile && typeof update.sellerProfile.trustScore === "number") {
    update.sellerProfile.trustScore = clampTrust(update.sellerProfile.trustScore);
  }

  // `$inc` on a clamped field is dangerous (can push past the bound). We
  // do NOT use $inc on trustScore from the service — but if some future
  // code does, leave a loud warning rather than silently corrupting.
  if (update.$inc && (
    typeof update.$inc["sellerProfile.trustScore"] === "number" ||
    typeof update.$inc.sellerProfile?.trustScore === "number"
  )) {
    console.warn(
      "[user.model] WARNING: $inc on sellerProfile.trustScore bypasses range " +
      "clamp. Use the aggregation pipeline in trustScore.service instead.",
    );
  }
}

userSchema.pre("findOneAndUpdate", clampTrustInQueryUpdate);
userSchema.pre("updateOne",        clampTrustInQueryUpdate);
userSchema.pre("updateMany",       clampTrustInQueryUpdate);

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
