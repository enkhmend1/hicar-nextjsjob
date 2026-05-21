/**
 * Admin audit controller.
 *
 *   GET /api/admin/audit              — list recent audit rows with filters
 *   GET /api/admin/audit/verify       — replay the chain, report integrity
 *   GET /api/admin/audit/:id          — single row detail
 */

import FinancialAudit from "../Model/financialAudit.model.js";
import { verifyChain } from "../Service/financialAudit.service.js";

export const listAudit = async (req, res) => {
  try {
    const { type, orderId, disputeId, sellerId, limit = 100, offset = 0 } = req.query;
    const filter = {};
    if (type)      filter.type = type;
    if (orderId)   filter.orderId = orderId;
    if (disputeId) filter.disputeId = disputeId;
    if (sellerId)  filter.sellerId = sellerId;

    const rows = await FinancialAudit.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip(Math.max(0, Number(offset) || 0))
      .limit(Math.min(500, Math.max(1, Number(limit) || 100)))
      .lean();
    const total = await FinancialAudit.countDocuments(filter);
    return res.json({ rows, total });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

export const getAuditRow = async (req, res) => {
  try {
    const row = await FinancialAudit.findById(req.params.id).lean();
    if (!row) return res.status(404).json({ message: "Audit row олдсонгүй" });
    return res.json({ row });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

/**
 * Replay the chain. O(n) — admins can specify `limit` to bound the work
 * (default 10k rows). Reports the first break encountered, if any.
 */
export const verifyAudit = async (req, res) => {
  try {
    const limit = Math.min(50_000, Math.max(100, Number(req.query.limit) || 10_000));
    const result = await verifyChain({ limit });
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};
