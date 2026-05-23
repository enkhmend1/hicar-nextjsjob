import mongoose from "mongoose";

/**
 * SiteContent — single-document store of admin-editable, public-facing
 * display content. Lives separately from Product/Order data because:
 *
 *   • The homepage's category labels, icons, display order, and the hero
 *     copy are CMS-style content that changes more often than product
 *     data and shouldn't require a code deploy.
 *   • Read traffic is high (every homepage hit) but write traffic is
 *     near-zero (an admin tweaks it occasionally). A singleton doc is
 *     the cheapest possible representation — fetched once, cached for
 *     N seconds, served from memory to subsequent requests.
 *   • Public reads need no auth (it's site chrome); admin writes need
 *     adminOnly + a sensible audit pointer (updatedBy).
 *
 * Convention: there is exactly ONE document with `_id: "main"`. The
 * service layer creates+seeds it on first read so the route never has
 * to handle "doc missing" states.
 */

/**
 * Per-category attribute definition. Drives BOTH the dynamic Zod
 * validator on product create/update AND the seller's product-form
 * Step 2 widget rendering — single source of truth.
 *
 *   key:      stable identifier the value is stored under in
 *             product.attributes (e.g. "wheelSize"). Lowercase
 *             camel/snake, alphanumeric + underscore, max 40 chars.
 *             Uniqueness is enforced PER CATEGORY at write time
 *             (see siteContent.service.updateSiteContent).
 *   label:    Mongolian display label the seller sees.
 *   type:     "text" / "number" / "select". select REQUIRES options[].
 *   options:  Allowed values for select. Each <= 60 chars. Up to 30.
 *   required: If true, missing or empty value rejects the product create.
 */
const attributeDefinitionSchema = new mongoose.Schema(
  {
    key:      { type: String, required: true, trim: true, lowercase: true, maxlength: 40 },
    label:    { type: String, required: true, trim: true, maxlength: 100 },
    type:     { type: String, required: true, enum: ["text", "number", "select"], default: "text" },
    options:  {
      type: [{ type: String, trim: true, maxlength: 60 }],
      default: [],
      validate: {
        validator: (arr) => Array.isArray(arr) && arr.length <= 30,
        message: "Хамгийн ихдээ 30 сонголт зөвшөөрнө",
      },
    },
    required: { type: Boolean, default: false },
  },
  { _id: false },
);

const categorySchema = new mongoose.Schema(
  {
    /** Stable id used in URLs (e.g. /shop?cat=brake). lowercase. */
    id:        { type: String, required: true, trim: true, lowercase: true, maxlength: 40 },
    /** Display name shown to users — locale-free for now (Mongolian only). */
    name:      { type: String, required: true, trim: true, maxlength: 60 },
    /** Raw SVG path-d attribute. Kept inline so the homepage doesn't need separate icon hosting. */
    iconPath:  { type: String, required: true, trim: true, maxlength: 2000 },
    /** Sort key — lower numbers appear first. Ties broken by insert order. */
    order:     { type: Number, default: 0 },
    /** Hide without deleting (preserves counts in case of rollback). */
    visible:   { type: Boolean, default: true },
    /**
     * No-code product-attributes builder. Admin adds rows here; the
     * Zod validator on POST /products is built at request time from
     * this array. When empty, the legacy hardcoded schema in
     * productSchema.service.js's STATIC_CATEGORY_SCHEMAS is used as
     * a fallback (for the original 5 categories the platform shipped
     * with). For genuinely new categories admins create, this array
     * IS the contract.
     */
    attributesSchema: {
      type: [attributeDefinitionSchema],
      default: [],
      validate: {
        validator: (arr) => Array.isArray(arr) && arr.length <= 40,
        message: "Нэг категорид хамгийн ихдээ 40 шинж чанар зөвшөөрнө",
      },
    },
  },
  { _id: false },
);

const heroSchema = new mongoose.Schema(
  {
    badge:    { type: String, default: "", trim: true, maxlength: 80 },
    title1:   { type: String, default: "", trim: true, maxlength: 120 },
    title2:   { type: String, default: "", trim: true, maxlength: 120 },
    titleAi:  { type: String, default: "", trim: true, maxlength: 60 },
    title3:   { type: String, default: "", trim: true, maxlength: 120 },
    title4:   { type: String, default: "", trim: true, maxlength: 120 },
    subtitle: { type: String, default: "", trim: true, maxlength: 400 },
  },
  { _id: false },
);

const siteContentSchema = new mongoose.Schema(
  {
    /** Singleton — always `"main"`. Stored as String (not ObjectId) so reads are direct. */
    _id:        { type: String, default: "main" },
    categories: { type: [categorySchema], default: [] },
    hero:       { type: heroSchema, default: () => ({}) },
    /** Bumped on every save — clients can use this for cache busting. */
    version:    { type: Number, default: 1 },
    updatedBy:  { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

// Bump version on every save so consumers can detect stale caches.
siteContentSchema.pre("save", function () {
  if (!this.isNew) this.version = (this.version || 0) + 1;
});

export default mongoose.model("SiteContent", siteContentSchema);
