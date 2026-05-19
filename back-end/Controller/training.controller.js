import SearchLog from "../Model/searchLog.model.js";
import OemMapping from "../Model/oemMapping.model.js";
import { invalidateMappingCache } from "../Service/oem.service.js";

// ── Search logs ────────────────────────────────────────────────────

/**
 * GET /api/training/logs
 * Query: ?zeroOnly=true | ?source=ai|shop|voice|image | ?limit=200
 */
export const listLogs = async (req, res) => {
  try {
    const { zeroOnly, source, limit = 200, since } = req.query;
    const filter = {};
    if (zeroOnly === "true") filter.resultCount = 0;
    if (source && source !== "all") filter.source = source;
    if (since) filter.createdAt = { $gte: new Date(since) };
    const logs = await SearchLog.find(filter)
      .sort({ createdAt: -1 })
      .limit(Math.min(1000, Number(limit)))
      .lean();
    return res.json({ logs });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * GET /api/training/zero-result-summary
 * Aggregates top zero-result queries last 30d for the dashboard.
 */
export const zeroResultSummary = async (_req, res) => {
  try {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const rows = await SearchLog.aggregate([
      { $match: { resultCount: 0, createdAt: { $gte: since } } },
      {
        $group: {
          _id: { $toLower: "$query" },
          count: { $sum: 1 },
          lastAt: { $max: "$createdAt" },
        },
      },
      { $sort: { count: -1, lastAt: -1 } },
      { $limit: 50 },
      { $project: { _id: 0, query: "$_id", count: 1, lastAt: 1 } },
    ]);
    return res.json({ queries: rows });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// ── OEM mappings (CRUD) ────────────────────────────────────────────

const sanitize = (body) => ({
  keyword: typeof body.keyword === "string" ? body.keyword.trim().toLowerCase() : "",
  category: body.category || "",
  oemHint: typeof body.oemHint === "string" ? body.oemHint.trim() : "",
  note: typeof body.note === "string" ? body.note.trim() : "",
  enabled: body.enabled !== false,
});

export const listMappings = async (req, res) => {
  try {
    const { q, category } = req.query;
    const filter = {};
    if (q) filter.keyword = { $regex: q.toLowerCase(), $options: "i" };
    if (category && category !== "all") filter.category = category;
    const items = await OemMapping.find(filter).sort({ usageCount: -1, keyword: 1 }).lean();
    return res.json({ items });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

export const createMapping = async (req, res) => {
  try {
    const body = sanitize(req.body);
    if (!body.keyword) return res.status(400).json({ message: "keyword шаардлагатай" });
    body.createdBy = req.user._id;
    try {
      const item = await OemMapping.create(body);
      invalidateMappingCache();
      return res.status(201).json({ item });
    } catch (e) {
      if (e.code === 11000) {
        return res.status(409).json({ message: "Энэ keyword аль хэдийн байна" });
      }
      throw e;
    }
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

export const updateMapping = async (req, res) => {
  try {
    const body = sanitize(req.body);
    if (!body.keyword) return res.status(400).json({ message: "keyword шаардлагатай" });
    const item = await OemMapping.findByIdAndUpdate(req.params.id, body, { new: true });
    if (!item) return res.status(404).json({ message: "Олдсонгүй" });
    invalidateMappingCache();
    return res.json({ item });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ message: "Энэ keyword аль хэдийн байна" });
    return res.status(400).json({ message: err.message });
  }
};

export const deleteMapping = async (req, res) => {
  try {
    const item = await OemMapping.findByIdAndDelete(req.params.id);
    if (!item) return res.status(404).json({ message: "Олдсонгүй" });
    invalidateMappingCache();
    return res.json({ ok: true });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

/**
 * POST /api/training/mappings/from-query
 * One-click action from the search-logs UI: create a mapping pre-filled from a
 * zero-result query so admin only needs to pick the category.
 */
export const createMappingFromQuery = async (req, res) => {
  try {
    const { query, category, oemHint } = req.body;
    if (!query) return res.status(400).json({ message: "query шаардлагатай" });
    const keyword = String(query).trim().toLowerCase();
    const existing = await OemMapping.findOne({ keyword });
    if (existing) return res.json({ item: existing, created: false });
    const item = await OemMapping.create({
      keyword,
      category: category || "other",
      oemHint: oemHint || "",
      createdBy: req.user._id,
    });
    invalidateMappingCache();
    return res.status(201).json({ item, created: true });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};
