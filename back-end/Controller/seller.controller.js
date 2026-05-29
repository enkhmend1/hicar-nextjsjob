import mongoose from "mongoose";
import User from "../Model/user.model.js";
import Product from "../Model/product.model.js";
import Order from "../Model/order.model.js";
import { notifyAdmins } from "../Service/notification.service.js";
import { getSellerAnalytics, parseRange } from "../Service/analytics.service.js";
import { FORMATS } from "../Service/export.service.js";

const HISTORY_LIMIT = 50;

/**
 * Public seller storefront — Phase P.1.
 *
 * GET /api/seller/store/:id  (no auth required)
 *
 * Returns a sanitized "shop page" payload buyers can render. Strict
 * allow-list of fields — NEVER include email, phone, bank account,
 * platform commission, or any other operational data. Only the
 * customer-facing identity + reputation + product list.
 *
 * Why a dedicated endpoint (not just a user-detail call):
 *   • Sanitization happens server-side — frontend can't accidentally
 *     leak privileged fields by mis-rendering a fuller payload.
 *   • Joins the approved-products list in one round-trip so the
 *     storefront page renders in a single fetch.
 *   • Adds derived stats (totalProducts, categoryBreakdown) the User
 *     doc doesn't store directly — keeps the frontend dumb.
 *
 * 404 when:
 *   • id isn't a valid ObjectId
 *   • user doesn't exist OR isn't an approved seller (anti-enumeration)
 */
export const publicStorefront = async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    return res.status(404).json({ message: "Дэлгүүр олдсонгүй" });
  }

  // Only fetch the fields we'll surface — explicit projection so a
  // future schema addition can't accidentally leak.
  const seller = await User.findOne({
    _id: id,
    role: { $in: ["seller", "admin"] },
    sellerStatus: "approved",
  }).select(
    "name createdAt " +
    "sellerProfile.shopName sellerProfile.description " +
    "sellerProfile.logo sellerProfile.coverImage " +
    "sellerProfile.trustScore sellerProfile.rating sellerProfile.ratingCount " +
    "sellerProfile.totalSales sellerProfile.approvedAt"
  ).lean();

  if (!seller) {
    // Anti-enumeration — same 404 whether the user doesn't exist OR
    // exists-but-isn't-an-approved-seller. Don't leak which.
    return res.status(404).json({ message: "Дэлгүүр олдсонгүй" });
  }

  // Approved products only. Include the same shape the catalogue
  // ProductCard already consumes so the storefront can reuse it.
  const products = await Product.find({
    seller: id,
    status: "approved",
  })
    .select("name oem price originalPrice images iconPath category brand " +
            "source inStock stockQty rating ratingCount badge createdAt")
    .sort({ createdAt: -1 })
    .limit(200)            // bounded; future: paginate when sellers cross this
    .lean();

  // Derived stats — cheap to compute on the wire-down rather than
  // teaching the frontend to aggregate.
  const categoryBreakdown = {};
  for (const p of products) {
    const k = p.category || "other";
    categoryBreakdown[k] = (categoryBreakdown[k] || 0) + 1;
  }

  return res.json({
    shop: {
      id: String(seller._id),
      // Public display: prefer the shop name, fall back to the
      // seller's personal name so an early-stage shop without a name
      // still renders something humane.
      shopName:     seller.sellerProfile?.shopName || seller.name || "Дэлгүүр",
      description:  seller.sellerProfile?.description || "",
      logo:         seller.sellerProfile?.logo || "",
      coverImage:   seller.sellerProfile?.coverImage || "",
      trustScore:   seller.sellerProfile?.trustScore ?? 50,
      rating:       seller.sellerProfile?.rating ?? 0,
      ratingCount:  seller.sellerProfile?.ratingCount ?? 0,
      totalSales:   seller.sellerProfile?.totalSales ?? 0,
      // joinedAt = whenever they were APPROVED as a seller, falling
      // back to account creation if approvedAt isn't set (legacy data).
      joinedAt:     seller.sellerProfile?.approvedAt || seller.createdAt,
    },
    products,
    stats: {
      totalProducts: products.length,
      categoryBreakdown,
    },
  });
};

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
    const { shopName, description, bankAccount, logo, coverImage } = req.body;
    const sp = req.user.sellerProfile || {};
    if (shopName !== undefined) sp.shopName = shopName.trim();
    if (description !== undefined) sp.description = description;
    if (bankAccount !== undefined) sp.bankAccount = bankAccount;
    if (logo !== undefined) sp.logo = logo;
    // Phase Q.1: cover banner for the public storefront. Empty string
    // is a valid value (seller is removing their custom cover → fall
    // back to the generated gradient on the public page).
    if (coverImage !== undefined) sp.coverImage = coverImage;
    req.user.sellerProfile = sp;
    await req.user.save();
    return res.json({ user: req.user });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

// ── Delivery option sanitiser (Phase AU/AV) ──────────────────────
const DELIVERY_TIERS = ["fast", "normal", "cheap"];
// Platform fallbacks — mirror order.controller's DELIVERY_PRICE for `price`.
const DELIVERY_DEFAULTS = {
  fast:   { enabled: true, value: 7,  unit: "day", price: 15000 },
  normal: { enabled: true, value: 14, unit: "day", price: 8000 },
  cheap:  { enabled: true, value: 21, unit: "day", price: 0 },
};
// ₮10M ceiling on a delivery fee — generous but blocks typo/overflow values.
const MAX_DELIVERY_PRICE = 10_000_000;

/**
 * Validate + clamp a client-supplied deliveryOptions blob into the exact
 * 3-tier shape the schema expects. Tolerant by design: a missing or
 * malformed tier falls back to its platform default rather than 400-ing,
 * so a partial payload can never wipe a seller's existing config into an
 * invalid state. Returns null when the whole body is unusable.
 */
const sanitiseDeliveryOptions = (raw, existing = {}) => {
  if (!raw || typeof raw !== "object") return null;
  const out = {};
  let anyEnabled = false;
  for (const tier of DELIVERY_TIERS) {
    const base = existing[tier] || DELIVERY_DEFAULTS[tier];
    const r = raw[tier] || {};
    const unit = r.unit === "hour" ? "hour" : (r.unit === "day" ? "day" : base.unit || "day");
    // Per-unit sane ceiling: 720h (30d) for hours, 365d for days.
    const cap = unit === "hour" ? 720 : 365;
    let value = Number(r.value);
    if (!Number.isFinite(value)) value = base.value ?? DELIVERY_DEFAULTS[tier].value;
    value = Math.max(0, Math.min(cap, Math.round(value)));
    // Phase AV: seller-set delivery fee (MNT). Clamp 0..MAX, fall back to
    // the seller's existing price, then the platform default.
    let price = Number(r.price);
    if (!Number.isFinite(price)) price = base.price ?? DELIVERY_DEFAULTS[tier].price;
    price = Math.max(0, Math.min(MAX_DELIVERY_PRICE, Math.round(price)));
    const enabled = r.enabled === undefined ? (base.enabled !== false) : Boolean(r.enabled);
    if (enabled) anyEnabled = true;
    out[tier] = { enabled, value, unit, price };
  }
  // Guard against a seller disabling every tier — that would leave the
  // product page with an empty delivery selector. Re-enable "normal".
  if (!anyEnabled) out.normal.enabled = true;
  return out;
};

// ── Settings (inventory + notification + delivery preferences) ───
export const updateSettings = async (req, res) => {
  try {
    const sp = req.user.sellerProfile || {};
    const { defaultLowStockThreshold, emailAlertsEnabled, deliveryOptions } = req.body;
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
    if (deliveryOptions !== undefined) {
      const clean = sanitiseDeliveryOptions(deliveryOptions, sp.deliveryOptions);
      if (!clean) {
        return res.status(400).json({ message: "Хүргэлтийн тохиргоо буруу байна" });
      }
      sp.deliveryOptions = clean;
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
