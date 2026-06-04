/**
 * corrections — every human fix is a training signal.
 *
 * When an admin/seller corrects an interpretation, we record it here. If the
 * correction carries the `rawToken` (the surface form that was misread, e.g.
 * "gerel"), that token is upserted into part_aliases so the NEXT occurrence
 * resolves deterministically — the core of the self-improving loop.
 */

import { Schema, model, Types, type HydratedDocument } from "mongoose";

export type CorrectableField =
  | "canonicalBrand"
  | "canonicalModel"
  | "generation"
  | "partType"
  | "oem";

export interface Correction {
  normalizedProductId: Types.ObjectId;
  rawProductId: Types.ObjectId;
  field: CorrectableField;
  oldValue: string | null;
  newValue: string;
  rawToken?: string; // surface form to learn → part_aliases
  correctedBy: Types.ObjectId;
  role: "admin" | "seller";
  appliedToDictionary: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type CorrectionDoc = HydratedDocument<Correction>;

const correctionSchema = new Schema<Correction>(
  {
    normalizedProductId: { type: Schema.Types.ObjectId, ref: "NormalizedProduct", required: true, index: true },
    rawProductId: { type: Schema.Types.ObjectId, ref: "RawProduct", required: true, index: true },
    field: {
      type: String,
      enum: ["canonicalBrand", "canonicalModel", "generation", "partType", "oem"],
      required: true,
    },
    oldValue: { type: String, default: null },
    newValue: { type: String, required: true },
    rawToken: { type: String },
    correctedBy: { type: Schema.Types.ObjectId, required: true },
    role: { type: String, enum: ["admin", "seller"], required: true },
    appliedToDictionary: { type: Boolean, default: false },
  },
  { timestamps: true, collection: "corrections" },
);

correctionSchema.index({ createdAt: -1 });

export const CorrectionModel = model<Correction>("Correction", correctionSchema);
