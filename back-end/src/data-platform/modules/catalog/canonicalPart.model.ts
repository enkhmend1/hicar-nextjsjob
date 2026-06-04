/**
 * LAYER 3 — canonical_parts (governed reference data).
 *
 * The curated, human-governed truth about part TYPES (TecDoc-style taxonomy
 * node). Slow-changing. Normalized products LINK to these; they never write
 * them. M2 seeds a starter set; M3 adds admin governance + change_log.
 */

import { Schema, model, type HydratedDocument } from "mongoose";

export interface CanonicalPart {
  canonicalPartName: string; // "Headlight"
  category: string; // taxonomy node, e.g. "lighting"
  partNumberFormats: string[]; // optional OEM regex hints
  createdBy: "system" | "admin";
  createdAt: Date;
  updatedAt: Date;
}

export type CanonicalPartDoc = HydratedDocument<CanonicalPart>;

const canonicalPartSchema = new Schema<CanonicalPart>(
  {
    canonicalPartName: { type: String, required: true, unique: true, trim: true },
    category: { type: String, required: true, index: true },
    partNumberFormats: { type: [String], default: [] },
    createdBy: { type: String, enum: ["system", "admin"], default: "system" },
  },
  { timestamps: true, collection: "canonical_parts" },
);

export const CanonicalPartModel = model<CanonicalPart>("CanonicalPart", canonicalPartSchema);
