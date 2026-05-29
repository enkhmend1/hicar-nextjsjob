import Order from "../Model/order.model.js";
import Product from "../Model/product.model.js";
import User from "../Model/user.model.js";
import { notify, notifyAdmins } from "../Service/notification.service.js";
import { maybeAlertLowStock } from "../Service/inventory.service.js";
import { scheduleRelease, cancelScheduledRelease } from "../Queue/escrowRelease.queue.js";

// Platform-default delivery fees (MNT). Used as the fallback when a seller
// hasn't set their own per-tier price (Phase AV made price seller-editable
// in sellerProfile.deliveryOptions). This stays the authoritative default —
// the client NEVER supplies a delivery price.
const DELIVERY_PRICE = { fast: 15000, normal: 8000, cheap: 0 };
const DELIVERY_TIERS = ["fast", "normal", "cheap"];

/**
 * Resolve the authoritative delivery fee for one line item.
 *
 * Priority: the item's seller's own configured price (deliveryOptions) →
 * the platform DELIVERY_PRICE default. `cfgBySeller` is a
 * Map<sellerIdString, deliveryOptions> pre-loaded once per order so this is
 * a pure in-memory lookup. Any non-finite / negative stored value falls
 * back to the platform default, so a corrupt doc can never under/over-charge.
 */
const resolveDeliveryPrice = (cfgBySeller, sellerId, tier) => {
  const fallback = DELIVERY_PRICE[tier] ?? 0;
  const cfg = sellerId ? cfgBySeller.get(String(sellerId)) : null;
  const raw = cfg?.[tier]?.price;
  return Number.isFinite(raw) && raw >= 0 ? Math.round(raw) : fallback;
};
const STATUS_LABEL_MN = {
  pending: "хүлээгдэж буй", paid: "төлсөн", processing: "бэлдэж буй",
  shipped: "илгээсэн", delivered: "хүргэгдсэн", cancelled: "цуцалсан",
};
/** QPay is the only payment method now — wallet flow removed (Phase 1). */
const ALLOWED_PAYMENT_METHODS = ["qpay", "card"];

export const createOrder = async (req, res) => {
  const decremented = []; // {id, qty} for rollback

  try {
    const { items, address, phone, paymentMethod } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "Сагс хоосон байна" });
    }
    if (!address || !phone || !paymentMethod) {
      return res.status(400).json({ message: "Хаяг, утас, төлбөрийн арга шаардлагатай" });
    }
    if (!ALLOWED_PAYMENT_METHODS.includes(paymentMethod)) {
      return res.status(400).json({ message: "Төлбөрийн арга буруу — зөвхөн QPay/card" });
    }

    // 1. Load all products + sanity check
    const ids = items.map(i => i.product);
    const products = await Product.find({ _id: { $in: ids } });
    const pmap = new Map(products.map(p => [String(p._id), p]));

    // 1b. Load each referenced seller's delivery-price config in ONE query.
    //     The delivery fee is computed authoritatively from this — never
    //     from the client. Sellers without a config fall back to the
    //     platform DELIVERY_PRICE default inside resolveDeliveryPrice().
    const cartSellerIds = [...new Set(products.map(p => p.seller).filter(Boolean).map(String))];
    const cfgBySeller = new Map();
    if (cartSellerIds.length > 0) {
      const sellers = await User.find(
        { _id: { $in: cartSellerIds } },
        "sellerProfile.deliveryOptions",
      ).lean();
      for (const s of sellers) {
        cfgBySeller.set(String(s._id), s.sellerProfile?.deliveryOptions || null);
      }
    }

    // 2. Build enriched items + total. Stop on missing product.
    let total = 0, deliveryFee = 0;
    const enriched = [];
    for (const i of items) {
      const p = pmap.get(String(i.product));
      if (!p) {
        return res.status(400).json({
          message: "Бараа олдсонгүй (устгагдсан байж магадгүй). Сагснаас хасна уу.",
          missingProductId: i.product,
        });
      }
      if (!p.inStock) {
        return res.status(400).json({
          message: `"${p.name}" бараа худалдаалагдахгүй байна`,
          missingProductId: String(p._id),
        });
      }
      // Guard against null/negative prices that would corrupt the order total.
      // Should never happen if the product form validates correctly, but an
      // admin edit or a migration bug could leave a corrupt price.
      if (typeof p.price !== "number" || !Number.isFinite(p.price) || p.price < 0) {
        return res.status(400).json({
          message: `"${p.name}" — барааны үнэ буруу байна. Хэрэглэгчийн дэмжлэг рүү хандана уу.`,
          missingProductId: String(p._id),
        });
      }
      const qty = Math.max(1, Number(i.quantity) || 1);
      const dt = DELIVERY_TIERS.includes(i.deliveryType) ? i.deliveryType : "normal";
      total += p.price * qty;
      // Delivery fee = the SELLER's own price for this tier (server-resolved).
      deliveryFee += resolveDeliveryPrice(cfgBySeller, p.seller, dt);
      // `seller` is denormalised onto the order line so per-seller payout
      // queries don't need a populate(). Escrow split fields (lineRevenue /
      // platformFee / sellerPayout / bankSnapshot) stay zero here — they're
      // filled in atomically by the QPay callback once the payment lands.
      enriched.push({
        product: p._id, seller: p.seller,
        name: p.name, oem: p.oem, price: p.price, quantity: qty, deliveryType: dt,
      });
    }
    total += deliveryFee;

    // 3. Atomically decrement stock for each item. Rollback on failure.
    for (const e of enriched) {
      const upd = await Product.findOneAndUpdate(
        { _id: e.product, stockQty: { $gte: e.quantity } },
        { $inc: { stockQty: -e.quantity } },
        { returnDocument: "after" },
      );
      if (!upd) {
        // Rollback any previous decrements
        for (const d of decremented) {
          await Product.updateOne({ _id: d.id }, { $inc: { stockQty: d.qty } });
        }
        return res.status(400).json({
          message: `"${e.name}" — нөөц хүрэлцэхгүй байна`,
          missingProductId: String(e.product),
        });
      }
      decremented.push({ id: e.product, qty: e.quantity });
      // Auto-mark out of stock
      if (upd.stockQty === 0 && upd.inStock) {
        await Product.updateOne({ _id: upd._id }, { $set: { inStock: false } });
      }
    }

    // 4. Fire low-stock alerts on touched products (rate-limited inside the service)
    for (const d of decremented) {
      maybeAlertLowStock(d.id).catch(() => {});
    }

    // 5. Create the order.
    //    Status is always "pending" until QPay callback confirms payment.
    //    Card payments here are placeholder — real card flow goes through QPay too.
    const order = await Order.create({
      user: req.user._id,
      items: enriched,
      total, deliveryFee, address, phone, paymentMethod,
      status: "pending",
      paymentStatus: "PENDING",
    });

    // Notifications (fire-and-forget)
    const shortId = String(order._id).slice(-8).toUpperCase();
    notify({
      user: req.user._id,
      type: "order_placed",
      title: "Захиалга үүсгэгдлээ",
      body: `Таны захиалга #${shortId} (₮${total.toLocaleString()}) хүлээн авагдлаа.`,
      link: `/orders`,
      data: { orderId: String(order._id) },
    });
    notifyAdmins({
      type: "order_placed",
      title: "Шинэ захиалга",
      body: `${req.user.name} ₮${total.toLocaleString()} захиалга өглөө.`,
      link: `/admin/orders`,
      data: { orderId: String(order._id) },
    });

    // Phase AQ.2: notify each affected seller. Dedupe by seller id so a
    // seller with 3 items in one order only gets ONE ping. Fire-and-forget
    // — failures shouldn't block the order response (notify already
    // catches its own errors via the outbox pattern).
    const sellerIds = new Set();
    for (const it of enriched) {
      if (it.seller) sellerIds.add(String(it.seller));
    }
    for (const sid of sellerIds) {
      // Count items for THIS seller so the body is informative.
      const itemsForSeller = enriched.filter((i) => String(i.seller) === sid);
      const sellerSubtotal = itemsForSeller.reduce((s, i) => s + i.price * i.quantity, 0);
      const itemSummary = itemsForSeller.length === 1
        ? `"${itemsForSeller[0].name}" ×${itemsForSeller[0].quantity}`
        : `${itemsForSeller.length} бараа`;
      notify({
        user: sid,
        type: "order_placed",
        title: "Шинэ захиалга",
        body: `${itemSummary} — ₮${sellerSubtotal.toLocaleString()}. #${shortId}`,
        link: `/seller/orders`,
        data: { orderId: String(order._id) },
      });
    }
    return res.status(201).json({ order });
  } catch (err) {
    // Best-effort rollback (stock only — no wallet to refund)
    try {
      for (const d of decremented) {
        await Product.updateOne({ _id: d.id }, { $inc: { stockQty: d.qty } });
      }
    } catch (_) { /* swallow rollback errors */ }
    return res.status(400).json({ message: err.message });
  }
};

export const myOrders = async (req, res) => {
  try {
    const orders = await Order.find({ user: req.user._id }).sort({ createdAt: -1 });
    return res.json({ orders });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

export const listOrders = async (req, res) => {
  try {
    const { status, limit, since } = req.query;
    const filter = {};
    if (status && status !== "all") filter.status = status;
    if (since) filter.createdAt = { $gte: new Date(since) };
    let q = Order.find(filter).populate("user", "name email phone").sort({ createdAt: -1 });
    if (limit) q = q.limit(Number(limit));
    const orders = await q;
    return res.json({ orders });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

export const updateStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const allowed = ["pending", "paid", "processing", "shipped", "delivered", "cancelled"];
    if (!allowed.includes(status)) {
      return res.status(400).json({ message: "Статус буруу" });
    }

    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: "Захиалга олдсонгүй" });

    const wasCancelled = order.status === "cancelled";
    const becomingCancelled = status === "cancelled";
    const becomingDelivered = status === "delivered" && order.status !== "delivered";

    // Rollback stock only on first cancellation. Money refund is handled
    // by the dispute / refund flow (QPay refund API).
    if (becomingCancelled && !wasCancelled) {
      for (const it of order.items) {
        await Product.updateOne(
          { _id: it.product },
          { $inc: { stockQty: it.quantity }, $set: { inStock: true } },
        );
      }
      // No point holding escrow for a cancelled order — cancel the worker.
      await cancelScheduledRelease(order).catch(() => {});
    }

    if (becomingDelivered) {
      order.deliveredAt = new Date();
    }

    order.status = status;
    await order.save();

    // Schedule the escrow-release worker AFTER persisting deliveredAt so
    // the worker has a stable point of truth. Skipped if a dispute is
    // already open — the dispute flow will reschedule on resolution.
    if (becomingDelivered && order.paymentStatus === "PAID" && !order.hasOpenDispute) {
      await scheduleRelease(order).catch((e) =>
        console.warn("[order.delivered] scheduleRelease failed:", e.message));
    }
    const populated = await order.populate("user", "name email phone");

    // Notify the customer about the status change
    notify({
      user: order.user,
      type: "order_status_changed",
      title: "Захиалгын төлөв өөрчлөгдлөө",
      body: `#${String(order._id).slice(-8).toUpperCase()} — ${STATUS_LABEL_MN[status] || status}`,
      link: `/orders`,
      data: { orderId: String(order._id), status },
      email: true,
    });

    return res.json({ order: populated });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

// ────────────────────────────────────────────────────────────────────
// Phase AQ.1 — Seller-scoped order status update
// ────────────────────────────────────────────────────────────────────

/**
 * State machine for sellers. They can only push FORWARD — never reverse
 * a state, never jump (e.g. paid→delivered without going through
 * processing+shipped). The `delivered` terminal state is reserved for
 * the buyer's confirmation endpoint so escrow release happens only when
 * the buyer themselves acknowledges receipt (Phase AQ.5).
 */
const SELLER_ALLOWED_NEXT = Object.freeze({
  paid:       ["processing"],
  processing: ["shipped"],
});

const STATUS_LABEL_FOR_BUYER = {
  processing: "Бэлдэж эхэллээ",
  shipped:    "Илгээгдлээ",
};

/**
 * PATCH /api/seller/orders/:id/status
 * Body: { status: "processing" | "shipped", trackingNumber?: string }
 *
 * Authz: req.user must be a seller who owns AT LEAST ONE item in the
 * order. We don't allow partial-order workflows yet — the whole order
 * moves together. (Multi-seller fulfilment is a Phase BL+ concern.)
 */
export const sellerUpdateOrderStatus = async (req, res) => {
  try {
    const sellerId = String(req.user._id);
    const { status, trackingNumber } = req.body || {};

    if (!status || typeof status !== "string") {
      return res.status(400).json({ message: "Статус заагдаагүй" });
    }

    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: "Захиалга олдсонгүй" });

    // Authz — at least one item must belong to this seller.
    const sellerOwnsAnyItem = order.items.some((it) => String(it.seller) === sellerId);
    if (!sellerOwnsAnyItem) {
      return res.status(403).json({ message: "Энэ захиалгад таны бараа алга" });
    }

    // State machine
    const allowed = SELLER_ALLOWED_NEXT[order.status] || [];
    if (!allowed.includes(status)) {
      return res.status(400).json({
        message: `"${order.status}" төлвөөс "${status}" руу шилжих боломжгүй`,
        currentStatus: order.status,
        allowedNext:   allowed,
      });
    }

    // Money must be in escrow AND no live dispute must be open.
    // Checking both here (rather than relying solely on the earlier findById
    // snapshot) closes the race where a dispute is filed between our read
    // and our write — we refuse to advance a DISPUTED escrow state.
    if (order.paymentStatus !== "PAID") {
      return res.status(400).json({
        message: "Төлбөр баталгаажаагүй захиалгыг боловсруулах боломжгүй",
      });
    }
    if (order.hasOpenDispute) {
      return res.status(409).json({
        message: "Энэ захиалгад нээлттэй гомдол байна — гомдол шийдэгдтэл статус өөрчлөх боломжгүй",
      });
    }

    order.status = status;
    if (status === "shipped" && typeof trackingNumber === "string") {
      order.trackingNumber = trackingNumber.trim().slice(0, 100);
    }
    await order.save();

    // Notify buyer with concise Mongolian status copy.
    const shortId = String(order._id).slice(-8).toUpperCase();
    const trk = status === "shipped" && order.trackingNumber
      ? ` · Хяналтын код: ${order.trackingNumber}`
      : "";
    notify({
      user: order.user,
      type: "order_status_changed",
      title: STATUS_LABEL_FOR_BUYER[status] || "Захиалгын төлөв өөрчлөгдсөн",
      body:  `#${shortId} — ${STATUS_LABEL_FOR_BUYER[status]}${trk}`,
      link:  `/orders`,
      data:  { orderId: String(order._id), status, trackingNumber: order.trackingNumber || null },
      email: true,
    });

    return res.json({ order });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

// ────────────────────────────────────────────────────────────────────
// Phase AQ.5 — Buyer confirms delivery
// ────────────────────────────────────────────────────────────────────

/**
 * POST /api/orders/:id/confirm-delivery
 *
 * Buyer's "I got it" button. Only valid from `shipped`. Schedules the
 * escrow release. Idempotent — calling twice is a no-op.
 *
 * Note: this is the HAPPY-PATH counterpart to the dispute flow. If the
 * buyer's parcel didn't arrive, didn't fit, or was damaged, they file a
 * dispute INSTEAD of confirming delivery (see /api/disputes).
 */
export const buyerConfirmDelivery = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: "Захиалга олдсонгүй" });
    if (String(order.user) !== String(req.user._id)) {
      return res.status(403).json({ message: "Энэ захиалга таных биш" });
    }
    // Idempotent — already delivered, just return current state.
    if (order.status === "delivered") {
      return res.json({ order, alreadyConfirmed: true });
    }
    if (order.status !== "shipped") {
      return res.status(400).json({
        message: `"${order.status}" төлвөөс "delivered" руу шилжих боломжгүй (зөвхөн "shipped"-ээс)`,
      });
    }

    order.status = "delivered";
    order.deliveredAt = new Date();
    order.buyerConfirmedDeliveryAt = order.deliveredAt;
    await order.save();

    if (order.paymentStatus === "PAID" && !order.hasOpenDispute) {
      await scheduleRelease(order).catch((e) =>
        console.warn("[buyer.confirmDelivery] scheduleRelease failed:", e.message));
    }

    // Notify the affected seller(s).
    const shortId = String(order._id).slice(-8).toUpperCase();
    const sellerIds = new Set();
    for (const it of order.items) if (it.seller) sellerIds.add(String(it.seller));
    for (const sid of sellerIds) {
      notify({
        user: sid,
        type: "order_status_changed",
        title: "Захиалга хүргэгдлээ",
        body:  `#${shortId} — Худалдан авагч баталгаажуулсан. Escrow төлбөр шилжих хугацаа эхэллээ.`,
        link:  `/seller/orders`,
        data:  { orderId: String(order._id), status: "delivered" },
      });
    }

    return res.json({ order });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};
