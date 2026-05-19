/**
 * Analytics service — aggregation queries for the seller dashboard and
 * downloadable reports. All queries are scoped to a seller's products and
 * an optional date range.
 *
 * Designed for reuse: the admin dashboard can call these with sellerId=null
 * to get platform-wide numbers (left as a future hook).
 */

import mongoose from "mongoose";
import Order from "../Model/order.model.js";
import Product from "../Model/product.model.js";
import User from "../Model/user.model.js";

const PAID_STATUSES = ["paid", "processing", "shipped", "delivered"];
const oid = (v) => new mongoose.Types.ObjectId(v);

/** Parse from/to query → { from: Date, to: Date }, defaults to last 30 days. */
export const parseRange = ({ from, to } = {}) => {
  const now = new Date();
  const end = to ? new Date(to) : now;
  const start = from ? new Date(from) : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
  // normalise to day boundaries
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);
  return { from: start, to: end };
};

/**
 * Core aggregation. Pipeline shape:
 *   Order → unwind items → join product → filter by seller/date → group/project.
 * Returns a structured analytics payload.
 */
export const getSellerAnalytics = async (sellerId, range) => {
  const { from, to } = parseRange(range);
  const sid = oid(sellerId);

  // Seller's product ids (used twice — cache once)
  const productIds = await Product.find({ seller: sid }).distinct("_id");
  if (productIds.length === 0) {
    return emptyPayload(from, to, await loadCommission(sellerId));
  }

  const commissionRate = await loadCommission(sellerId);

  const baseMatch = {
    "items.product": { $in: productIds },
    createdAt: { $gte: from, $lte: to },
  };

  const [
    totalsRows,
    dailyRows,
    monthlyRows,
    topProducts,
    statusRows,
    inventory,
    recentOrders,
  ] = await Promise.all([
    // ── totals: orders, revenue, units (paid statuses only) ─────────
    Order.aggregate([
      { $match: { ...baseMatch, status: { $in: PAID_STATUSES } } },
      { $unwind: "$items" },
      { $lookup: { from: "products", localField: "items.product", foreignField: "_id", as: "p" } },
      { $unwind: "$p" },
      { $match: { "p.seller": sid } },
      {
        $group: {
          _id: "$_id",
          revenue: { $sum: { $multiply: ["$items.price", "$items.quantity"] } },
          units: { $sum: "$items.quantity" },
        },
      },
      {
        $group: {
          _id: null,
          orders: { $sum: 1 },
          revenue: { $sum: "$revenue" },
          units: { $sum: "$units" },
        },
      },
    ]),

    // ── daily series ────────────────────────────────────────────────
    Order.aggregate([
      { $match: { ...baseMatch, status: { $in: PAID_STATUSES } } },
      { $unwind: "$items" },
      { $lookup: { from: "products", localField: "items.product", foreignField: "_id", as: "p" } },
      { $unwind: "$p" },
      { $match: { "p.seller": sid } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          revenue: { $sum: { $multiply: ["$items.price", "$items.quantity"] } },
          units: { $sum: "$items.quantity" },
          orders: { $addToSet: "$_id" },
        },
      },
      {
        $project: {
          _id: 0,
          date: "$_id",
          revenue: 1,
          units: 1,
          orderCount: { $size: "$orders" },
        },
      },
      { $sort: { date: 1 } },
    ]),

    // ── monthly series ──────────────────────────────────────────────
    Order.aggregate([
      { $match: { ...baseMatch, status: { $in: PAID_STATUSES } } },
      { $unwind: "$items" },
      { $lookup: { from: "products", localField: "items.product", foreignField: "_id", as: "p" } },
      { $unwind: "$p" },
      { $match: { "p.seller": sid } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m", date: "$createdAt" } },
          revenue: { $sum: { $multiply: ["$items.price", "$items.quantity"] } },
          units: { $sum: "$items.quantity" },
          orders: { $addToSet: "$_id" },
        },
      },
      {
        $project: { _id: 0, month: "$_id", revenue: 1, units: 1, orderCount: { $size: "$orders" } },
      },
      { $sort: { month: 1 } },
    ]),

    // ── top products (by units sold) ────────────────────────────────
    Order.aggregate([
      { $match: { ...baseMatch, status: { $in: PAID_STATUSES } } },
      { $unwind: "$items" },
      { $lookup: { from: "products", localField: "items.product", foreignField: "_id", as: "p" } },
      { $unwind: "$p" },
      { $match: { "p.seller": sid } },
      {
        $group: {
          _id: "$items.product",
          name: { $first: "$items.name" },
          oem: { $first: "$items.oem" },
          units: { $sum: "$items.quantity" },
          revenue: { $sum: { $multiply: ["$items.price", "$items.quantity"] } },
        },
      },
      { $sort: { units: -1 } },
      { $limit: 10 },
    ]),

    // ── order status breakdown (all statuses, range-wide) ───────────
    Order.aggregate([
      { $match: baseMatch },
      { $unwind: "$items" },
      { $lookup: { from: "products", localField: "items.product", foreignField: "_id", as: "p" } },
      { $unwind: "$p" },
      { $match: { "p.seller": sid } },
      { $group: { _id: { orderId: "$_id", status: "$status" } } },
      { $group: { _id: "$_id.status", count: { $sum: 1 } } },
    ]),

    // ── inventory snapshot (independent of date range) ──────────────
    Product.aggregate([
      { $match: { seller: sid } },
      {
        $group: {
          _id: null,
          totalProducts: { $sum: 1 },
          approved: { $sum: { $cond: [{ $eq: ["$status", "approved"] }, 1, 0] } },
          pending: { $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] } },
          rejected: { $sum: { $cond: [{ $eq: ["$status", "rejected"] }, 1, 0] } },
          inStockCount: { $sum: { $cond: ["$inStock", 1, 0] } },
          outOfStockCount: { $sum: { $cond: ["$inStock", 0, 1] } },
          totalStock: { $sum: "$stockQty" },
          stockValue: { $sum: { $multiply: ["$price", "$stockQty"] } },
        },
      },
    ]),

    // ── recent paid orders for the report header ────────────────────
    Order.find({ ...baseMatch, status: { $in: PAID_STATUSES } })
      .populate("user", "name email")
      .sort({ createdAt: -1 })
      .limit(10)
      .lean(),
  ]);

  const totals = totalsRows[0] ?? { orders: 0, revenue: 0, units: 0 };
  const inv = inventory[0] ?? {
    totalProducts: 0, approved: 0, pending: 0, rejected: 0,
    inStockCount: 0, outOfStockCount: 0, totalStock: 0, stockValue: 0,
  };

  const commission = Math.round((totals.revenue * commissionRate) / 100);
  const profit = totals.revenue - commission;
  const avgOrderValue = totals.orders ? Math.round(totals.revenue / totals.orders) : 0;

  return {
    range: { from, to },
    commissionRate,
    totals: {
      orders: totals.orders,
      revenue: totals.revenue,
      units: totals.units,
      commission,
      profit,
      avgOrderValue,
    },
    daily: dailyRows,
    monthly: monthlyRows,
    topProducts,
    statusBreakdown: statusRows.reduce((acc, r) => ({ ...acc, [r._id]: r.count }), {}),
    inventory: inv,
    recentOrders,
  };
};

// ── helpers ────────────────────────────────────────────────────────
const loadCommission = async (sellerId) => {
  const s = await User.findById(sellerId).select("sellerProfile.platformFeePercent");
  return s?.sellerProfile?.platformFeePercent ?? 5;
};

const emptyPayload = (from, to, commissionRate) => ({
  range: { from, to },
  commissionRate,
  totals: { orders: 0, revenue: 0, units: 0, commission: 0, profit: 0, avgOrderValue: 0 },
  daily: [],
  monthly: [],
  topProducts: [],
  statusBreakdown: {},
  inventory: {
    totalProducts: 0, approved: 0, pending: 0, rejected: 0,
    inStockCount: 0, outOfStockCount: 0, totalStock: 0, stockValue: 0,
  },
  recentOrders: [],
});
