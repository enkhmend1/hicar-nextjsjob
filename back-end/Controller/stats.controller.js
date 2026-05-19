import Order from "../Model/order.model.js";
import Product from "../Model/product.model.js";
import User from "../Model/user.model.js";
import { cacheGet, cacheSet } from "../Config/redis.js";

export const lowStock = async (req, res) => {
  try {
    const threshold = Number(req.query.threshold) || 5;
    const items = await Product.find({
      $or: [{ stockQty: { $lte: threshold } }, { inStock: false }],
    }).sort({ stockQty: 1 });
    return res.json({ threshold, items });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

export const dashboard = async (_req, res) => {
  try {
    const cached = await cacheGet("stats:dashboard");
    if (cached) return res.json(cached);
    const [
      totalUsers, totalProducts, totalOrders,
      revenueAgg, statusAgg, recentOrders, topProductsAgg,
    ] = await Promise.all([
      User.countDocuments(),
      Product.countDocuments(),
      Order.countDocuments(),
      Order.aggregate([
        { $match: { status: { $in: ["paid", "processing", "shipped", "delivered"] } } },
        { $group: { _id: null, sum: { $sum: "$total" } } },
      ]),
      Order.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
      Order.find().populate("user", "name email").sort({ createdAt: -1 }).limit(5),
      Order.aggregate([
        { $unwind: "$items" },
        {
          $group: {
            _id: "$items.product",
            name: { $first: "$items.name" },
            qty: { $sum: "$items.quantity" },
            revenue: { $sum: { $multiply: ["$items.price", "$items.quantity"] } },
          },
        },
        { $sort: { qty: -1 } },
        { $limit: 5 },
      ]),
    ]);

    const payload = {
      totals: {
        users: totalUsers,
        products: totalProducts,
        orders: totalOrders,
        revenue: revenueAgg[0]?.sum || 0,
      },
      statusBreakdown: statusAgg.reduce((m, r) => ({ ...m, [r._id]: r.count }), {}),
      recentOrders,
      topProducts: topProductsAgg,
    };
    await cacheSet("stats:dashboard", payload, 30); // shorter TTL for dashboard
    return res.json(payload);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};
