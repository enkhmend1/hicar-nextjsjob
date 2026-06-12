import Product from "../Model/product.model.js";
import { cacheGet, cacheSet, cacheInvalidate } from "../Config/redis.js";
import { notify, notifyAdmins } from "../Service/notification.service.js";
import { logSearch } from "../Service/oem.service.js";
import { maybeAlertLowStock } from "../Service/inventory.service.js";
import { resolveCompatibility } from "../Service/compatibilityResolver.service.js";
import { getCategoryWithDescendants, bustCategoryCounts } from "../Service/siteContent.service.js";
import { rememberInputs } from "./seller.controller.js";
import {
  validateProductCreate,
  validateProductUpdate,
  flattenZodErrors,
} from "../Service/productSchema.service.js";

const normalizeProductInput = (body) => {
  const out = { ...body };
  if (typeof out.category === "string") out.category = out.category.trim().toLowerCase();
  if (typeof out.brand    === "string") out.brand    = out.brand.trim();
  if (typeof out.source   === "string") out.source   = out.source.trim();
  if (typeof out.oem      === "string") out.oem      = out.oem.trim();
  if (Array.isArray(out.tags)) {
    out.tags = [...new Set(out.tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean))].slice(0, 20);
  }
  if (typeof out.lowStockThreshold !== "undefined" && out.lowStockThreshold !== "") {
    out.lowStockThreshold = Math.max(-1, Math.min(1000, Number(out.lowStockThreshold)));
  } else {
    delete out.lowStockThreshold; // keep schema default
  }
  return out;
};

const SORT_MAP = {
  price_asc: { price: 1 },
  price_desc: { price: -1 },
  name: { name: 1 },
  newest: { createdAt: -1 },
};

const buildFilter = (query) => {
  // Phase T: extended filter set for the senior shop sidebar.
  //   category/source/seller/q  — existing
  //   priceMin/priceMax         — inclusive Mongo range, numeric coerced
  //   brand                     — exact match (case-insensitive)
  //   inStock=true              — drop sold-out products
  //   minRating=4               — drop products rated < threshold
  // All filters are best-effort: malformed values silently skip rather
  // than 400-ing, so a fat-fingered URL param doesn't break browsing.
  const { q, category, source, seller, priceMin, priceMax, brand, inStock, minRating } = query;
  const f = {};
  if (category && category !== "all") f.category = category;
  if (source && source !== "all") f.source = source;
  if (seller) f.seller = seller;
  if (q) {
    const rx = new RegExp(q, "i");
    f.$or = [{ name: rx }, { oem: rx }, { brand: rx }];
  }

  const min = Number(priceMin);
  const max = Number(priceMax);
  if (Number.isFinite(min) || Number.isFinite(max)) {
    f.price = {};
    if (Number.isFinite(min)) f.price.$gte = min;
    if (Number.isFinite(max)) f.price.$lte = max;
  }

  // Vehicle-tree browse (B2B roadmap #1): match structured fitments.
  // fitMake/fitModel are case-insensitive exact; fitYear must fall inside
  // [yearStart, yearEnd] — открытые ends pass. All best-effort like the rest.
  const { fitMake, fitModel, fitYear } = query;
  if (fitMake && String(fitMake).trim()) {
    const esc = (v) => String(v).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const elem = { make: new RegExp(`^${esc(fitMake)}$`, "i") };
    if (fitModel && String(fitModel).trim()) {
      elem.model = new RegExp(`^${esc(fitModel)}$`, "i");
    }
    const yr = Number(fitYear);
    if (Number.isFinite(yr) && yr > 1900 && yr < 2100) {
      elem.$and = [
        { $or: [{ yearStart: { $exists: false } }, { yearStart: null }, { yearStart: { $lte: yr } }] },
        { $or: [{ yearEnd:   { $exists: false } }, { yearEnd:   null }, { yearEnd:   { $gte: yr } }] },
      ];
    }
    f.fitments = { $elemMatch: elem };
  }

  if (brand && String(brand).trim()) {
    // Exact brand match, case-insensitive. Sellers occasionally vary
    // casing ("Toyota" vs "toyota") so anchor the regex.
    f.brand = new RegExp(`^${String(brand).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
  }

  if (String(inStock).toLowerCase() === "true") {
    f.inStock = true;
  }

  const ratingFloor = Number(minRating);
  if (Number.isFinite(ratingFloor) && ratingFloor > 0) {
    f.rating = { $gte: ratingFloor };
  }

  // Phase X.1: exclude one or more product ids from the result.
  // Used by the product-detail "More from this seller" + "Related
  // products" sections so the current product itself doesn't appear
  // in its own related list. Accepts:
  //   excludeId=<id>           — single id
  //   excludeId=<id>,<id>      — comma-separated CSV
  // Ignored when the values aren't valid ObjectIds (avoids 500s on
  // malformed URLs; just no-op filters the bad ones out).
  const { excludeId } = query;
  if (excludeId) {
    const raw = Array.isArray(excludeId) ? excludeId.join(",") : String(excludeId);
    const ids = raw.split(",").map((s) => s.trim()).filter(Boolean);
    if (ids.length > 0) {
      // ObjectId() throws on malformed input — wrap each so a single
      // bad id doesn't poison the whole array.
      const valid = [];
      for (const id of ids) {
        if (/^[a-f0-9]{24}$/i.test(id)) valid.push(id);
      }
      if (valid.length > 0) {
        f._id = { $nin: valid };
      }
    }
  }

  return f;
};

/**
 * Expand a parent category filter to include all of its descendant
 * categories. Products live on LEAF ids, so opening the shop on a top-level
 * category ("engine") with a flat equality match would return nothing. We
 * swap the equality for a single indexed `$in` over [parent, ...descendants],
 * resolved from the cached category tree (no per-request DB read). Mutates
 * `filter` in place; a no-op for "all" / leaf / unknown categories.
 */
const expandCategoryFilter = async (filter, category) => {
  if (!category || category === "all") return;
  const ids = await getCategoryWithDescendants(category);
  if (ids.length > 1) filter.category = { $in: ids };
};

/** PUBLIC: only approved products visible. Cached. */
export const listProducts = async (req, res) => {
  try {
    const cacheKey = `products:list:${JSON.stringify(req.query)}`;
    const cached = await cacheGet(cacheKey);
    if (cached) return res.json(cached);

    const { sort, limit } = req.query;
    const filter = { ...buildFilter(req.query), status: "approved" };
    // Parent category → include all sub-category products in one query.
    await expandCategoryFilter(filter, req.query.category);
    let query = Product.find(filter)
      .populate("seller", "name sellerProfile.shopName sellerProfile.rating")
      .sort(SORT_MAP[sort] || { createdAt: -1 });
    if (limit) query = query.limit(Number(limit));
    const items = await query;
    const payload = { items, total: items.length };
    await cacheSet(cacheKey, payload);

    // Log user-initiated text queries for the AI training surface
    if (req.query.q && String(req.query.q).trim()) {
      logSearch({
        query: String(req.query.q),
        category: req.query.category && req.query.category !== "all" ? req.query.category : "",
        resultCount: items.length,
        source: "shop",
      }).catch(() => {});
    }
    return res.json(payload);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * PUBLIC: make → model tree with product counts for the vehicle-browse
 * filter. Aggregated from approved products' structured fitments.
 * Cached under products:* so any catalogue mutation busts it.
 */
export const fitmentTree = async (_req, res) => {
  try {
    const cacheKey = "products:fitment-tree";
    const cached = await cacheGet(cacheKey);
    if (cached) return res.json(cached);

    const rows = await Product.aggregate([
      { $match: { status: "approved", "fitments.0": { $exists: true } } },
      { $unwind: "$fitments" },
      { $group: {
        _id: { make: { $toLower: "$fitments.make" }, model: { $toLower: "$fitments.model" } },
        make:  { $first: "$fitments.make" },
        model: { $first: "$fitments.model" },
        count: { $sum: 1 },
      } },
      { $sort: { count: -1 } },
    ]);

    const byMake = new Map();
    for (const r of rows) {
      const k = r._id.make;
      if (!byMake.has(k)) byMake.set(k, { make: r.make, count: 0, models: [] });
      const m = byMake.get(k);
      m.count += r.count;
      m.models.push({ model: r.model, count: r.count });
    }
    const payload = { tree: [...byMake.values()].sort((a, b) => b.count - a.count) };
    await cacheSet(cacheKey, payload);
    return res.json(payload);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// Bust the product-list cache AND the homepage category-counts cache —
// adding/removing/moderating a product changes per-category counts.
const invalidateProductCache = () => {
  cacheInvalidate("products:*");
  bustCategoryCounts();
};

/** SELLER: own products including pending/rejected. */
export const listMyProducts = async (req, res) => {
  try {
    const items = await Product.find({ seller: req.user._id })
      .sort({ createdAt: -1 });
    return res.json({ items });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/** ADMIN: all products with optional status filter. */
export const listAllProducts = async (req, res) => {
  try {
    const { status, sort, limit } = req.query;
    const filter = buildFilter(req.query);
    if (status && status !== "all") filter.status = status;
    let query = Product.find(filter)
      .populate("seller", "name email sellerProfile.shopName")
      .sort(SORT_MAP[sort] || { createdAt: -1 });
    if (limit) query = query.limit(Number(limit));
    const items = await query;
    return res.json({ items, total: items.length });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

export const getProduct = async (req, res) => {
  try {
    const item = await Product.findById(req.params.id)
      // Phase R.1: include sellerProfile.logo so the cart + product
      // detail can render the seller avatar without a second round-trip.
      // Phase AU: include sellerProfile.deliveryOptions so the detail
      // page shows the seller's OWN delivery durations (hours/days).
      .populate("seller", "name sellerProfile.shopName sellerProfile.logo sellerProfile.rating sellerProfile.ratingCount sellerProfile.deliveryOptions");
    if (!item) return res.status(404).json({ message: "Бараа олдсонгүй" });
    // Hide unapproved products from non-owner non-admin
    if (item.status !== "approved") {
      const isOwner = req.user && item.seller && String(item.seller._id) === String(req.user._id);
      const isAdmin = req.user?.role === "admin";
      if (!isOwner && !isAdmin) {
        return res.status(404).json({ message: "Бараа олдсонгүй" });
      }
    }
    return res.json({ item });
  } catch (err) {
    return res.status(400).json({ message: "ID буруу" });
  }
};

/**
 * Create a new product.
 *
 * INSTANT-PUBLISH POLICY (Phase 1):
 *   • Seller-created products go LIVE immediately (`status = "approved"`).
 *   • Quality control is enforced downstream via:
 *       a) Customer-facing reviews + ratings
 *       b) Dispute / refund flow (escrow holds payment)
 *       c) Admin's full-override controls (edit / disable / delete)
 *   • Admin still has the manual moderation panel for spot-checks via
 *     `PATCH /products/:id/moderate` (status → "rejected"), but it's no
 *     longer in the critical path of seller velocity.
 */
export const createProduct = async (req, res) => {
  try {
    const { seller: _s, status: _st, rejectedReason: _r, ...body } = req.body;
    const normalised = normalizeProductInput(body);

    // ── Dynamic, category-aware validation ──────────────────────────
    // validateProductCreate is async because it reads the category's
    // attribute-schema definitions from SiteContent at request time:
    //   ① Admin-edited dynamic schemas in SiteContent.categories[].attributesSchema
    //   ② Legacy hardcoded STATIC_CATEGORY_SCHEMAS (body/oils/brake/engine/electric)
    //   ③ Free record (no rules registered)
    // The Zod layer enforces:
    //   • all required base fields are present (name/brand/category/price/...)
    //   • fitments[] rows are coherent (yearStart ≤ yearEnd)
    //   • category-specific attributes match the resolved schema
    const parsed = await validateProductCreate(normalised);
    if (!parsed.success) {
      return res.status(400).json({
        code: "VALIDATION_FAILED",
        message: "Барааны мэдээлэл шалгалт давсангүй",
        errors: flattenZodErrors(parsed.error),
      });
    }
    const payload = parsed.data;

    if (req.user.role === "admin") {
      payload.seller = null;
    } else {
      payload.seller = req.user._id;
    }
    // Instant publish for every role — see policy block above
    payload.status = "approved";
    // Derive the structured compatibility block from the seller's fitments +
    // OEM so the compatibility engine can match this part to a buyer's car by
    // manufacturer / model / engine ref — not only an exact OEM hit.
    payload.compatibility = await resolveCompatibility({ fitments: payload.fitments, oem: payload.oem });
    const item = await Product.create(payload);
    invalidateProductCache();

    // Remember free-text inputs for this seller's autocomplete history
    if (req.user.role === "seller") {
      rememberInputs(req.user._id, {
        source: item.source, category: item.category, brand: item.brand, tags: item.tags,
      }).catch(() => {});
    }

    // Inform admins about new seller-uploaded items so they can spot-check —
    // but DO NOT block publication on this.
    if (req.user.role !== "admin") {
      notifyAdmins({
        type: "product_pending",   // notification type kept for backwards-compat with bell UI
        title: "Шинэ бараа нийтлэгдлээ",
        body: `${req.user.sellerProfile?.shopName || req.user.name} — "${item.name}" (admin override-аар хариуцлагатай)`,
        link: "/admin/products",
        data: { productId: String(item._id) },
      });
    }
    return res.status(201).json({ item });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

export const updateProduct = async (req, res) => {
  try {
    const existing = await Product.findById(req.params.id);
    if (!existing) return res.status(404).json({ message: "Бараа олдсонгүй" });

    const isOwner = existing.seller && String(existing.seller) === String(req.user._id);
    const isAdmin = req.user.role === "admin";
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ message: "Энэ барааг засах эрхгүй" });
    }

    const { seller, status, rejectedReason, ...body } = req.body;
    const normalised = normalizeProductInput(body);

    // ── Partial-update validation ──────────────────────────────────
    // When the client sends only a few fields (e.g. just `price` or
    // `stockQty`), every base field is optional. But if `attributes`
    // is touched, we cross-validate against the category (either the
    // body's explicit `category` or the existing product's — passed as
    // fallbackCategory so the resolver can look up the right schema).
    const parsed = await validateProductUpdate(normalised, existing.category);
    if (!parsed.success) {
      return res.status(400).json({
        code: "VALIDATION_FAILED",
        message: "Барааны мэдээлэл шалгалт давсангүй",
        errors: flattenZodErrors(parsed.error),
      });
    }
    const update = parsed.data;
    if (isAdmin) {
      if (status !== undefined) update.status = status;
      if (rejectedReason !== undefined) update.rejectedReason = rejectedReason;
      if (seller !== undefined) update.seller = seller;
    }
    // Instant-publish policy: seller edits never bounce back to "pending".
    // Listings stay live; admin moderates only on demand (edit/disable/delete).

    // Re-derive structured compatibility only when fitments or OEM changed,
    // so a partial edit (e.g. just price) never wipes the existing block.
    if (update.fitments !== undefined || update.oem !== undefined) {
      update.compatibility = await resolveCompatibility({
        fitments: update.fitments ?? existing.fitments ?? [],
        oem:      update.oem ?? existing.oem ?? "",
      });
    }

    const item = await Product.findByIdAndUpdate(req.params.id, update, {
      returnDocument: "after", runValidators: true,
    });
    invalidateProductCache();

    if (req.user.role === "seller" && item) {
      rememberInputs(req.user._id, {
        source: item.source, category: item.category, brand: item.brand, tags: item.tags,
      }).catch(() => {});
    }

    // If the threshold was changed, immediately re-evaluate for an alert
    if (Object.prototype.hasOwnProperty.call(update, "lowStockThreshold") ||
        Object.prototype.hasOwnProperty.call(update, "stockQty")) {
      maybeAlertLowStock(item._id).catch(() => {});
    }
    return res.json({ item });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

export const deleteProduct = async (req, res) => {
  try {
    const existing = await Product.findById(req.params.id);
    if (!existing) return res.status(404).json({ message: "Бараа олдсонгүй" });
    const isOwner = existing.seller && String(existing.seller) === String(req.user._id);
    if (!isOwner && req.user.role !== "admin") {
      return res.status(403).json({ message: "Энэ барааг устгах эрхгүй" });
    }
    await existing.deleteOne();
    invalidateProductCache();
    return res.json({ ok: true });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

/** Admin-only: approve / reject a pending product. */
export const moderateProduct = async (req, res) => {
  try {
    const { action, reason } = req.body;
    if (!["approve", "reject"].includes(action)) {
      return res.status(400).json({ message: "action: approve | reject" });
    }
    const update = action === "approve"
      ? { status: "approved", rejectedReason: "" }
      : { status: "rejected", rejectedReason: reason || "" };
    const item = await Product.findByIdAndUpdate(req.params.id, update, { returnDocument: "after" });
    if (!item) return res.status(404).json({ message: "Бараа олдсонгүй" });
    invalidateProductCache();
    if (item.seller) {
      notify({
        user: item.seller,
        type: action === "approve" ? "product_approved" : "product_rejected",
        title: action === "approve" ? "Бараа зөвшөөрөгдлөө ✓" : "Бараа татгалзагдсан",
        body: `"${item.name}"${action === "reject" && reason ? ` — ${reason}` : ""}`,
        link: "/seller/products",
        data: { productId: String(item._id) },
        email: true,
      });
    }
    return res.json({ item });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

export const getCategories = async (_req, res) => {
  try {
    const rows = await Product.aggregate([
      { $match: { status: "approved" } },
      { $group: { _id: "$category", count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]);
    return res.json({ categories: rows.map((r) => ({ id: r._id, count: r.count })) });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};
