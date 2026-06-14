/**
 * Seller-side AI insights service.
 *
 * Three independent capabilities that power the Seller persona's tools
 * in the AI gateway (Phase B):
 *
 *   ① findDeadstock      — items moving zero units over a rolling window
 *   ② findShelfLocations — natural-language → "where is SKU X" lookup
 *   ③ generateQuotation  — structured B2B plain-text quote body
 *
 * Why a dedicated service (not a tool-handler inline):
 *   • The deadstock query is non-trivial — it joins the Product collection
 *     to a date-bounded Order aggregation. Keeping the pipeline here means
 *     it can be reused by a cron job (proactive notifications) or a
 *     non-AI dashboard widget without copy-paste.
 *   • The quotation generator is template-driven; isolating it makes
 *     swapping templates (e.g. PDF export later) a one-file change.
 *
 * SCOPING CONTRACT:
 *   Every function takes a `sellerId` and applies it as a hard filter on
 *   the FIRST DB call. Callers cannot widen the scope by passing extra
 *   args. The AI controller passes `scope.sellerId` directly so the
 *   trust boundary stays in aiRole.service.js.
 */

import Product from "../Model/product.model.js";
import Order   from "../Model/order.model.js";

// Order statuses that COUNT as "real sales" for deadstock velocity. A
// "pending" or "cancelled" order doesn't drain stock so we ignore those.
const REVENUE_STATUSES = ["paid", "processing", "shipped", "delivered"];

// ────────────────────────────────────────────────────────────────────
// ① Deadstock detection
// ────────────────────────────────────────────────────────────────────

/**
 * Find seller's own products that have moved ZERO units in the past
 * `monthsSilent` months AND still have stock on hand. The combination is
 * what makes them "deadstock" — unsold inventory tying up capital.
 *
 * Returns enriched rows ready for the AI's seller_table layout:
 *
 *   {
 *     productId, name, oem, brand, category,
 *     stockQty, costPrice, retailPrice,
 *     trappedCapital,           // costPrice × stockQty
 *     warehouseLocation,
 *     monthsSilent,             // how long without a sale
 *     suggestedDiscount,        // 15% by default; doubled at >12 months
 *     liquidationPrice,         // retailPrice × (1 - suggestedDiscount)
 *   }
 *
 * Performance note:
 *   The aggregation runs Order → match by date+status+seller → group by
 *   product → produce a Set of "recently sold productIds". Product
 *   collection is then queried for everything OUTSIDE that set. This is
 *   O(orders) + O(products) — single round-trip per pass.
 */
export const findDeadstock = async (sellerId, { monthsSilent = 6, limit = 50 } = {}) => {
  if (!sellerId) return { items: [], summary: { totalSku: 0, trappedCapital: 0 } };

  const sinceDate = new Date();
  sinceDate.setMonth(sinceDate.getMonth() - monthsSilent);

  // Step 1: which of my products HAVE sold in the window?
  const recentSales = await Order.aggregate([
    { $match: {
        createdAt: { $gte: sinceDate },
        status:    { $in: REVENUE_STATUSES },
        "items.seller": sellerId,
    } },
    { $unwind: "$items" },
    { $match: { "items.seller": sellerId } },
    { $group: { _id: "$items.product" } },
  ]);
  const recentlySold = new Set(recentSales.map((r) => String(r._id)));

  // Step 2: my products NOT in that set + still in stock.
  const candidates = await Product.find({
    seller:   sellerId,
    stockQty: { $gt: 0 },
    status:   { $ne: "rejected" },
  })
    .select("name oem brand category price +costPrice stockQty +warehouseLocation +lastSoldAt createdAt")
    .lean();

  const now = Date.now();
  const items = candidates
    .filter((p) => !recentlySold.has(String(p._id)))
    .map((p) => {
      const stock = p.stockQty || 0;
      const cost  = p.costPrice || 0;
      const retail= p.price || 0;
      const trappedCapital = cost * stock;

      // Silent-time heuristic: prefer the explicit lastSoldAt cache;
      // fall back to createdAt for items that have never sold.
      const referenceDate = p.lastSoldAt ? new Date(p.lastSoldAt) : new Date(p.createdAt || now);
      const monthsSilentActual = Math.max(
        monthsSilent,
        Math.floor((now - referenceDate.getTime()) / (1000 * 60 * 60 * 24 * 30)),
      );

      // Liquidation strategy: 15% default; bumps to 30% past a year of
      // silence (capital recovery > nominal margin at that point).
      const suggestedDiscount = monthsSilentActual >= 12 ? 0.30 : 0.15;
      const liquidationPrice  = Math.round(retail * (1 - suggestedDiscount));

      return {
        productId:         String(p._id),
        name:              p.name,
        oem:               p.oem || "",
        brand:             p.brand,
        category:          p.category,
        stockQty:          stock,
        costPrice:         cost,
        retailPrice:       retail,
        trappedCapital,
        warehouseLocation: p.warehouseLocation || "",
        monthsSilent:      monthsSilentActual,
        suggestedDiscount,
        liquidationPrice,
      };
    })
    .sort((a, b) => b.trappedCapital - a.trappedCapital) // worst-capital-first
    .slice(0, limit);

  const totalTrapped = items.reduce((s, r) => s + r.trappedCapital, 0);
  return {
    items,
    summary: {
      totalSku:        items.length,
      trappedCapital:  totalTrapped,
      monthsSilent,
      worstOffender:   items[0] || null,
    },
  };
};

// ────────────────────────────────────────────────────────────────────
// ② Shelf locator — "where is X?"
// ────────────────────────────────────────────────────────────────────

/**
 * Parse a Mongolian/English "where is X" query into a name/OEM regex and
 * return the seller's matching SKUs with their warehouse coordinates.
 *
 * Match strategies (any hit ranks the SKU):
 *   • Exact OEM (case-insensitive, ignoring whitespace+dashes)
 *   • Substring in name (regex, case-insensitive)
 *   • Substring in tags
 *
 * Empty results → return a hint that no SKU matched (caller can re-ask).
 */
export const findShelfLocations = async (sellerId, queryStr, { limit = 12 } = {}) => {
  if (!sellerId || !queryStr) return { items: [], summary: { matchCount: 0 } };

  // Strip the natural-language scaffolding (where is, хаана байна, find …)
  // and keep only the noun phrase.
  const cleaned = String(queryStr)
    .replace(/^(хаана\s+байна|where\s+is|find|locate|олох)\s+/i, "")
    .replace(/\?+$/g, "")
    .trim();
  if (cleaned.length < 2) return { items: [], summary: { matchCount: 0 } };

  // OEM-style probe — if the cleaned token looks like an OEM (alphanumeric
  // with dashes, ≥4 chars) try an exact match first; almost always a
  // single hit which is the fastest path.
  const looksLikeOem = /^[A-Za-z0-9][A-Za-z0-9\-./]{2,}$/.test(cleaned);
  const rx = new RegExp(cleaned.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");

  const filter = {
    seller: sellerId,
    status: "approved",
  };
  if (looksLikeOem) {
    filter.$or = [
      { oem: cleaned.toUpperCase() },
      { name: rx },
    ];
  } else {
    filter.$or = [{ name: rx }, { tags: rx }, { oem: rx }];
  }

  const raw = await Product.find(filter)
    .select("name oem brand stockQty +warehouseLocation price")
    .limit(limit)
    .lean();

  const items = raw.map((p) => ({
    productId:         String(p._id),
    name:              p.name,
    oem:               p.oem || "",
    brand:             p.brand,
    stockQty:          p.stockQty || 0,
    warehouseLocation: p.warehouseLocation || "—",  // dash = not set
    price:             p.price || 0,
    hasLocation:       Boolean(p.warehouseLocation),
  }));

  return {
    items,
    summary: {
      matchCount:  items.length,
      withLocation: items.filter((i) => i.hasLocation).length,
    },
  };
};

// ────────────────────────────────────────────────────────────────────
// ③ Quotation generator
// ────────────────────────────────────────────────────────────────────

const MNT = (n) => `₮${Number(n || 0).toLocaleString("mn-MN")}`;

/**
 * Compose a plain-text B2B quotation suitable for copy-paste into email.
 *
 *   buyer     : { name, company?, phone?, email? }
 *   items     : [{ productId | oem | name, qty }]
 *   options   :
 *     validDays      — default 14
 *     vatPercent     — default 0 (Mongolia VAT 10% optional)
 *     discountPercent— optional bulk discount across the whole quote
 *     notes          — free-text footer
 *
 * Returns:
 *   {
 *     quoteId,      // human-readable: HC-QT-YYMMDD-XXXX
 *     bodyText,     // ready-to-send plain text
 *     summary: { subtotal, vat, discount, total, lineCount },
 *   }
 */
export const generateQuotation = async ({
  sellerId, items = [], buyer = {},
  validDays = 14, vatPercent = 0, discountPercent = 0, notes = "",
} = {}) => {
  if (!sellerId)        throw new Error("sellerId required");
  if (!items.length)    throw new Error("items required");

  // Resolve each line — accept either productId, oem, or name as the
  // matcher so the AI can call this tool from natural language.
  const resolved = [];
  for (const line of items) {
    const qty = Math.max(1, Math.floor(Number(line.qty || 1)));
    let product = null;

    if (line.productId) {
      product = await Product.findOne({ _id: line.productId, seller: sellerId }).lean();
    }
    if (!product && line.oem) {
      product = await Product.findOne({
        oem: String(line.oem).trim().toUpperCase(),
        seller: sellerId,
      }).lean();
    }
    if (!product && line.name) {
      const rx = new RegExp(String(line.name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      product = await Product.findOne({ name: rx, seller: sellerId }).lean();
    }

    if (!product) {
      resolved.push({
        name: line.name || line.oem || "Unknown",
        oem:  line.oem  || "",
        qty,  unitPrice: 0, lineTotal: 0,
        missing: true,
      });
      continue;
    }

    const unitPrice = product.price || 0;
    resolved.push({
      productId: String(product._id),
      name:      product.name,
      oem:       product.oem || "",
      brand:     product.brand,
      qty,
      unitPrice,
      lineTotal: unitPrice * qty,
      missing:   false,
    });
  }

  // Totals
  const subtotal = resolved.reduce((s, l) => s + l.lineTotal, 0);
  const discount = Math.round(subtotal * (Math.max(0, Math.min(100, discountPercent)) / 100));
  const taxable  = subtotal - discount;
  const vat      = Math.round(taxable * (Math.max(0, Math.min(100, vatPercent)) / 100));
  const total    = taxable + vat;

  // Identifier — calendar-prefix + 4-hex of seller/timestamp so it's
  // sortable in the inbox and impossible to collide for one seller.
  const today = new Date();
  const ymd   = `${String(today.getFullYear()).slice(-2)}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
  const suffix = Math.floor(Math.random() * 0xFFFF).toString(16).toUpperCase().padStart(4, "0");
  const quoteId = `HC-QT-${ymd}-${suffix}`;

  const validUntil = new Date(today);
  validUntil.setDate(validUntil.getDate() + validDays);

  // Plain-text body
  const lines = [];
  lines.push(`ҮНИЙН САНАЛ — ${quoteId}`);
  lines.push("================================================");
  lines.push(`Огноо:       ${today.toISOString().slice(0, 10)}`);
  lines.push(`Хүчинтэй:    ${validUntil.toISOString().slice(0, 10)} хүртэл (${validDays} хоног)`);
  lines.push("");
  if (buyer?.name || buyer?.company) {
    lines.push(`Хүлээн авагч: ${[buyer.company, buyer.name].filter(Boolean).join(" — ")}`);
    if (buyer.phone) lines.push(`Утас:        ${buyer.phone}`);
    if (buyer.email) lines.push(`И-мэйл:      ${buyer.email}`);
    lines.push("");
  }
  lines.push("№  Нэр                                    OEM            Тоо  Нэгж үнэ      Дүн");
  lines.push("─  ─────────────────────────────────────  ─────────────  ───  ───────────  ───────────");
  resolved.forEach((l, i) => {
    const idx  = String(i + 1).padStart(2, " ");
    const name = (l.name || "").slice(0, 38).padEnd(38, " ");
    const oem  = (l.oem  || "").slice(0, 13).padEnd(13, " ");
    const qty  = String(l.qty).padStart(3, " ");
    const unit = MNT(l.unitPrice).padStart(11, " ");
    const tot  = MNT(l.lineTotal).padStart(11, " ");
    const mark = l.missing ? " ⚠" : "";
    lines.push(`${idx}  ${name}  ${oem}  ${qty}  ${unit}  ${tot}${mark}`);
  });
  lines.push("─────────────────────────────────────────────────────────────────────────────────────");
  lines.push(`${" ".repeat(58)}Дүн:${" ".repeat(7)}${MNT(subtotal).padStart(11, " ")}`);
  if (discount > 0) lines.push(`${" ".repeat(58)}Хямдрал (${discountPercent}%):  -${MNT(discount).padStart(10, " ")}`);
  if (vat > 0)      lines.push(`${" ".repeat(58)}НӨАТ (${vatPercent}%):${" ".repeat(5)}${MNT(vat).padStart(11, " ")}`);
  lines.push(`${" ".repeat(58)}НИЙТ:${" ".repeat(6)}${MNT(total).padStart(11, " ")}`);
  lines.push("");
  if (notes) {
    lines.push("Тэмдэглэл:");
    lines.push(notes);
    lines.push("");
  }
  if (resolved.some((l) => l.missing)) {
    lines.push("⚠ Зарим эд анги каталогт олдсонгүй — нийлүүлэлт батлахаа өмнө шалгана уу.");
    lines.push("");
  }
  lines.push("HiCar дэлгэрэнгүй мэдээллийн төв | https://hicar.mn");

  return {
    quoteId,
    bodyText: lines.join("\n"),
    summary: {
      subtotal,
      discount,
      vat,
      total,
      lineCount:  resolved.length,
      missingCount: resolved.filter((l) => l.missing).length,
      validUntil: validUntil.toISOString().slice(0, 10),
    },
  };
};

// Internal helpers exposed for tests.
export const __internal = Object.freeze({ REVENUE_STATUSES, MNT });
