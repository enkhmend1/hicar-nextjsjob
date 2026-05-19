/**
 * Inventory service — stock thresholds + low-stock detection + alert dispatch.
 *
 * Effective threshold resolution (in order):
 *   1. product.lowStockThreshold       (per-product override; -1 = not set)
 *   2. seller.sellerProfile.defaultLowStockThreshold
 *   3. PLATFORM_DEFAULT
 *
 * Alert idempotency:
 *   We persist `alertedAt` in Redis (or fall back to in-process Set) so a
 *   single low-stock event only fires once per 12 hours per product.
 */

import Product from "../Model/product.model.js";
import User from "../Model/user.model.js";
import { notify, notifyAdmins } from "./notification.service.js";
import { cacheGet, cacheSet } from "../Config/redis.js";

const PLATFORM_DEFAULT = 5;
const ALERT_COOLDOWN_S = 12 * 60 * 60; // 12 hours

const inMemoryAlerted = new Map(); // fallback when Redis disabled

const wasRecentlyAlerted = async (productId) => {
  const key = `lowstock:alerted:${productId}`;
  const cached = await cacheGet(key);
  if (cached) return true;
  const mem = inMemoryAlerted.get(String(productId));
  return Boolean(mem && Date.now() - mem < ALERT_COOLDOWN_S * 1000);
};

const markAlerted = async (productId) => {
  const key = `lowstock:alerted:${productId}`;
  await cacheSet(key, { at: Date.now() }, ALERT_COOLDOWN_S);
  inMemoryAlerted.set(String(productId), Date.now());
};

/**
 * Compute the effective low-stock threshold for a product.
 * Caller can pass `seller` to avoid a DB fetch.
 */
export const getEffectiveThreshold = async (product, seller = null) => {
  if (typeof product.lowStockThreshold === "number" && product.lowStockThreshold >= 0) {
    return product.lowStockThreshold;
  }
  const s = seller ?? (product.seller ? await User.findById(product.seller).select("sellerProfile") : null);
  return s?.sellerProfile?.defaultLowStockThreshold ?? PLATFORM_DEFAULT;
};

/**
 * Inspect a product after a stock change. If stock has crossed the threshold,
 * notify the seller (in-app + email if enabled) — but only once per cooldown.
 *
 * Safe to call from any write path; swallows its own errors.
 */
export const maybeAlertLowStock = async (productId) => {
  try {
    const product = await Product.findById(productId);
    if (!product) return;
    const seller = product.seller
      ? await User.findById(product.seller).select("name email sellerProfile")
      : null;

    const threshold = await getEffectiveThreshold(product, seller);
    const qty = product.stockQty ?? 0;
    if (qty > threshold) return;

    if (await wasRecentlyAlerted(productId)) return;

    if (seller?._id) {
      await notify({
        user: seller._id,
        type: "low_stock",
        title: qty === 0 ? "Бараа дууссан ⚠️" : `Үлдэгдэл багасч байна (${qty} ширхэг)`,
        body: `"${product.name}" — ${qty}/${threshold} ширхэг`,
        link: "/seller/products",
        data: { productId: String(product._id), stockQty: qty, threshold },
        email: seller.sellerProfile?.emailAlertsEnabled !== false,
      });
    } else {
      // House-brand (admin-owned) product
      await notifyAdmins({
        type: "low_stock",
        title: "Admin барааны үлдэгдэл багасч байна",
        body: `"${product.name}" — ${qty} ширхэг`,
        link: "/admin/products",
        data: { productId: String(product._id), stockQty: qty, threshold },
      });
    }

    await markAlerted(productId);
  } catch (e) {
    console.error("low-stock alert failed:", e.message);
  }
};

/**
 * One-shot sweep — used by admin/cron to re-evaluate all products at once.
 * Returns the count of fired alerts.
 */
export const sweepAllLowStock = async () => {
  const products = await Product.find({ status: "approved" }).select("_id stockQty seller lowStockThreshold name");
  const sellersById = new Map();
  let fired = 0;
  for (const p of products) {
    let seller = null;
    if (p.seller) {
      if (!sellersById.has(String(p.seller))) {
        sellersById.set(
          String(p.seller),
          await User.findById(p.seller).select("name email sellerProfile"),
        );
      }
      seller = sellersById.get(String(p.seller));
    }
    const threshold = await getEffectiveThreshold(p, seller);
    if ((p.stockQty ?? 0) <= threshold && !(await wasRecentlyAlerted(p._id))) {
      await maybeAlertLowStock(p._id);
      fired++;
    }
  }
  return fired;
};
