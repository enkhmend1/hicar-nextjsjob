import Rfq from "../Model/rfq.model.js";
import Product from "../Model/product.model.js";
import { enqueue } from "../Service/notificationOutbox.service.js";

/**
 * RFQ controller — Request For Quotation (B2B roadmap #4).
 *
 * A buyer asks a seller for a custom unit price on a product + quantity.
 * The seller answers with a unit price valid until a date; the buyer
 * accepts and the negotiated unit is applied SERVER-SIDE at order create
 * (order.controller.js reads the RFQ — the client never supplies a price).
 *
 * Authz model:
 *   • buyer endpoints  — `protect`, ownership = rfq.buyer === req.user._id
 *   • seller endpoints — `protect` + `approvedSeller`, ownership = rfq.seller
 * Every handler 404s on a missing RFQ and 403s on an ownership mismatch.
 *
 * Notifications go through the outbox `enqueue` (durable retry), using the
 * new "rfq_*" notification types. Failures are swallowed (.catch) so a
 * transient notification error never fails the RFQ mutation itself.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_QUOTE_VALID_DAYS = 7;

/** Short, readable price for Mongolian notification bodies. */
const fmtMnt = (n) => `₮${Number(n || 0).toLocaleString()}`;

/* ──────────────────────────────────────────────────────────────────────
 * Buyer — create
 * ────────────────────────────────────────────────────────────────────── */

/**
 * POST /api/rfq   (buyer, protect)
 * Body: { product, qty, message? }
 *
 * Loads the product, refuses the buyer's own listing and house-brand
 * (sellerless) products, snapshots the product, then creates a pending
 * RFQ and notifies the seller.
 */
export const createRfq = async (req, res) => {
  try {
    const { product: productId, qty, message } = req.body || {};
    if (!productId) {
      return res.status(400).json({ message: "Бараа заагдаагүй байна" });
    }

    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ message: "Бараа олдсонгүй" });
    }

    const sellerId = product.seller;
    if (!sellerId) {
      return res.status(400).json({ message: "Энэ бараанд үнийн санал авах боломжгүй" });
    }
    // A seller can't request a quote on their own listing.
    if (String(sellerId) === String(req.user._id)) {
      return res.status(400).json({ message: "Өөрийн бараанд үнийн санал авах боломжгүй" });
    }

    const quantity = Math.max(1, Math.floor(Number(qty) || 0));
    if (quantity < 1) {
      return res.status(400).json({ message: "Тоо ширхэг дор хаяж 1 байх ёстой" });
    }

    // One active inquiry per product per buyer — a pending/quoted RFQ is an
    // open negotiation thread (Alibaba model). Block duplicates so the
    // seller's inbox doesn't fill with repeats; declined/cancelled/accepted
    // are settled, so a fresh request after those is allowed.
    const existingActive = await Rfq.findOne({
      buyer: req.user._id,
      product: product._id,
      status: { $in: ["pending", "quoted"] },
    });
    if (existingActive) {
      return res.status(409).json({
        message: "Энэ бараанд таны идэвхтэй үнийн санал хүсэлт байна. 'Миний үнийн саналууд' хэсгээс үзнэ үү.",
        rfqId: String(existingActive._id),
      });
    }

    const rfq = await Rfq.create({
      buyer: req.user._id,
      seller: sellerId,
      product: product._id,
      productSnapshot: {
        name: product.name || "",
        oem: product.oem || "",
        sku: product.sku || "",
        image: Array.isArray(product.images) ? (product.images[0] || "") : "",
        basePrice: product.price || 0,
      },
      qty: quantity,
      message: typeof message === "string" ? message.trim().slice(0, 1000) : "",
      status: "pending",
    });

    enqueue({
      user: sellerId,
      type: "rfq_received",
      title: "Шинэ үнийн санал хүсэлт",
      body: `"${rfq.productSnapshot.name}" × ${quantity} ширхэгт үнийн санал хүслээ.`,
      link: "/seller/rfq",
      data: { rfqId: String(rfq._id), productId: String(product._id) },
    }).catch(() => {});

    return res.status(201).json({ rfq });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

/* ──────────────────────────────────────────────────────────────────────
 * Buyer — list mine
 * ────────────────────────────────────────────────────────────────────── */

/**
 * GET /api/rfq/mine?status=   (buyer, protect)
 * RFQs the current user sent, newest first.
 */
export const listMyRfqs = async (req, res) => {
  try {
    const filter = { buyer: req.user._id };
    if (req.query.status) filter.status = req.query.status;
    const rfqs = await Rfq.find(filter)
      .sort({ createdAt: -1 })
      .limit(200)
      .populate("product", "name images price")
      // Seller delivery config so the RFQ checkout shows the SAME delivery
      // fee the server will charge (no surprise at payment).
      .populate("seller", "sellerProfile.shopName sellerProfile.deliveryOptions");
    return res.json({ rfqs });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/* ──────────────────────────────────────────────────────────────────────
 * Seller — list incoming
 * ────────────────────────────────────────────────────────────────────── */

/**
 * GET /api/rfq/seller?status=   (protect + approvedSeller)
 * RFQs addressed to the current seller, newest first.
 */
export const listSellerRfqs = async (req, res) => {
  try {
    const filter = { seller: req.user._id };
    if (req.query.status) filter.status = req.query.status;
    const rfqs = await Rfq.find(filter)
      .sort({ createdAt: -1 })
      .limit(200)
      .populate("buyer", "name")
      .populate("product", "name images price");
    return res.json({ rfqs });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/* ──────────────────────────────────────────────────────────────────────
 * Seller — quote
 * ────────────────────────────────────────────────────────────────────── */

/**
 * PATCH /api/rfq/:id/quote   (protect + approvedSeller)
 * Body: { unitPrice, note?, validUntil? }
 *
 * The seller answers a pending|quoted RFQ with an integer MNT unit price
 * and an expiry (defaults to +7 days). Re-quoting an already-quoted RFQ
 * is allowed (price negotiation), which is why "quoted" is accepted too.
 */
export const quoteRfq = async (req, res) => {
  try {
    const { unitPrice, note, validUntil } = req.body || {};

    const rfq = await Rfq.findById(req.params.id);
    if (!rfq) return res.status(404).json({ message: "Үнийн санал олдсонгүй" });
    if (String(rfq.seller) !== String(req.user._id)) {
      return res.status(403).json({ message: "Энэ үнийн санал таных биш" });
    }
    if (!["pending", "quoted"].includes(rfq.status)) {
      return res.status(400).json({ message: "Энэ үнийн саналд хариу өгөх боломжгүй" });
    }

    // Integer MNT only — no decimals, never trust a client-supplied float.
    const price = Math.floor(Number(unitPrice));
    if (!Number.isFinite(price) || price < 1) {
      return res.status(400).json({ message: "Үнэ дор хаяж ₮1 (бүхэл тоо) байх ёстой" });
    }

    // validUntil must be in the future. Default to +7 days when absent.
    let validUntilDate;
    if (validUntil) {
      validUntilDate = new Date(validUntil);
      if (Number.isNaN(validUntilDate.getTime())) {
        return res.status(400).json({ message: "Хүчинтэй хугацаа буруу форматтай байна" });
      }
      if (validUntilDate.getTime() <= Date.now()) {
        return res.status(400).json({ message: "Хүчинтэй хугацаа ирээдүйд байх ёстой" });
      }
    } else {
      validUntilDate = new Date(Date.now() + DEFAULT_QUOTE_VALID_DAYS * DAY_MS);
    }

    const now = new Date();
    const updated = await Rfq.findOneAndUpdate(
      { _id: rfq._id },
      {
        $set: {
          "quote.unitPrice": price,
          "quote.note": typeof note === "string" ? note.trim().slice(0, 500) : "",
          "quote.validUntil": validUntilDate,
          "quote.quotedAt": now,
          status: "quoted",
          respondedAt: now,
        },
      },
      { returnDocument: "after" },
    );

    enqueue({
      user: updated.buyer,
      type: "rfq_quoted",
      title: "Үнийн санал ирлээ",
      body: `"${updated.productSnapshot.name}" — нэгж үнэ ${fmtMnt(price)}.`,
      link: "/rfq",
      data: { rfqId: String(updated._id), unitPrice: price },
    }).catch(() => {});

    return res.json({ rfq: updated });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

/* ──────────────────────────────────────────────────────────────────────
 * Seller — decline
 * ────────────────────────────────────────────────────────────────────── */

/**
 * PATCH /api/rfq/:id/decline   (protect + approvedSeller)
 * The seller refuses a pending|quoted RFQ.
 */
export const declineRfq = async (req, res) => {
  try {
    const rfq = await Rfq.findById(req.params.id);
    if (!rfq) return res.status(404).json({ message: "Үнийн санал олдсонгүй" });
    if (String(rfq.seller) !== String(req.user._id)) {
      return res.status(403).json({ message: "Энэ үнийн санал таных биш" });
    }
    if (!["pending", "quoted"].includes(rfq.status)) {
      return res.status(400).json({ message: "Энэ үнийн саналыг татгалзах боломжгүй" });
    }

    rfq.status = "declined";
    rfq.respondedAt = new Date();
    await rfq.save();

    enqueue({
      user: rfq.buyer,
      type: "rfq_declined",
      title: "Үнийн санал татгалзлаа",
      body: `"${rfq.productSnapshot.name}" барааны үнийн саналыг худалдагч татгалзлаа.`,
      link: "/rfq",
      data: { rfqId: String(rfq._id) },
    }).catch(() => {});

    return res.json({ rfq });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

/* ──────────────────────────────────────────────────────────────────────
 * Buyer — accept
 * ────────────────────────────────────────────────────────────────────── */

/**
 * PATCH /api/rfq/:id/accept   (buyer, protect)
 * Locks in a quoted RFQ. The quote must not have expired. Once accepted
 * the buyer can order at the negotiated price (order.controller enforces
 * single-use via the rfq.order link).
 */
export const acceptRfq = async (req, res) => {
  try {
    const rfq = await Rfq.findById(req.params.id);
    if (!rfq) return res.status(404).json({ message: "Үнийн санал олдсонгүй" });
    if (String(rfq.buyer) !== String(req.user._id)) {
      return res.status(403).json({ message: "Энэ үнийн санал таных биш" });
    }
    if (rfq.status !== "quoted") {
      return res.status(400).json({ message: "Зөвхөн саналласан үнийг хүлээн авах боломжтой" });
    }
    if (!rfq.quote?.validUntil || new Date(rfq.quote.validUntil).getTime() <= Date.now()) {
      return res.status(400).json({ message: "Үнийн саналын хугацаа дууссан" });
    }

    rfq.status = "accepted";
    rfq.acceptedAt = new Date();
    await rfq.save();

    enqueue({
      user: rfq.seller,
      type: "rfq_accepted",
      title: "Үнийн санал хүлээн авлаа",
      body: `"${rfq.productSnapshot.name}" — худалдан авагч ${fmtMnt(rfq.quote.unitPrice)} үнийг хүлээн авлаа.`,
      link: "/seller/rfq",
      data: { rfqId: String(rfq._id) },
    }).catch(() => {});

    return res.json({ rfq });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

/* ──────────────────────────────────────────────────────────────────────
 * Buyer — cancel
 * ────────────────────────────────────────────────────────────────────── */

/**
 * PATCH /api/rfq/:id/cancel   (buyer, protect)
 * The buyer withdraws a pending|quoted RFQ.
 */
export const cancelRfq = async (req, res) => {
  try {
    const rfq = await Rfq.findById(req.params.id);
    if (!rfq) return res.status(404).json({ message: "Үнийн санал олдсонгүй" });
    if (String(rfq.buyer) !== String(req.user._id)) {
      return res.status(403).json({ message: "Энэ үнийн санал таных биш" });
    }
    if (!["pending", "quoted"].includes(rfq.status)) {
      return res.status(400).json({ message: "Энэ үнийн саналыг цуцлах боломжгүй" });
    }

    rfq.status = "cancelled";
    await rfq.save();

    return res.json({ rfq });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};
