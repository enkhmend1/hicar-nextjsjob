import mongoose from "mongoose";

/**
 * Product model — multi-vendor catalogue item.
 *
 * Design notes:
 *  • `oem` is OPTIONAL. Many aftermarket / universal / accessory parts have
 *    no OEM number. When present we still keep a text index for OEM lookup.
 *  • `category`, `brand`, `source` are free-form strings (no enum lock-in)
 *    so sellers can introduce new ones. Canonical values are surfaced via
 *    the `/products/facets` autocomplete endpoint.
 *  • `tags` is a free-form keyword bag — used by AI search & filters.
 *  • `lowStockThreshold` overrides the seller's default; falls back to the
 *    seller profile or platform default (5) inside the inventory service.
 */

const productSchema = new mongoose.Schema(
  {
    // null seller = admin-listed (house brand)
    seller: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    status: { type: String, enum: ["pending", "approved", "rejected"], default: "approved", index: true },
    rejectedReason: { type: String, default: "" },

    name: { type: String, required: true, trim: true, maxlength: 200 },

    // OEM is OPTIONAL. Validated only when non-empty.
    oem: {
      type: String,
      trim: true,
      default: "",
      index: true,
      validate: {
        validator: (v) => !v || /^[A-Za-z0-9._\-/ ]{2,40}$/.test(v),
        message: "OEM код буруу форматтай байна",
      },
    },

    price: { type: Number, required: true, min: 0 },
    originalPrice: { type: Number, min: 0 },

    // Free-form, normalised to trimmed lowercase. Use facets endpoint to enumerate.
    category: { type: String, required: true, trim: true, lowercase: true, maxlength: 60, index: true },
    brand:    { type: String, required: true, trim: true,                    maxlength: 60, index: true },
    source:   { type: String, default: "local", trim: true, maxlength: 60, index: true },
    tags:     { type: [String], default: [], index: true },

    inStock: { type: Boolean, default: true },
    stockQty: { type: Number, default: 100, min: 0 },
    /** Per-product low-stock threshold override. -1 means "use seller default". */
    lowStockThreshold: { type: Number, default: -1, min: -1 },

    badge: { type: String, default: "" },
    description: { type: String, default: "", maxlength: 4000 },
    compatible: { type: [String], default: [] },
    deliveryDays: {
      fast:   { type: Number, default: 7,  min: 0 },
      normal: { type: Number, default: 14, min: 0 },
      cheap:  { type: Number, default: 21, min: 0 },
    },
    iconPath: { type: String, default: "" },
    images: { type: [String], default: [] },

    // Aggregated from Review docs by review.controller
    rating: { type: Number, default: 0, min: 0, max: 5 },
    ratingCount: { type: Number, default: 0, min: 0 },

    /**
     * Structured vehicle compatibility (used by the compatibility engine).
     *
     * Any of the lists matching a target vehicle yields a hit; engineCodes
     * & engines provide the strongest signal, model second, manufacturer
     * weakest. The free-text `compatible[]` above is kept for backwards
     * compatibility but new ingestion paths should populate this block.
     */
    compatibility: {
      manufacturers: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Manufacturer" }], default: [] },
      models:        { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "VehicleModel"  }], default: [] },
      engines:       { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Engine"        }], default: [] },
      /** Free-text engine codes for products imported without normalised engine refs. */
      engineCodes:   { type: [String], default: [], index: true },
      /** Pre-computed denormalised OEM bag for fast `$in` matching across cross-refs. */
      oemBag:        { type: [String], default: [], index: true },
    },
  },
  { timestamps: true },
);

// Searchable text index — name + oem + brand + tags
productSchema.index({ name: "text", oem: "text", brand: "text", tags: "text" });

// Common compound indexes for catalogue listing
productSchema.index({ status: 1, category: 1, createdAt: -1 });
productSchema.index({ status: 1, seller: 1, createdAt: -1 });

// Normalise tag input
productSchema.pre("save", function () {
  if (Array.isArray(this.tags)) {
    this.tags = [...new Set(this.tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean))].slice(0, 20);
  }
});

export default mongoose.model("Product", productSchema);
