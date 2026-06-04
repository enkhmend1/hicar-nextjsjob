/**
 * Append-only, hash-chained change log. Each entry hashes the previous entry's
 * hash + its own canonical payload, so the chain is tamper-evident.
 *
 * Concurrency note: under heavy concurrent writes two appenders could read the
 * same tip and fork the chain. The legacy financialAudit service guards this
 * with a CAS lock; correction volume here is low, so M3 uses the simpler
 * read-tip-then-append. Hardening to CAS is a documented follow-up.
 */

import crypto from "node:crypto";
import { Types } from "mongoose";
import { ChangeLogModel, type ChangeEntity, type ChangeOp } from "./changeLog.model.js";

const GENESIS = "GENESIS";

export interface AppendChangeInput {
  entity: ChangeEntity;
  entityId: Types.ObjectId;
  op: ChangeOp;
  actor: Types.ObjectId | "system";
  before?: unknown;
  after?: unknown;
}

function hashEntry(input: AppendChangeInput, prevHash: string, ts: string): string {
  const payload = JSON.stringify({
    entity: input.entity,
    entityId: String(input.entityId),
    op: input.op,
    actor: String(input.actor),
    before: input.before ?? null,
    after: input.after ?? null,
    prevHash,
    ts,
  });
  return crypto.createHash("sha256").update(payload).digest("hex");
}

export async function appendChange(input: AppendChangeInput): Promise<string> {
  const tip = await ChangeLogModel.findOne().sort({ createdAt: -1, _id: -1 }).select("hash").lean();
  const prevHash = tip?.hash ?? GENESIS;
  const ts = new Date().toISOString();
  const hash = hashEntry(input, prevHash, ts);

  await ChangeLogModel.create({
    entity: input.entity,
    entityId: input.entityId,
    op: input.op,
    actor: input.actor,
    before: input.before ?? null,
    after: input.after ?? null,
    prevHash,
    hash,
  });
  return hash;
}

/** Read the version history of one entity, newest first. */
export async function getEntityHistory(entity: ChangeEntity, entityId: string, limit = 50) {
  return ChangeLogModel.find({ entity, entityId: new Types.ObjectId(entityId) })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
}
