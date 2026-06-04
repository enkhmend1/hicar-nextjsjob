/**
 * change_log — event-sourced, hash-chained version history for governance
 * actions (corrections, alias upserts, canonical edits). Each entry's `hash`
 * covers the previous entry's `hash`, so any tampering with history breaks the
 * chain — the same immutability pattern as the legacy financialAudit log.
 *
 * Gives full auditability ("who changed this part name, when, from what") and
 * the substrate for rollback.
 */

import { Schema, model, Types, type HydratedDocument } from "mongoose";

export type ChangeEntity =
  | "normalized_product"
  | "canonical_part"
  | "part_alias"
  | "fitment";

export type ChangeOp = "create" | "update" | "delete" | "merge";

export interface ChangeLogEntry {
  entity: ChangeEntity;
  entityId: Types.ObjectId;
  op: ChangeOp;
  before?: unknown;
  after?: unknown;
  actor: Types.ObjectId | "system";
  prevHash: string;
  hash: string;
  createdAt: Date;
}

export type ChangeLogDoc = HydratedDocument<ChangeLogEntry>;

const changeLogSchema = new Schema<ChangeLogEntry>(
  {
    entity: {
      type: String,
      enum: ["normalized_product", "canonical_part", "part_alias", "fitment"],
      required: true,
    },
    entityId: { type: Schema.Types.ObjectId, required: true, index: true },
    op: { type: String, enum: ["create", "update", "delete", "merge"], required: true },
    before: { type: Schema.Types.Mixed },
    after: { type: Schema.Types.Mixed },
    actor: { type: Schema.Types.Mixed, required: true }, // ObjectId | "system"
    prevHash: { type: String, required: true },
    hash: { type: String, required: true, unique: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: "change_log" },
);

changeLogSchema.index({ entity: 1, entityId: 1, createdAt: -1 });

export const ChangeLogModel = model<ChangeLogEntry>("ChangeLog", changeLogSchema);
