import { logger } from "../Config/logger.js";

/**
 * QPay v2 client.
 * Docs: https://developer.qpay.mn
 * Required env:
 *   QPAY_USERNAME      — merchant username
 *   QPAY_PASSWORD      — merchant password
 *   QPAY_INVOICE_CODE  — merchant invoice template code
 *   QPAY_CALLBACK_URL  — public URL QPay will POST to on payment (optional, polling works too)
 *   QPAY_BASE_URL      — defaults to https://merchant.qpay.mn/v2
 */

const BASE = process.env.QPAY_BASE_URL || "https://merchant.qpay.mn/v2";
const USERNAME = process.env.QPAY_USERNAME;
const PASSWORD = process.env.QPAY_PASSWORD;
const INVOICE_CODE = process.env.QPAY_INVOICE_CODE;
const CALLBACK_URL = process.env.QPAY_CALLBACK_URL;
const CALLBACK_SECRET = process.env.QPAY_CALLBACK_SECRET || "";

export const qpayEnabled = Boolean(USERNAME && PASSWORD && INVOICE_CODE);

if (qpayEnabled) {
  logger.info("QPay enabled", { base: BASE });
} else {
  logger.warn("QPay disabled — set QPAY_USERNAME, QPAY_PASSWORD, QPAY_INVOICE_CODE to enable");
}

// ── Token cache (auth token has expiry; we lazily refresh) ─────────
let cachedToken = null;
let cachedAt = 0;

const getAuthToken = async () => {
  // Reuse for up to 50 minutes (QPay tokens are 1h)
  if (cachedToken && Date.now() - cachedAt < 50 * 60 * 1000) {
    return cachedToken;
  }
  const basic = Buffer.from(`${USERNAME}:${PASSWORD}`).toString("base64");
  const res = await fetch(`${BASE}/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Basic ${basic}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`QPay auth failed: ${res.status} ${text}`);
  }
  const data = await res.json();
  if (!data.access_token) throw new Error("QPay auth: no access_token in response");
  cachedToken = data.access_token;
  cachedAt = Date.now();
  return cachedToken;
};

/**
 * Create a QPay invoice for a given amount.
 * Returns { invoice_id, qr_text, qr_image, urls, deeplinks } from QPay.
 */
export const createInvoice = async ({ orderId, amount, description, senderInvoiceNo }) => {
  if (!qpayEnabled) throw new Error("QPay тохиргоо хийгдээгүй");
  const token = await getAuthToken();
  const body = {
    invoice_code: INVOICE_CODE,
    sender_invoice_no: senderInvoiceNo || String(orderId),
    invoice_receiver_code: "terminal",
    invoice_description: description || `HiCar order ${orderId}`,
    amount,
    // Stuff the shared secret into the callback URL itself so QPay sends it
    // back to us on every invocation. Without it, our verifyQpayCallback
    // middleware rejects the request — meaning a leaked URL alone is not
    // enough to spoof a payment.
    callback_url: CALLBACK_URL
      ? `${CALLBACK_URL}?orderId=${orderId}${CALLBACK_SECRET ? `&secret=${encodeURIComponent(CALLBACK_SECRET)}` : ""}`
      : undefined,
  };
  const res = await fetch(`${BASE}/invoice`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`QPay invoice failed: ${res.status} ${text}`);
  }
  return res.json();
};

/**
 * Check payment by QPay invoice_id.
 * Returns { count, paid_amount, rows: [...] } — paid if count > 0.
 */
export const checkPayment = async (invoiceId) => {
  if (!qpayEnabled) throw new Error("QPay тохиргоо хийгдээгүй");
  const token = await getAuthToken();
  const res = await fetch(`${BASE}/payment/check`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      object_type: "INVOICE",
      object_id: invoiceId,
      offset: { page_number: 1, page_limit: 100 },
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`QPay check failed: ${res.status} ${text}`);
  }
  return res.json();
};

/** Cancel an invoice (optional — used on order cancellation). */
export const cancelInvoice = async (invoiceId) => {
  if (!qpayEnabled) return;
  try {
    const token = await getAuthToken();
    await fetch(`${BASE}/invoice/${invoiceId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch { /* ignore */ }
};

/**
 * Issue a refund against a paid QPay invoice.
 *
 * QPay v2 refund endpoint expects the underlying PAYMENT ID (the one
 * inside checkPayment's `rows[].payment_id`), not the invoice id — so we
 * always do a check first to surface the most-recent successful payment.
 *
 * Returns { ok: true, refundId, amount } on success.
 * If QPay is disabled, returns a synthetic refund id so the dispute flow
 * can still complete in dev/test without crashing.
 */
export const refundPayment = async ({ invoiceId, amount, note }) => {
  if (!qpayEnabled) {
    return {
      ok: true,
      refundId: `mock-refund-${Date.now()}`,
      amount,
      mocked: true,
    };
  }
  const token = await getAuthToken();

  // 1. Resolve the most recent successful payment for this invoice.
  const check = await checkPayment(invoiceId);
  const successful = (check.rows || []).find(
    (r) => String(r.payment_status || "").toUpperCase() === "PAID"
        || Number(r.payment_amount || 0) > 0,
  );
  if (!successful?.payment_id) {
    throw new Error(`QPay refund: no successful payment found for invoice ${invoiceId}`);
  }

  // 2. Hit /payment/refund. The API supports a refund-amount param for partials.
  const res = await fetch(`${BASE}/payment/refund/${successful.payment_id}`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      note: note || "HiCar dispute refund",
      refund_amount: amount,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`QPay refund failed: ${res.status} ${text}`);
  }
  const data = await res.json().catch(() => ({}));
  return {
    ok: true,
    refundId: data.refund_id || data.id || `qpay-refund-${successful.payment_id}`,
    amount,
    raw: data,
  };
};
