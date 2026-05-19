import User from "../Model/user.model.js";
import Product from "../Model/product.model.js";
import Order from "../Model/order.model.js";
import { notifyAdmins } from "../Service/notification.service.js";
import { getSellerAnalytics, parseRange } from "../Service/analytics.service.js";
import { FORMATS } from "../Service/export.service.js";

const HISTORY_LIMIT = 50;

const mergeHistory = (existing, additions) => {
  const next = [...new Set([
    ...additions.map((x) => String(x).trim()).filter(Boolean),
    ...(existing || []),
  ])];
  return next.slice(0, HISTORY_LIMIT);
};

// ── Apply ─────────────────────────────────────────────────────────
export const apply = async (req, res) => {
  try {
    const { shopName, description, bankAccount, logo } = req.body;
    if (!shopName || shopName.trim().length < 2) {
      return res.status(400).json({ message: "Дэлгүүрийн нэр шаардлагатай" });
    }
    if (req.user.sellerStatus === "approved") {
      return res.status(400).json({ message: "Та аль хэдийн seller болсон байна" });
    }
    req.user.role = req.user.role === "admin" ? "admin" : "seller";
    req.user.sellerStatus = "pending";
    req.user.sellerProfile = {
      ...(req.user.sellerProfile || {}),
      shopName: shopName.trim(),
      description: description || "",
      bankAccount: bankAccount || "",
      logo: logo || "",
      appliedAt: new Date(),
      rejectedReason: "",
    };
    await req.user.save();
    notifyAdmins({
      type: "seller_application",
      title: "Шинэ seller хүсэлт",
      body: `${req.user.name} (${req.user.email}) seller болохыг хүссэн.`,
      link: "/admin/sellers",
      data: { userId: String(req.user._id) },
    });
    return res.json({ user: req.user });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

// ── Profile (shop details) ────────────────────────────────────────
export const updateProfile = async (req, res) => {
  try {
    if (!["seller", "admin"].includes(req.user.role)) {
      return res.status(403).json({ message: "Seller эрх шаардлагатай" });
    }
    const { shopName, description, bankAccount, logo } = req.body;
    const sp = req.user.sellerProfile || {};
    if (shopName !== undefined) sp.shopName = shopName.trim();
    if (description !== undefined) sp.description = description;
    if (bankAccount !== undefined) sp.bankAccount = bankAccount;
    if (logo !== undefined) sp.logo = logo;
    req.user.sellerProfile = sp;
    await req.user.save();
    return res.json({ user: req.user });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

// ── Settings (inventory + notification preferences) ──────────────
export const updateSettings = async (req, res) => {
  try {
    const sp = req.user.sellerProfile || {};
    const { defaultLowStockThreshold, emailAlertsEnabled } = req.body;
    if (defaultLowStockThreshold !== undefined) {
      const n = Number(defaultLowStockThreshold);
      if (!Number.isFinite(n) || n < 0 || n > 1000) {
        return res.status(400).json({ message: "Threshold 0-1000 хооронд байх ёстой" });
      }
      sp.defaultLowStockThreshold = n;
    }
    if (emailAlertsEnabled !== undefined) {
      sp.emailAlertsEnabled = Boolean(emailAlertsEnabled);
    }
    req.user.sellerProfile = sp;
    req.user.markModified("sellerProfile");
    await req.user.save();
    return res.json({ user: req.user });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

// ── Facets (autocomplete data for product form) ──────────────────
/**
 * Returns the union of (a) the seller's own previously-used values and
 * (b) the most common values across the entire approved catalogue.
 * Used by the Combobox in the product form.
 */
export const facets = async (req, res) => {
  try {
    const sp = req.user.sellerProfile || {};
    const [globalSources, globalCategories, globalBrands, globalTags] = await Promise.all([
      Product.distinct("source", { status: "approved" }),
      Product.distinct("category", { status: "approved" }),
      Product.distinct("brand", { status: "approved" }),
      Product.distinct("tags", { status: "approved" }),
    ]);
    const merge = (mine = [], global = []) =>
      [...new Set([...(mine || []), ...global.filter(Boolean)])].sort((a, b) => a.localeCompare(b)).slice(0, 200);
    return res.json({
      sources:    merge(sp.customSources,    globalSources),
      categories: merge(sp.customCategories, globalCategories),
      brands:     merge(sp.customBrands,     globalBrands),
      tags:       merge(sp.customTags,       globalTags),
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * Persist new free-text values into the seller's "recently used" history.
 * Called from product create/update controller (NOT a route).
 */
export const rememberInputs = async (userId, { source, category, brand, tags = [] }) => {
  try {
    const user = await User.findById(userId);
    if (!user) return;
    const sp = user.sellerProfile || {};
    if (source)   sp.customSources    = mergeHistory(sp.customSources,    [source]);
    if (category) sp.customCategories = mergeHistory(sp.customCategories, [category]);
    if (brand)    sp.customBrands     = mergeHistory(sp.customBrands,     [brand]);
    if (tags?.length) sp.customTags   = mergeHistory(sp.customTags,       tags);
    user.sellerProfile = sp;
    user.markModified("sellerProfile");
    await user.save();
  } catch { /* swallow — non-fatal */ }
};

// ── Dashboard (kept for backward compat — delegates to analytics service) ─
export const dashboard = async (req, res) => {
  try {
    const a = await getSellerAnalytics(req.user._id, {});
    return res.json({
      totals: {
        products: a.inventory.totalProducts,
        approved: a.inventory.approved,
        pending: a.inventory.pending,
        rejected: a.inventory.rejected,
        orders: a.totals.orders,
        revenue: a.totals.revenue,
        commission: a.totals.commission,
        netRevenue: a.totals.profit,
      },
      statusBreakdown: a.statusBreakdown,
      recentOrders: a.recentOrders,
      topProducts: a.topProducts.slice(0, 5).map((p) => ({ _id: p._id, name: p.name, qty: p.units, revenue: p.revenue })),
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// ── Analytics (full payload with date range) ─────────────────────
export const analytics = async (req, res) => {
  try {
    const a = await getSellerAnalytics(req.user._id, req.query);
    return res.json(a);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// ── Analytics export ─────────────────────────────────────────────
export const analyticsExport = async (req, res) => {
  try {
    const format = String(req.query.format || "xlsx").toLowerCase();
    const fn = FORMATS[format];
    if (!fn) return res.status(400).json({ message: "format: xlsx | csv | pdf" });

    const a = await getSellerAnalytics(req.user._id, req.query);
    const shopName = req.user.sellerProfile?.shopName;
    const result = await fn(a, { shopName });

    res.setHeader("Content-Type", result.mime);
    res.setHeader("Content-Disposition", `attachment; filename="${result.filename}"`);
    res.setHeader("Content-Length", result.buffer.length);
    return res.end(result.buffer);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// ── My orders (unchanged) ────────────────────────────────────────
export const myOrders = async (req, res) => {
  try {
    const sellerId = req.user._id;
    const productIds = await Product.find({ seller: sellerId }).distinct("_id");
    const orders = await Order.find({ "items.product": { $in: productIds } })
      .populate("user", "name email phone")
      .sort({ createdAt: -1 });
    return res.json({ orders });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// helper exported for tests
export const _internal = { parseRange };
