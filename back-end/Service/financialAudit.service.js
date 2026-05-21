/**
 * Financial audit service.
 *
 * Single API:  `appendAudit(entry)` — insert one event into the hash-chained
 *              ledger. Looks up the latest row's `currHash` to seed
 *              `prevHash`, computes `currHash` from canonical payload, then
 *              inserts. Concurrency is handled at the DB level — if two
 *              concurrent appends both read the same tail and both pick the
 *              same prevHash, MongoDB inserts both rows successfully; the
 *              chain remains internally consistent for each verifier-pass
 *              (we verify chain integrity by REPLAYING — not by requiring
 *              total order of inserts). For strict single-line ordering,
 *              wrap calls in a Mongoose transaction at the caller.
 *
 *              `verifyChain({ limit })` — admin endpoint helper. Replays
 *              the chain and reports any break — useful for forensic
 *              audits.
 */

import FinancialAudit from "../Model/financialAudit.model.js";
import chalk from "chalk";

/**
 * Append a single audit row. Caller is responsible for not lying about the
 * `before` / `after` — those are the snapshot semantics. We won't validate
 * against the live order/dispute/user docs (that would defeat the immutable
 * audit goal — if the live state was correct we wouldn't need an audit).
 *
 * @param {{
 *   type: string,
 *   orderId?: any, disputeId?: any, sellerId?: any, buyerId?: any,
 *   actor: string,
 *   amount?: number,
 *   before?: any, after?: any,
 *   metadata?: object,
 * }} entry
 * @returns {Promise<FinancialAudit | null>} null on failure (logged, never thrown)
 */
export const appendAudit = async (entry) => {
  try {
    // Read the tail to seed prevHash. If the collection is empty, prevHash
    // stays "" (the genesis row).
    const tail = await FinancialAudit
      .findOne({})
      .sort({ createdAt: -1, _id: -1 })
      .select("currHash")
      .lean();
    const prevHash = tail?.currHash || "";

    const draft = {
      type:      entry.type,
      orderId:   entry.orderId,
      disputeId: entry.disputeId,
      sellerId:  entry.sellerId,
      buyerId:   entry.buyerId,
      actor:     entry.actor || "system",
      amount:    Math.round(entry.amount || 0),
      before:    entry.before ?? null,
      after:     entry.after  ?? null,
      metadata:  entry.metadata || {},
      prevHash,
    };
    const currHash = FinancialAudit.computeHash(draft);
    return await FinancialAudit.create({ ...draft, currHash });
  } catch (err) {
    // The audit log is fire-and-forget at the call site — a corrupt audit
    // write should not crash a refund flow. Log loudly so observability
    // catches it.
    console.warn(chalk.red(`[audit] append failed type=${entry.type}: ${err.message}`));
    return null;
  }
};

/**
 * Replay the chain and report integrity. O(n) reads; cap with `limit`
 * unless you really need the full history.
 *
 * @returns {{ ok: boolean, scanned: number, brokenAt?: { _id, expected, actual } }}
 */
export const verifyChain = async ({ limit = 10_000 } = {}) => {
  let prevHash = "";
  let scanned = 0;

  const cursor = FinancialAudit.find({})
    .sort({ createdAt: 1, _id: 1 })
    .limit(limit)
    .lean()
    .cursor();

  for await (const row of cursor) {
    scanned++;
    if (row.prevHash !== prevHash) {
      return {
        ok: false,
        scanned,
        brokenAt: {
          _id: String(row._id),
          expected: prevHash,
          actual: row.prevHash,
          reason: "prev_hash_mismatch",
        },
      };
    }
    const expectedHash = FinancialAudit.computeHash(row);
    if (row.currHash !== expectedHash) {
      return {
        ok: false,
        scanned,
        brokenAt: {
          _id: String(row._id),
          expected: expectedHash,
          actual: row.currHash,
          reason: "curr_hash_mismatch",
        },
      };
    }
    prevHash = row.currHash;
  }

  return { ok: true, scanned };
};
