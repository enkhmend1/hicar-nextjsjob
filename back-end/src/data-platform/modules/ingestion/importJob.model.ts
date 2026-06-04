/**
 * import_jobs — tracks the lifecycle of a CSV/Excel bulk upload.
 *
 * The upload endpoint creates one of these synchronously and returns its id;
 * the import worker streams the file, writes raw_products, and updates the
 * counters here so the client can poll progress.
 */

import { Schema, model, Types, type HydratedDocument } from "mongoose";

export type ImportStatus = "queued" | "parsing" | "ingesting" | "done" | "failed";

export interface ImportJobError {
  row: number;
  reason: string;
}

export interface ImportJob {
  sellerId: Types.ObjectId;
  filename: string;
  source: "csv" | "excel";
  totalRows: number;
  processed: number;
  failed: number;
  /** Rows skipped because their title was empty. */
  skippedCount: number;
  /** Rows whose content already existed (idempotent re-import). */
  duplicateCount: number;
  /** True when AI remapped at least one unrecognized column header. */
  aiHeadersApplied: boolean;
  status: ImportStatus;
  errors: ImportJobError[];
  createdAt: Date;
  updatedAt: Date;
  finishedAt?: Date;
}

export type ImportJobDoc = HydratedDocument<ImportJob>;

const importJobSchema = new Schema<ImportJob>(
  {
    sellerId: { type: Schema.Types.ObjectId, required: true, index: true },
    filename: { type: String, required: true },
    source: { type: String, enum: ["csv", "excel"], required: true },
    totalRows: { type: Number, default: 0 },
    processed: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    skippedCount: { type: Number, default: 0 },
    duplicateCount: { type: Number, default: 0 },
    aiHeadersApplied: { type: Boolean, default: false },
    status: {
      type: String,
      enum: ["queued", "parsing", "ingesting", "done", "failed"],
      default: "queued",
      index: true,
    },
    errors: {
      type: [{ row: Number, reason: String, _id: false }],
      default: [],
    },
    finishedAt: { type: Date },
  },
  { timestamps: true, collection: "import_jobs" },
);

export const ImportJobModel = model<ImportJob>("ImportJob", importJobSchema);
