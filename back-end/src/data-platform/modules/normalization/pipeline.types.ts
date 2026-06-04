/**
 * Shared types for the normalization pipeline. The `PipelineContext` is a
 * mutable bag threaded through the stages — each stage fills in the fields it
 * can resolve, leaving the rest as `unresolved()`.
 */

import type { Types } from "mongoose";
import type { FieldResolution } from "./normalizedProduct.model.js";
import type { RawProductDoc } from "../ingestion/rawProduct.model.js";

export interface PipelineFields {
  canonicalBrand: FieldResolution<string>;
  canonicalModel: FieldResolution<string>;
  generation: FieldResolution<string>;
  partType: FieldResolution<string>;
  oem: FieldResolution<string>;
}

export interface PipelineContext {
  raw: RawProductDoc;
  /** Combined title + brand + category, normalized. */
  cleanedText: string;
  /** Token list of the cleaned text (Latin/Cyrillic as written). */
  tokens: string[];
  /** Token list after Latin→Cyrillic transliteration (recall widening). */
  cyrillicTokens: string[];
  fields: PipelineFields;
  canonicalPartId: Types.ObjectId | null;
  pipelineVersion: string;
}

/** A field the rules could not resolve. confidence 0 / value null = "unknown". */
export function unresolved(): FieldResolution<string> {
  return { value: null, confidence: 0, source: "regex" };
}
