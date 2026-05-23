/**
 * Admin-side AI insights service (Phase C).
 *
 * Three independent capabilities behind the Admin persona's tools:
 *
 *   ① getFinancialMetrics  — revenue, cost-of-goods, net margin, top
 *                            brands, week-over-week growth rate
 *   ② getDemandForecast    — 3-month rolling velocity × seasonal vector
 *                            → projected stocking need per SKU
 *   ③ getMarketGaps        — zero-result SearchLog queries clustered by
 *                            normalised string → ranked inventory holes
 *
 * Why a dedicated module:
 *   • Each call runs a non-trivial aggregation pipeline. Keeping them
 *     in one file lets ops reuse them from cron jobs (weekly Slack
 *     digest, nightly forecast email) without re-implementing the math.
 *   • Aggregations are PURE READS — they never mutate state. That keeps
 *     the admin AI safe to "let loose" on production traffic.
 *
 * Output shapes match the `admin_widget` envelope from
 * aiResponse.service.js — each function returns
 *   { kind, title, data }
 * so the controller can pass them through unchanged.
 */

import Order from "../Model/order.model.js";
import Product from "../Model/product.model.js";
import SearchLog from "../Model/searchLog.model.js";

// Same "real revenue" status whitelist used by sellerInsights — keep in
// sync if you add a new fulfilment status.
const REVENUE_STATUSES = ["paid", "processing", "shipped", "delivered"];

// ────────────────────────────────────────────────────────────────────
// ① Financial metrics
// ────────────────────────────────────────────────────────────────────

const periodToSince = (period) => {
  const now = new Date();
  const d = new Date(now);
  if (period === "today") d.setHours(0, 0, 0, 0);
  else if (period === "week")  d.setDate(now.getDate() - 7);
  else if (period === "month") d.setMonth(now.getMonth() - 1);
  else if (period === "quarter") d.setMonth(now.getMonth() - 3);
  else return null;        // "all" → no lower bound
  return d;
};

/**
 * Aggregate financials for a time window + compare to the *previous*
 * window of equal length for a growth rate.
 *
 *   period: "today" | "week" | "month" | "quarter" | "all"
 *   topN:   how many top brands to surface (default 5)
 *
 * Returns:
 *   {
 *     kind: "kpi_grid",
 *     title,
 *     data: {
 *       period, revenue, orderCount, avgOrder, costOfGoods, grossMargin,
 *       marginPercent, growthRateWoW,
 *       topBrands: [{ brand, revenue, units }, …],
 *       statusBreakdown: { paid: 12, shipped: 8, … },
 *     }
 *   }
 */
export const getFinancialMetrics = async ({ period = "week", topN = 5 } = {}) => {
  const since = periodToSince(period);
  const baseMatch = { status: { $in: REVENUE_STATUSES } };
  if (since) baseMatch.createdAt = { $gte: since };

  // Current window — single aggregation that emits multiple facets.
  const [agg] = await Order.aggregate([
    { $match: baseMatch },
    { $facet: {
        totals: [
          { $group: {
              _id: null,
              revenue: { $sum: "$total" },
              orderCount: { $sum: 1 },
          } },
        ],
        statusBreakdown: [
          { $group: { _id: "$status", count: { $sum: 1 } } },
        ],
        // Top brands by line-item revenue (price * qty per item).
        topBrands: [
          { $unwind: "$items" },
          // Join to Product for brand + costPrice (denormalised data
          // on Order.items doesn't include cost, by design).
          { $lookup: {
              from: "products", localField: "items.product",
              foreignField: "_id", as: "prod",
          } },
          { $unwind: { path: "$prod", preserveNullAndEmptyArrays: true } },
          { $group: {
              _id: "$prod.brand",
              revenue: { $sum: { $multiply: ["$items.price", { $ifNull: ["$items.qty", 1] }] } },
              units: { $sum: { $ifNull: ["$items.qty", 1] } },
              cost: { $sum: { $multiply: [{ $ifNull: ["$prod.costPrice", 0] }, { $ifNull: ["$items.qty", 1] }] } },
          } },
          { $match: { _id: { $ne: null } } },
          { $sort: { revenue: -1 } },
          { $limit: topN },
        ],
        // Cost-of-goods across the whole window for margin %.
        cogs: [
          { $unwind: "$items" },
          { $lookup: {
              from: "products", localField: "items.product",
              foreignField: "_id", as: "prod",
          } },
          { $unwind: { path: "$prod", preserveNullAndEmptyArrays: true } },
          { $group: {
              _id: null,
              cost: { $sum: { $multiply: [{ $ifNull: ["$prod.costPrice", 0] }, { $ifNull: ["$items.qty", 1] }] } },
          } },
        ],
    } },
  ]);

  const totals    = agg?.totals?.[0]    || { revenue: 0, orderCount: 0 };
  const cogs      = agg?.cogs?.[0]?.cost || 0;
  const revenue   = totals.revenue || 0;
  const orderCount = totals.orderCount || 0;
  const grossMargin = revenue - cogs;
  const marginPercent = revenue > 0 ? Math.round((grossMargin / revenue) * 100) : 0;

  // ── Previous-period growth rate ─────────────────────────────────
  let growthRateWoW = null;
  if (since) {
    const windowMs = Date.now() - since.getTime();
    const prevSince = new Date(since.getTime() - windowMs);
    const prevAgg = await Order.aggregate([
      { $match: {
          status: { $in: REVENUE_STATUSES },
          createdAt: { $gte: prevSince, $lt: since },
      } },
      { $group: { _id: null, revenue: { $sum: "$total" } } },
    ]);
    const prevRev = prevAgg?.[0]?.revenue || 0;
    if (prevRev > 0) {
      growthRateWoW = Math.round(((revenue - prevRev) / prevRev) * 100);
    } else if (revenue > 0) {
      growthRateWoW = 100;  // grew from zero
    }
  }

  const statusBreakdown = {};
  for (const s of (agg?.statusBreakdown || [])) {
    if (s._id) statusBreakdown[s._id] = s.count;
  }

  const topBrands = (agg?.topBrands || []).map((b) => ({
    brand:   b._id || "(unknown)",
    revenue: b.revenue,
    units:   b.units,
    cost:    b.cost,
    margin:  b.revenue - b.cost,
  }));

  return {
    kind: "kpi_grid",
    title: `Санхүүгийн үзүүлэлт — ${period}`,
    data: {
      period,
      revenue,
      orderCount,
      avgOrder: orderCount > 0 ? Math.round(revenue / orderCount) : 0,
      costOfGoods: cogs,
      grossMargin,
      marginPercent,
      growthRateWoW,
      topBrands,
      statusBreakdown,
    },
  };
};

// ────────────────────────────────────────────────────────────────────
// ② Demand forecast
// ────────────────────────────────────────────────────────────────────

/**
 * Per-SKU monthly velocity over the past `monthsLookback` months,
 * multiplied by a *seasonal multiplier* derived from the same calendar
 * month one year ago. Projects expected demand for the next month.
 *
 *   formula:
 *     velocity        = sum(units_last_N_months) / N
 *     seasonalFactor  = sales_same_month_LAST_year / avg_monthly_sales_LAST_year
 *     forecastNext    = velocity × seasonalFactor
 *
 * If we have no prior-year data, seasonalFactor=1 (flat trend).
 *
 * Returns the top `limit` SKUs by forecasted demand so the admin can
 * see what to stock up on.
 */
export const getDemandForecast = async ({ monthsLookback = 3, limit = 10 } = {}) => {
  const now = new Date();
  const lookbackStart = new Date(now);
  lookbackStart.setMonth(now.getMonth() - monthsLookback);

  // ── Recent window units per SKU ─────────────────────────────────
  const recent = await Order.aggregate([
    { $match: {
        status: { $in: REVENUE_STATUSES },
        createdAt: { $gte: lookbackStart },
    } },
    { $unwind: "$items" },
    { $group: {
        _id: "$items.product",
        units: { $sum: { $ifNull: ["$items.qty", 1] } },
        revenue: { $sum: { $multiply: ["$items.price", { $ifNull: ["$items.qty", 1] }] } },
    } },
    { $match: { _id: { $ne: null }, units: { $gt: 0 } } },
  ]);

  if (recent.length === 0) {
    return {
      kind: "bar_chart",
      title: "Дараагийн сарын эрэлтийн прогноз",
      data: { months: monthsLookback, items: [], note: "Сүүлийн саруудад захиалга алга — прогноз гаргах өгөгдөл хүрэлцэхгүй." },
    };
  }

  // ── Seasonal vector from the SAME month last year ───────────────
  const seasonStart = new Date(now);
  seasonStart.setFullYear(now.getFullYear() - 1);
  seasonStart.setDate(1);
  seasonStart.setHours(0, 0, 0, 0);
  const seasonEnd = new Date(seasonStart);
  seasonEnd.setMonth(seasonStart.getMonth() + 1);

  const lastYearStart = new Date(seasonStart);
  lastYearStart.setMonth(lastYearStart.getMonth() - 12);

  const seasonAgg = await Order.aggregate([
    { $match: {
        status: { $in: REVENUE_STATUSES },
        createdAt: { $gte: lastYearStart, $lt: seasonEnd },
    } },
    { $unwind: "$items" },
    { $facet: {
        sameMonth: [
          { $match: { createdAt: { $gte: seasonStart, $lt: seasonEnd } } },
          { $group: { _id: null, units: { $sum: { $ifNull: ["$items.qty", 1] } } } },
        ],
        wholeYear: [
          { $group: { _id: null, units: { $sum: { $ifNull: ["$items.qty", 1] } } } },
        ],
    } },
  ]);

  const sameMonthUnits = seasonAgg?.[0]?.sameMonth?.[0]?.units || 0;
  const wholeYearUnits = seasonAgg?.[0]?.wholeYear?.[0]?.units || 0;
  const avgMonthlyLastYear = wholeYearUnits / 12;
  const seasonalFactor = (avgMonthlyLastYear > 0)
    ? +(sameMonthUnits / avgMonthlyLastYear).toFixed(2)
    : 1.0;

  // ── Resolve product names ───────────────────────────────────────
  const productIds = recent.map((r) => r._id);
  const products = await Product.find({ _id: { $in: productIds } })
    .select("name oem brand stockQty")
    .lean();
  const byId = new Map(products.map((p) => [String(p._id), p]));

  const rows = recent.map((r) => {
    const velocity = r.units / monthsLookback;        // units per month
    const forecast = Math.ceil(velocity * seasonalFactor);
    const p = byId.get(String(r._id)) || {};
    return {
      productId:  String(r._id),
      name:       p.name || "(deleted)",
      oem:        p.oem  || "",
      brand:      p.brand || "",
      stockQty:   p.stockQty || 0,
      velocity:   +velocity.toFixed(1),
      forecastNextMonth: forecast,
      shortfall:  Math.max(0, forecast - (p.stockQty || 0)),
    };
  })
    .sort((a, b) => b.forecastNextMonth - a.forecastNextMonth)
    .slice(0, limit);

  return {
    kind: "bar_chart",
    title: "Дараагийн сарын эрэлтийн прогноз",
    data: {
      months: monthsLookback,
      seasonalFactor,
      seasonalNote: seasonalFactor === 1
        ? "Өмнөх жилийн өгөгдөл байхгүй — улирлын засвар хийгээгүй."
        : `Улирлын засвар: ×${seasonalFactor} (өнгөрсөн жилийн ${now.toLocaleString("mn-MN", { month: "long" })}-ийн харьцаа)`,
      x: rows.map((r) => r.oem || r.name.slice(0, 16)),
      y: rows.map((r) => r.forecastNextMonth),
      items: rows,
    },
  };
};

// ────────────────────────────────────────────────────────────────────
// ③ Market gap analysis
// ────────────────────────────────────────────────────────────────────

/**
 * Normalise a raw search string for clustering — lowercase, collapse
 * whitespace, strip punctuation. Two queries that differ only in casing
 * or trailing punctuation cluster together.
 */
const normaliseSearchQuery = (q) =>
  String(q || "")
    .toLowerCase()
    .trim()
    .replace(/[?!.,;:'"`]+/g, "")
    .replace(/\s+/g, " ");

/**
 * Aggregate zero-result searches over `daysLookback` days, cluster by
 * normalised query, return the top clusters sorted by occurrence count.
 *
 *   { kind, title, data: { days, clusters: [{ query, occurrences, lastSeenAt, locale }, …] } }
 *
 * Each cluster is an inventory opportunity — these are queries real
 * users typed that the marketplace couldn't answer.
 */
export const getMarketGaps = async ({ daysLookback = 30, minOccurrences = 2, limit = 15 } = {}) => {
  const since = new Date();
  since.setDate(since.getDate() - daysLookback);

  // Pull the raw zero-hit logs. We do normalisation/clustering in JS
  // rather than aggregation so the regex stripping stays readable —
  // SearchLog volume is bounded (search-only events) so this is fine.
  const logs = await SearchLog.find({
    resultCount: 0,
    createdAt:   { $gte: since },
  })
    .select("query category locale createdAt")
    .lean();

  if (logs.length === 0) {
    return {
      kind: "bar_chart",
      title: "Зах зээлийн цоорхой — Хариугүй хайлтууд",
      data: {
        days: daysLookback,
        clusters: [],
        x: [], y: [],
        note: `Сүүлийн ${daysLookback} хоногт нэг ч 'хариугүй' хайлт алга. Каталоги сайн хамарсан байна.`,
      },
    };
  }

  // Cluster
  const buckets = new Map();
  for (const log of logs) {
    const key = normaliseSearchQuery(log.query);
    if (!key) continue;
    if (!buckets.has(key)) {
      buckets.set(key, {
        query: log.query,            // keep the user's original casing for display
        occurrences: 0,
        firstSeenAt: log.createdAt,
        lastSeenAt:  log.createdAt,
        locales: new Set(),
        categoryHints: new Set(),
      });
    }
    const b = buckets.get(key);
    b.occurrences++;
    if (log.createdAt < b.firstSeenAt) b.firstSeenAt = log.createdAt;
    if (log.createdAt > b.lastSeenAt)  b.lastSeenAt  = log.createdAt;
    if (log.locale)   b.locales.add(log.locale);
    if (log.category) b.categoryHints.add(log.category);
  }

  const clusters = [...buckets.values()]
    .filter((b) => b.occurrences >= minOccurrences)
    .sort((a, b) => b.occurrences - a.occurrences)
    .slice(0, limit)
    .map((b) => ({
      query:         b.query,
      occurrences:   b.occurrences,
      firstSeenAt:   b.firstSeenAt,
      lastSeenAt:    b.lastSeenAt,
      locales:       [...b.locales],
      categoryHints: [...b.categoryHints],
    }));

  return {
    kind: "bar_chart",
    title: "Зах зээлийн цоорхой — Хариугүй хайлтууд",
    data: {
      days: daysLookback,
      minOccurrences,
      totalGaps: logs.length,
      uniqueQueries: buckets.size,
      x: clusters.map((c) => c.query.slice(0, 20)),
      y: clusters.map((c) => c.occurrences),
      clusters,
    },
  };
};

// ────────────────────────────────────────────────────────────────────
// Test exports
// ────────────────────────────────────────────────────────────────────
export const __internal = Object.freeze({
  REVENUE_STATUSES,
  periodToSince,
  normaliseSearchQuery,
});
