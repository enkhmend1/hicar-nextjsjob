/**
 * Background Agent service — Phase L.
 *
 * The first true "agent" layer in HiCar that runs WITHOUT a user
 * prompt. A scheduler (Queue/backgroundAgent.queue.js) ticks daily,
 * fires every registered check, and each check produces zero-or-more
 * in-app notifications targeted at the right recipient.
 *
 * Why this matters:
 *   The chat agent is reactive — user asks → AI responds. Background
 *   agents flip that: the system NOTICES things (deadstock crossing a
 *   threshold, a spike in zero-result searches) and surfaces them
 *   without anyone asking. That's what makes a stateful agent platform
 *   feel like a colleague rather than a search box.
 *
 * Check anatomy:
 *   {
 *     name:        "seller_deadstock_alert",   // immutable key (also used by the throttle log)
 *     cooldownMs:  7 days,                     // never re-fire to the same recipient inside this window
 *     enabled:     true | env-overridable,     // ops can shut a check off without redeploy
 *     compute:    async () => Notification[],  // raw "things worth notifying about"
 *   }
 *
 * compute() returns an array of *intended* notifications. The runner
 * filters those by per-(check, recipient) cooldown via the
 * BackgroundAgentLog collection, persists what's left as real
 * Notification rows, and updates the log. Email/push delivery is
 * handled downstream by notificationOutbox.service if configured.
 *
 * Safety:
 *   • compute() failures are caught per-check; one bad check doesn't
 *     poison the others.
 *   • Per-check + per-recipient cooldown enforced server-side — even
 *     a buggy check that emits twice can't double-notify a user.
 *   • Anonymous / missing recipient rows are dropped silently.
 */

import chalk from "chalk";
import User                from "../Model/user.model.js";
import Notification        from "../Model/notification.model.js";
import BackgroundAgentLog  from "../Model/backgroundAgentLog.model.js";

import { findDeadstock }                                  from "./sellerInsights.service.js";
import { getMarketGaps, getFinancialMetrics }             from "./adminInsights.service.js";

const ONE_DAY_MS  = 24 * 60 * 60 * 1000;
const ONE_WEEK_MS = 7  * ONE_DAY_MS;

// Per-seller deadstock alert ONLY when trapped capital crosses this
// threshold — saves us pinging hobby sellers with ₮20K of slow stock.
const DEADSTOCK_NOTIFY_THRESHOLD_MNT =
  Number(process.env.AI_BG_DEADSTOCK_THRESHOLD_MNT) || 500_000;

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

const fmtMNT = (n) => `₮${Number(n || 0).toLocaleString("mn-MN")}`;

/**
 * Should we fire `checkName` for `recipient` right now? True when the
 * last fire is older than `cooldownMs` ago (or there's no row at all).
 */
const isCoolDownPassed = async (checkName, recipient, cooldownMs) => {
  const row = await BackgroundAgentLog.findOne({ checkName, recipient }).lean();
  if (!row) return true;
  return Date.now() - new Date(row.lastRunAt).getTime() >= cooldownMs;
};

/** Persist the notification + bump the throttle row in one path. */
const fire = async (checkName, recipient, notification) => {
  await Notification.create({
    user: recipient,
    type: "ai_insight",
    title: notification.title,
    body:  notification.body,
    link:  notification.link || "",
    data:  { kind: checkName, ...(notification.data || {}) },
  });
  await BackgroundAgentLog.findOneAndUpdate(
    { checkName, recipient },
    { $set: { lastRunAt: new Date(), payload: notification.payload || {} } },
    { upsert: true, returnDocument: "after" },
  );
};

// ────────────────────────────────────────────────────────────────────
// CHECKS
// Each check returns the COUNT of notifications it actually fired
// (after cooldown filtering).
// ────────────────────────────────────────────────────────────────────

/**
 * Walk every approved seller. For each, run findDeadstock; if their
 * trapped capital crosses the threshold, fire one notification.
 *
 * Cooldown: 7 days per seller. Sellers don't want a daily nag — once
 * a week is enough to motivate a hygiene pass.
 */
const sellerDeadstockAlert = async () => {
  const sellers = await User.find({ role: "seller", sellerStatus: "approved" })
    .select("_id").lean();

  let sent = 0;
  for (const seller of sellers) {
    const cooldownOk = await isCoolDownPassed("seller_deadstock_alert", seller._id, ONE_WEEK_MS);
    if (!cooldownOk) continue;

    try {
      const r = await findDeadstock(seller._id, { monthsSilent: 6, limit: 5 });
      const trapped = r.summary?.trappedCapital || 0;
      if (trapped < DEADSTOCK_NOTIFY_THRESHOLD_MNT) continue;

      await fire("seller_deadstock_alert", seller._id, {
        title: `${r.items.length} SKU зургаан сар зарагдаагүй (${fmtMNT(trapped)} капитал)`,
        body:  `Дээд нь "${r.items[0]?.name}" — ${fmtMNT(r.items[0]?.trappedCapital)} бэхэлсэн. ` +
               `Хямдрал / урамшуулал ажилуулбал чөлөөлөгдөнө.`,
        link:  "/seller/products",
        data:  { trappedCapital: trapped, topSkuId: r.items[0]?.productId },
        payload: { trappedCapital: trapped, items: r.items.length },
      });
      sent++;
    } catch (e) {
      console.warn(chalk.yellow(`[bg-agent] deadstock check failed for seller ${seller._id}: ${e.message}`));
    }
  }
  return sent;
};

/**
 * Per-seller low-stock alert. Reuses the seller's own
 * `defaultLowStockThreshold` (Phase B already has this in the User
 * model). Cooldown 7 days — same nag-avoidance logic.
 */
const sellerLowStockAlert = async () => {
  const Product = (await import("../Model/product.model.js")).default;

  const sellers = await User.find({ role: "seller", sellerStatus: "approved" })
    .select("_id sellerProfile.defaultLowStockThreshold").lean();

  let sent = 0;
  for (const seller of sellers) {
    const cooldownOk = await isCoolDownPassed("seller_low_stock_alert", seller._id, ONE_WEEK_MS);
    if (!cooldownOk) continue;

    const threshold = seller.sellerProfile?.defaultLowStockThreshold ?? 5;
    try {
      const lowStock = await Product.find({
        seller:   seller._id,
        status:   "approved",
        $or: [{ stockQty: { $lte: threshold } }, { inStock: false }],
      })
        .select("name oem stockQty")
        .limit(10).lean();

      if (lowStock.length < 3) continue;   // 1-2 low items are routine; don't nag

      const sample = lowStock.slice(0, 3).map((p) => p.name).join(", ");
      await fire("seller_low_stock_alert", seller._id, {
        title: `${lowStock.length} бараа цөөн үлдсэн (≤${threshold} ширхэг)`,
        body:  `Жишээ: ${sample}${lowStock.length > 3 ? "…" : ""}`,
        link:  "/seller/products?filter=low_stock",
        data:  { count: lowStock.length, threshold },
        payload: { count: lowStock.length, threshold },
      });
      sent++;
    } catch (e) {
      console.warn(chalk.yellow(`[bg-agent] low-stock check failed for seller ${seller._id}: ${e.message}`));
    }
  }
  return sent;
};

/**
 * Weekly admin market-gap digest. One notification per admin so each
 * admin's read state is independent.
 */
const adminMarketGapDigest = async () => {
  const admins = await User.find({ role: "admin" }).select("_id").lean();
  if (admins.length === 0) return 0;

  let gaps;
  try {
    gaps = await getMarketGaps({ daysLookback: 7, minOccurrences: 2, limit: 10 });
  } catch (e) {
    console.warn(chalk.yellow(`[bg-agent] market-gap query failed: ${e.message}`));
    return 0;
  }

  const clusters = gaps.data?.clusters || [];
  if (clusters.length === 0) return 0;       // nothing to report this week

  let sent = 0;
  for (const admin of admins) {
    const cooldownOk = await isCoolDownPassed("admin_market_gap_digest", admin._id, ONE_WEEK_MS);
    if (!cooldownOk) continue;

    const top = clusters[0];
    await fire("admin_market_gap_digest", admin._id, {
      title: `Зах зээлийн цоорхой — ${clusters.length} хариугүй хайлт`,
      body:  `Тэргүүн: "${top.query}" (${top.occurrences} удаа). Нөөцөнд оруулах боломж.`,
      link:  "/admin/ai-insights",
      data:  { topQuery: top.query, topCount: top.occurrences, totalClusters: clusters.length },
      payload: { totalClusters: clusters.length, topOccurrences: top.occurrences },
    });
    sent++;
  }
  return sent;
};

/**
 * Weekly admin revenue snapshot. Highlights big WoW swings.
 */
const adminFinancialSummary = async () => {
  const admins = await User.find({ role: "admin" }).select("_id").lean();
  if (admins.length === 0) return 0;

  let metrics;
  try {
    metrics = await getFinancialMetrics({ period: "week", topN: 1 });
  } catch (e) {
    console.warn(chalk.yellow(`[bg-agent] financial summary query failed: ${e.message}`));
    return 0;
  }

  const d = metrics.data || {};
  // Only push if there's actual revenue this week — empty stretches
  // generate noise.
  if (!d.revenue || d.revenue <= 0) return 0;

  let sent = 0;
  for (const admin of admins) {
    const cooldownOk = await isCoolDownPassed("admin_financial_summary", admin._id, ONE_WEEK_MS);
    if (!cooldownOk) continue;

    const growthBadge = (d.growthRateWoW === null || d.growthRateWoW === undefined) ? ""
      : d.growthRateWoW >  20 ? "🚀 "
      : d.growthRateWoW < -20 ? "⚠ "
      : "";
    const growthText = (d.growthRateWoW === null || d.growthRateWoW === undefined)
      ? ""
      : ` (${d.growthRateWoW > 0 ? "+" : ""}${d.growthRateWoW}% долоо хоног)`;

    await fire("admin_financial_summary", admin._id, {
      title: `${growthBadge}Долоо хоногийн орлого ${fmtMNT(d.revenue)}${growthText}`,
      body:  `${d.orderCount} захиалга, AOV ${fmtMNT(d.avgOrder)}, маржин ${d.marginPercent}%.`,
      link:  "/admin/ai-insights",
      data:  {
        revenue: d.revenue, orderCount: d.orderCount,
        avgOrder: d.avgOrder, marginPercent: d.marginPercent,
        growthRateWoW: d.growthRateWoW,
      },
      payload: { revenue: d.revenue, growthRateWoW: d.growthRateWoW },
    });
    sent++;
  }
  return sent;
};

// ────────────────────────────────────────────────────────────────────
// REGISTRY
// ────────────────────────────────────────────────────────────────────

export const CHECKS = Object.freeze([
  {
    name:        "seller_deadstock_alert",
    cooldownMs:  ONE_WEEK_MS,
    enabled:     process.env.AI_BG_SELLER_DEADSTOCK !== "false",
    compute:     sellerDeadstockAlert,
  },
  {
    name:        "seller_low_stock_alert",
    cooldownMs:  ONE_WEEK_MS,
    enabled:     process.env.AI_BG_SELLER_LOW_STOCK !== "false",
    compute:     sellerLowStockAlert,
  },
  {
    name:        "admin_market_gap_digest",
    cooldownMs:  ONE_WEEK_MS,
    enabled:     process.env.AI_BG_ADMIN_MARKET_GAP !== "false",
    compute:     adminMarketGapDigest,
  },
  {
    name:        "admin_financial_summary",
    cooldownMs:  ONE_WEEK_MS,
    enabled:     process.env.AI_BG_ADMIN_FINANCIAL !== "false",
    compute:     adminFinancialSummary,
  },
]);

/**
 * Runs every enabled check once. Returns a summary the scheduler logs.
 * Never throws — each check is wrapped in try/catch so one failure
 * doesn't taint the others.
 *
 *   {
 *     totalSent: 12,
 *     perCheck: {
 *       seller_deadstock_alert: 4,
 *       seller_low_stock_alert: 6,
 *       admin_market_gap_digest: 1,
 *       admin_financial_summary: 1,
 *     },
 *     skipped: ["check_name_if_disabled", …],
 *     errored: [{ name, error }, …],
 *   }
 */
export const runAllBackgroundChecks = async () => {
  const perCheck = {};
  const skipped  = [];
  const errored  = [];
  let totalSent = 0;

  for (const check of CHECKS) {
    if (!check.enabled) { skipped.push(check.name); continue; }
    try {
      const n = await check.compute();
      perCheck[check.name] = n;
      totalSent += n;
    } catch (e) {
      console.error(chalk.red(`[bg-agent] check "${check.name}" failed: ${e.message}`));
      errored.push({ name: check.name, error: e.message });
      perCheck[check.name] = 0;
    }
  }
  return { totalSent, perCheck, skipped, errored };
};

// Test exports
export const __internal = Object.freeze({
  DEADSTOCK_NOTIFY_THRESHOLD_MNT,
  ONE_DAY_MS, ONE_WEEK_MS,
  isCoolDownPassed, fire, fmtMNT,
});
