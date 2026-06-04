/**
 * LAYER 3 — part_aliases (the self-improving asset).
 *
 * Maps every observed surface form (English, Mongolian Cyrillic/Latin, slang)
 * to a canonical part. This is where human knowledge accumulates: in M3, each
 * admin/seller correction upserts an alias here, so the NEXT time that token
 * appears the deterministic stage-3 lookup resolves it — no AI needed.
 *
 * Not uniquely keyed on `alias` alone: a generic word ("light") may map to
 * several parts; the cache resolves ties by `weight`.
 */

import { Schema, model, Types, type HydratedDocument } from "mongoose";

export type AliasLang = "en" | "mn-cyrl" | "mn-latn" | "slang";

export interface PartAlias {
  alias: string; // normalized (lowercased)
  lang: AliasLang;
  canonicalPartId: Types.ObjectId;
  weight: number; // precision prior: human=1.0, system=0.9, mined=0.7
  addedBy: "system" | "admin" | "seller" | "mined";
  hitCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export type PartAliasDoc = HydratedDocument<PartAlias>;

const partAliasSchema = new Schema<PartAlias>(
  {
    alias: { type: String, required: true, trim: true, lowercase: true, index: true },
    lang: { type: String, enum: ["en", "mn-cyrl", "mn-latn", "slang"], required: true },
    canonicalPartId: { type: Schema.Types.ObjectId, ref: "CanonicalPart", required: true, index: true },
    weight: { type: Number, min: 0, max: 1, default: 0.9 },
    addedBy: { type: String, enum: ["system", "admin", "seller", "mined"], default: "system" },
    hitCount: { type: Number, default: 0 },
  },
  { timestamps: true, collection: "part_aliases" },
);

// One alias↦part pair is unique; the same alias may still map to other parts.
partAliasSchema.index({ alias: 1, canonicalPartId: 1 }, { unique: true });

export const PartAliasModel = model<PartAlias>("PartAlias", partAliasSchema);
