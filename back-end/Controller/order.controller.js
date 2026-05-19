import Order from "../Model/order.model.js";
import Product from "../Model/product.model.js";
import { notify, notifyAdmins } from "../Service/notification.service.js";
import { maybeAlertLowStock } from "../Service/inventory.service.js";

const DELIVERY_PRICE = { fast: 15000, normal: 8000, cheap: 0 };
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
      const qty = Math.max(1, Number(i.quantity) || 1);
      const dt = ["fast", "normal", "cheap"].includes(i.deliveryType) ? i.deliveryType : "normal";
      total += p.price * qty;
      deliveryFee += DELIVERY_PRICE[dt];
      enriched.push({ product: p._id, name: p.name, oem: p.oem, price: p.price, quantity: qty, deliveryType: dt });
    }
    total += deliveryFee;

    // 3. Atomically decrement stock for each item. Rollback on failure.
    for (const e of enriched) {
      const upd = await Product.findOneAndUpdate(
        { _id: e.product, stockQty: { $gte: e.quantity } },
        { $inc: { stockQty: -e.quantity } },
        { new: true },
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
    notify({
      user: req.user._id,
      type: "order_placed",
      title: "Захиалга үүсгэгдлээ",
      body: `Таны захиалга #${String(order._id).slice(-8).toUpperCase()} (₮${total.toLocaleString()}) хүлээн авагдлаа.`,
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

    // Rollback stock only on first cancellation. Money refund is handled
    // by the dispute / refund flow (QPay refund API) — see Phase 2.
    if (becomingCancelled && !wasCancelled) {
      for (const it of order.items) {
        await Product.updateOne(
          { _id: it.product },
          { $inc: { stockQty: it.quantity }, $set: { inStock: true } },
        );
      }
    }

    order.status = status;
    await order.save();
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
