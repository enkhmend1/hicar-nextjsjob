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

    /**
     * SELLER-PRIVATE inventory fields. Surfaced only to the merchant who
     * owns the SKU (and to admins) — the AI sanitizer strips these from
     * any payload that flows to a public USER scope. Adding fields here
     * requires NO frontend change; the redactor's allowlist
     * (aiRole.service.js → SELLER_EXTRA_FIELDS) already picks them up.
     *
     *   costPrice          — what the merchant paid. Powers
     *                        Trapped Capital = costPrice × stockQty in
     *                        the Deadstock Alert tool.
     *   warehouseLocation  — physical shelf/row coordinate (e.g. "B-3").
     *                        Indexed so the Shelf Locator tool answers
     *                        "where is OEM 04465-02220" in O(log n).
     */
    costPrice:         { type: Number, default: 0, min: 0 },
    warehouseLocation: { type: String, default: "", trim: true, maxlength: 60, index: true },
    /** Cached for deadstock heuristic — updated by order create hook. */
    lastSoldAt:        { type: Date, default: null, index: true },

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

    /**
     * SELLER-FACING fitments — the structured, human-editable list the
     * multi-step product form populates. Each row says "this part fits
     * <make> <model> <generation?> from <yearStart> to <yearEnd>".
     *
     * Coexists with the reference-based `compatibility` block above:
     *   • `compatibility.*` is normalised (ObjectId refs), used by the AI
     *     compatibility engine for cross-reference queries.
     *   • `fitments[]` is denormalised free-text, owned by the seller and
     *     surfaced verbatim on the product page.
     * A future ingestion script can backfill `compatibility.*` from
     * `fitments[]` for legacy products.
     */
    fitments: {
      type: [{
        make:       { type: String, required: true, trim: true, maxlength: 60 },
        model:      { type: String, required: true, trim: true, maxlength: 60 },
        generation: { type: String, default: "", trim: true, maxlength: 40 },
        yearStart:  { type: Number, min: 1950, max: 2100 },
        yearEnd:    { type: Number, min: 1950, max: 2100 },
      }],
      default: [],
      validate: {
        validator: (arr) => Array.isArray(arr) && arr.length <= 50,
        message: "Хамгийн ихдээ 50 fitment row дэмжинэ",
      },
    },

    /**
     * Category-dependent dynamic attributes. The Mongoose layer stores
     * them as Mixed (no schema lock-in) — the application-layer Zod
     * validator (`Service/productSchema.service.js`) enforces the
     * correct shape per category before this ever reaches Mongo:
     *
     *   category="body"   → { side, color, material }
     *   category="oils"   → { viscosity, volume, oilType, api? }
     *   category="brake"  → { padType?, frictionGrade?, ... }
     *   ... (extensible — see productSchema.service.js)
     *
     * Storing as Mixed gives sellers freedom to introduce new attributes
     * without a schema migration, but the Zod validator at the API
     * boundary catches typos and missing requireds at request time.
     */
    attributes: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true },
);

// Searchable text index — name + oem + brand + tags
productSchema.index({ name: "text", oem: "text", brand: "text", tags: "text" });

// Common compound indexes for catalogue listing
productSchema.index({ status: 1, category: 1, createdAt: -1 });
productSchema.index({ status: 1, seller: 1, createdAt: -1 });

// Fitment lookups — the catalogue's most important user query is
// "what fits my Toyota Crown 2012?" → make + model + (yearStart ≤ year ≤ yearEnd).
// Compound index sorts make first (lowest cardinality split) for
// predicate-pushdown efficiency.
productSchema.index({ "fitments.make": 1, "fitments.model": 1 });
productSchema.index({ category: 1, "fitments.make": 1, status: 1 });

// Normalise tag input
productSchema.pre("save", function () {
  if (Array.isArray(this.tags)) {
    this.tags = [...new Set(this.tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean))].slice(0, 20);
  }
});

export default mongoose.model("Product", productSchema);
