import Order from "../Model/order.model.js";
import { createInvoice, checkPayment, qpayEnabled } from "../Service/qpay.service.js";
import { notify } from "../Service/notification.service.js";
import { settleOrderPaid } from "../Service/escrow.service.js";
import { logger } from "../Config/logger.js";

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
    // Both "qpay" and "card" settle through QPay (its payment page accepts
    // Visa/Mastercard), so both are valid here. Wallet/other methods are not.
    if (!["qpay", "card"].includes(order.paymentMethod)) {
      return res.status(400).json({ message: "QPay-аар төлөх захиалга биш" });
    }
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
 * Fire the "payment confirmed" notification. Extracted so the polling path
 * and the callback path send the exact same message — and only ONCE per
 * order (escrow.settleOrderPaid returns false on duplicate calls).
 */
const notifyPaid = (order) => {
  notify({
    user: order.user,
    type: "payment_received",
    title: "Төлбөр баталгаажлаа ✓",
    body: `#${String(order._id).slice(-8).toUpperCase()} — ₮${order.total.toLocaleString()} төлөгдсөн`,
    link: "/orders",
    data: { orderId: String(order._id) },
    email: true,
  });
};

/**
 * GET /api/qpay/check/:orderId
 * Polls QPay to see if the invoice was paid. If yes, marks order as paid
 * AND atomically freezes the escrow split via escrow.service.
 */
export const checkOrderPayment = async (req, res) => {
  try {
    if (!qpayEnabled) return res.status(503).json({ message: "QPay тохируулагдаагүй" });
    const order = await Order.findOne({ _id: req.params.orderId, user: req.user._id });
    if (!order) return res.status(404).json({ message: "Захиалга олдсонгүй" });
    if (!order.qpayInvoice?.invoice_id) {
      return res.status(400).json({ message: "QPay invoice байхгүй" });
    }
    // Already past PENDING — no need to call upstream.
    if (order.paymentStatus !== "PENDING") {
      return res.json({ status: order.status, paymentStatus: order.paymentStatus, paid: order.paymentStatus !== "FAILED" });
    }

    const result = await checkPayment(order.qpayInvoice.invoice_id);
    const paid = (result.count || 0) > 0 && Number(result.paid_amount || 0) >= order.total;
    if (paid) {
      const transitioned = await settleOrderPaid(order._id);
      if (transitioned) notifyPaid(order);
    }
    // Re-read to return the canonical post-transition state.
    const fresh = await Order.findById(order._id).select("status paymentStatus");
    return res.json({ status: fresh.status, paymentStatus: fresh.paymentStatus, paid });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * POST /api/qpay/callback?orderId=...
 * Public — QPay calls this when payment confirmed. No auth (verify by checking with QPay).
 *
 * Idempotent: if the order is already PAID this is a no-op. Same flow as the
 * polling path so a callback and a poll that race only flip the order once.
 */
export const callback = async (req, res) => {
  try {
    if (!qpayEnabled) return res.status(503).json({ message: "QPay тохируулагдаагүй" });
    const orderId = req.query.orderId || req.body?.orderId;
    if (!orderId) return res.status(400).json({ message: "orderId дутуу" });
    const order = await Order.findById(orderId);
    if (!order || !order.qpayInvoice?.invoice_id) return res.status(404).json({ message: "Захиалга олдсонгүй" });

    // Verify with QPay — don't trust the callback body blindly.
    const result = await checkPayment(order.qpayInvoice.invoice_id);
    const paid = (result.count || 0) > 0 && Number(result.paid_amount || 0) >= order.total;
    if (paid) {
      const transitioned = await settleOrderPaid(order._id);
      if (transitioned) notifyPaid(order);
    }
    return res.json({ ok: true, paid });
  } catch (err) {
    logger.error("QPay callback error", { err });
    return res.status(500).json({ message: err.message });
  }
};
