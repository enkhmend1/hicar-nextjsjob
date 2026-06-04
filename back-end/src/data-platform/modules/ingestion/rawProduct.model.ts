/**
 * LAYER 1 — raw_products (immutable).
 *
 * Stores EXACTLY what the seller submitted. Normalization never mutates this
 * collection. The only fields that may change post-insert are operational:
 * `status`, `images`, `updatedAt`. The payload is frozen — this is the source
 * of truth for *seller intent* and is preserved permanently.
 */

import { Schema, model, Types, type HydratedDocument } from "mongoose";

export type RawSource = "manual" | "csv" | "excel" | "api" | "scrape";
export type RawStatus = "received" | "normalizing" | "normalized" | "failed";

export interface RawProduct {
  sellerId: Types.ObjectId;
  source: RawSource;
  importJobId?: Types.ObjectId;

  // EXACTLY as submitted — never normalized, never overwritten.
  rawTitle: string;
  rawDescription?: string;
  rawBrand?: string;
  rawCategory?: string;
  rawPrice?: string; // string: sellers type "120,000₮", "120k"
  rawOem?: string;
  rawAttributes?: Map<string, string>;
  images: string[];

  // Commercial facts the seller is authoritative on (best-effort parse).
  price?: number; // integer MNT
  currency: string;
  stockQty?: number;

  contentHash: string;
  status: RawStatus;
  createdAt: Date;
  updatedAt: Date;
}

export type RawProductDoc = HydratedDocument<RawProduct>;

const rawProductSchema = new Schema<RawProduct>(
  {
    sellerId: { type: Schema.Types.ObjectId, required: true, index: true },
    source: {
      type: String,
      enum: ["manual", "csv", "excel", "api", "scrape"],
      required: true,
    },
    importJobId: { type: Schema.Types.ObjectId, index: true },

    rawTitle: { type: String, required: true, trim: true, maxlength: 2000 },
    rawDescription: { type: String, maxlength: 20000 },
    rawBrand: { type: String, maxlength: 500 },
    rawCategory: { type: String, maxlength: 500 },
    rawPrice: { type: String, maxlength: 100 },
    rawOem: { type: String, maxlength: 200 },
    rawAttributes: { type: Map, of: String },
    images: { type: [String], default: [] },

    price: { type: Number, min: 0 },
    currency: { type: String, default: "MNT" },
    stockQty: { type: Number, min: 0 },

    contentHash: { type: String, required: true },
    status: {
      type: String,
      enum: ["received", "normalizing", "normalized", "failed"],
      default: "received",
      index: true,
    },
  },
  { timestamps: true, collection: "raw_products" },
);

// Idempotent re-imports: the same seller submitting identical content is a
// no-op rather than a duplicate row.
rawProductSchema.index({ sellerId: 1, contentHash: 1 }, { unique: true });
rawProductSchema.index({ createdAt: -1 });

export const RawProductModel = model<RawProduct>("RawProduct", rawProductSchema);
