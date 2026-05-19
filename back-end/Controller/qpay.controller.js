import Order from "../Model/order.model.js";
import { createInvoice, checkPayment, qpayEnabled } from "../Service/qpay.service.js";
import { notify } from "../Service/notification.service.js";

/**
 * POST /api/qpay/invoice
 * Body: { orderId }
 * Creates (or returns the existing) QPay invoice for the order.
 * Order must belong to current user and be qpay + still pending.
 */
export const createOrderInvoice = async (req, res) => {
  try {
    if (!qpayEnabled) return res.status(503).json({ message: "QPay тохируулагдаагүй" });
    const { orderId } = req.body;
    const order = await Order.findOne({ _id: orderId, user: req.user._id });
    if (!order) return res.status(404).json({ message: "Захиалга олдсонгүй" });
    if (order.paymentMethod !== "qpay") return res.status(400).json({ message: "QPay захиалга биш" });
    if (order.status !== "pending") return res.status(400).json({ message: "Захиалга төлсөн эсвэл цуцалсан" });

    // If we already have an invoice id, return cached payload
    if (order.qpayInvoice?.invoice_id) {
      return res.json({ invoice: order.qpayInvoice });
    }

    const invoice = await createInvoice({
      orderId: String(order._id),
      amount: order.total,
      description: `HiCar #${String(order._id).slice(-8).toUpperCase()}`,
    });
    order.qpayInvoice = {
      invoice_id: invoice.invoice_id,
      qr_text: invoice.qr_text,
      qr_image: invoice.qr_image,
      urls: invoice.urls,
      qPay_shortUrl: invoice.qPay_shortUrl,
      created_at: new Date(),
    };
    await order.save();
    return res.json({ invoice: order.qpayInvoice });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * GET /api/qpay/check/:orderId
 * Polls QPay to see if the invoice was paid. If yes, marks order as paid.
 */
export const checkOrderPayment = async (req, res) => {
  try {
    if (!qpayEnabled) return res.status(503).json({ message: "QPay тохируулагдаагүй" });
    const order = await Order.findOne({ _id: req.params.orderId, user: req.user._id });
    if (!order) return res.status(404).json({ message: "Захиалга олдсонгүй" });
    if (!order.qpayInvoice?.invoice_id) {
      return res.status(400).json({ message: "QPay invoice байхгүй" });
    }
    if (order.status === "paid" || order.status === "processing" || order.status === "shipped" || order.status === "delivered") {
      return res.json({ status: order.status, paid: true });
    }

    const result = await checkPayment(order.qpayInvoice.invoice_id);
    const paid = (result.count || 0) > 0 && Number(result.paid_amount || 0) >= order.total;
    if (paid && order.status === "pending") {
      order.status = "paid";
      order.qpayInvoice.paid_at = new Date();
      await order.save();
      notify({
        user: order.user,
        type: "payment_received",
        title: "Төлбөр баталгаажлаа ✓",
        body: `#${String(order._id).slice(-8).toUpperCase()} — ₮${order.total.toLocaleString()} төлөгдсөн`,
        link: "/orders",
        data: { orderId: String(order._id) },
        email: true,
      });
    }
    return res.json({ status: order.status, paid });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * POST /api/qpay/callback?orderId=...
 * Public — QPay calls this when payment confirmed. No auth (verify by checking with QPay).
 */
export const callback = async (req, res) => {
  try {
    if (!qpayEnabled) return res.status(503).json({ message: "QPay тохируулагдаагүй" });
    const orderId = req.query.orderId || req.body?.orderId;
    if (!orderId) return res.status(400).json({ message: "orderId дутуу" });
    const order = await Order.findById(orderId);
    if (!order || !order.qpayInvoice?.invoice_id) return res.status(404).json({ message: "Захиалга олдсонгүй" });

    // Verify with QPay (don't trust the callback body blindly)
    const result = await checkPayment(order.qpayInvoice.invoice_id);
    const paid = (result.count || 0) > 0 && Number(result.paid_amount || 0) >= order.total;
    if (paid && order.status === "pending") {
      order.status = "paid";
      order.qpayInvoice.paid_at = new Date();
      await order.save();
      notify({
        user: order.user,
        type: "payment_received",
        title: "Төлбөр баталгаажлаа ✓",
        body: `#${String(order._id).slice(-8).toUpperCase()} — ₮${order.total.toLocaleString()} төлөгдсөн`,
        link: "/orders",
        data: { orderId: String(order._id) },
        email: true,
      });
    }
    return res.json({ ok: true, paid });
  } catch (err) {
    console.error("QPay callback error:", err);
    return res.status(500).json({ message: err.message });
  }
};
