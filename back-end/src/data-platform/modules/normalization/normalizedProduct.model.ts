/**
 * LAYER 2 — normalized_products (derived, scored, versioned).
 *
 * The system's best interpretation of a raw_product. Every derived field
 * carries a value + confidence + provenance (which rule/model decided it).
 * Fully regenerable from raw_products — re-running a better pipeline bumps
 * `version` and supersedes the previous interpretation; raw is never touched.
 *
 * NOTE (M1): the schema is defined now so the spine is complete, but the
 * normalization pipeline that POPULATES it ships in M2. The M1 stub worker
 * only flips raw_products.status — it does not fabricate normalized docs.
 */

import { Schema, model, Types, type HydratedDocument } from "mongoose";

export type ResolutionSource =
  | "alias"
  | "regex"
  | "oem"
  | "vehicleParser"
  | "ai"
  | "human";

export interface FieldResolution<T> {
  value: T | null;
  confidence: number; // 0..1
  source: ResolutionSource;
  evidence?: string;
}

export type NormalizedStatus =
  | "auto_approved"
  | "needs_review"
  | "rejected"
  | "superseded";

export interface NormalizedProduct {
  rawProductId: Types.ObjectId;
  sellerId: Types.ObjectId;
  version: number;
  pipelineVersion: string;

  canonicalPartId?: Types.ObjectId | null;
  canonicalBrand: FieldResolution<string>;
  canonicalModel: FieldResolution<string>;
  generation: FieldResolution<string>;
  partType: FieldResolution<string>;
  oem: FieldResolution<string>;
  attributes: Map<string, FieldResolution<string>>;

  /** Cloudinary public IDs for images mirrored at normalization time. */
  imagePublicIds: string[];

  overallConfidence: number;
  status: NormalizedStatus;
  duplicateOf?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

export type NormalizedProductDoc = HydratedDocument<NormalizedProduct>;

// Reusable sub-schema for a single resolved field. `_id: false` keeps it inline.
const fieldResolutionSchema = new Schema(
  {
    value: { type: Schema.Types.Mixed, default: null },
    confidence: { type: Number, min: 0, max: 1, default: 0 },
    source: {
      type: String,
      enum: ["alias", "regex", "oem", "vehicleParser", "ai", "human"],
      required: true,
    },
    evidence: { type: String },
  },
  { _id: false },
);

const normalizedProductSchema = new Schema<NormalizedProduct>(
  {
    rawProductId: { type: Schema.Types.ObjectId, ref: "RawProduct", required: true, index: true },
    sellerId: { type: Schema.Types.ObjectId, required: true, index: true },
    version: { type: Number, default: 1 },
    pipelineVersion: { type: String, required: true },

    canonicalPartId: { type: Schema.Types.ObjectId, ref: "CanonicalPart", default: null, index: true },
    canonicalBrand: { type: fieldResolutionSchema, required: true },
    canonicalModel: { type: fieldResolutionSchema, required: true },
    generation: { type: fieldResolutionSchema, required: true },
    partType: { type: fieldResolutionSchema, required: true },
    oem: { type: fieldResolutionSchema, required: true },
    attributes: { type: Map, of: fieldResolutionSchema, default: {} },

    imagePublicIds: { type: [String], default: [] },

    overallConfidence: { type: Number, min: 0, max: 1, default: 0, index: true },
    status: {
      type: String,
      enum: ["auto_approved", "needs_review", "rejected", "superseded"],
      default: "needs_review",
      index: true,
    },
    duplicateOf: { type: Schema.Types.ObjectId, ref: "NormalizedProduct", default: null },
  },
  { timestamps: true, collection: "normalized_products" },
);

// Unique: prevents concurrent workers from creating duplicate versions for the
// same raw product. The normalization pipeline catches the 11000 duplicate-key
// error and treats it as a benign "other worker got there first" signal.
normalizedProductSchema.index({ rawProductId: 1, version: 1 }, { unique: true });

export const NormalizedProductModel = model<NormalizedProduct>(
  "NormalizedProduct",
  normalizedProductSchema,
);
