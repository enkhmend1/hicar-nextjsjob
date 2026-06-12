import { Product } from "@/app/types";

/**
 * B2B tiered pricing — mirror of the server's resolveUnitPrice
 * (order.controller.js). The UNIT price for a quantity is the highest
 * tier whose minQty <= qty, falling back to the base price. Display
 * only — the server re-derives the authoritative total at order create.
 */
export const tierUnitPrice = (p: Product, qty: number): number => {
  const base = p.price ?? 0;
  const tiers = p.priceTiers ?? [];
  let unit = base;
  let best = 1;
  for (const t of tiers) {
    if (!t || !Number.isFinite(t.minQty) || !Number.isFinite(t.price) || t.price <= 0) continue;
    if (qty >= t.minQty && t.minQty >= best) { best = t.minQty; unit = t.price; }
  }
  return unit;
};
