import type {
  DeliveryTierKey, DeliveryUnit, DeliveryOption, DeliveryOptions,
  Product, SellerSummary,
} from "@/app/types";

/**
 * Phase AU/AV — shared delivery helpers (duration + price).
 *
 * Both the DURATION (ETA) and the PRICE of each shipping tier are
 * seller-managed: every shop defines, from /seller/profile → "Хүргэлт",
 * how long each tier takes (HOURS or DAYS) and what it costs (MNT). This
 * module is the single source of truth for:
 *   • the canonical tier order + Mongolian labels,
 *   • the platform fallback durations + prices (used until a seller
 *     customises, and for admin/no-seller listings),
 *   • formatting an ETA ("2 цаг" / "7 хоног") and a price ("₮5,000"),
 *   • resolving WHICH durations + prices to show for a given product.
 *
 * AUTHORITY NOTE: the resolved price here is for DISPLAY only. The order
 * total is always recomputed server-side from the seller's stored config
 * (see order.controller.js) — the client price is never trusted. The
 * platform default mirrors order.controller's DELIVERY_PRICE constant.
 */

export const DELIVERY_TIER_ORDER: DeliveryTierKey[] = ["fast", "normal", "cheap"];

export const DELIVERY_TIER_META: Record<DeliveryTierKey, { label: string; desc: string }> = {
  fast:   { label: "Яаралтай", desc: "Онгоцоор" },
  normal: { label: "Энгийн",   desc: "Тэнгисээр" },
  cheap:  { label: "Хямд",     desc: "Удаан" },
};

/** Platform fallback — mirrors the schema defaults (7/14/21 days) and the
 *  legacy DELIVERY_PRICE (15000/8000/0 ₮). */
export const DEFAULT_DELIVERY_OPTIONS: DeliveryOptions = {
  fast:   { enabled: true, value: 7,  unit: "day", price: 15000 },
  normal: { enabled: true, value: 14, unit: "day", price: 8000 },
  cheap:  { enabled: true, value: 21, unit: "day", price: 0 },
};

/** Per-unit sane ceilings — kept in lockstep with the backend sanitiser. */
export const MAX_ETA_BY_UNIT: Record<DeliveryUnit, number> = { hour: 720, day: 365 };

/** Max delivery fee a seller can set (MNT) — mirrors the backend clamp. */
export const MAX_DELIVERY_PRICE = 10_000_000;

/** "2 цаг" / "7 хоног" — the buyer-facing ETA string. */
export function formatEta(value: number, unit: DeliveryUnit): string {
  const v = Math.max(0, Math.round(Number(value) || 0));
  return unit === "hour" ? `${v} цаг` : `${v} хоног`;
}

/** "Үнэгүй" for a free tier, otherwise "₮5,000". */
export function formatDeliveryPrice(price: number): string {
  const p = Math.max(0, Math.round(Number(price) || 0));
  return p === 0 ? "Үнэгүй" : `₮${p.toLocaleString()}`;
}

/** Rough hour-equivalent — handy for sorting / "fastest first" logic. */
export function etaToHours(o: DeliveryOption): number {
  return o.unit === "hour" ? o.value : o.value * 24;
}

/** Clamp a possibly-dirty price into a sane integer MNT amount. */
function coercePrice(raw: unknown, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(MAX_DELIVERY_PRICE, Math.round(n));
}

/** Coerce one possibly-partial tier blob into a complete DeliveryOption. */
function coerceTier(raw: Partial<DeliveryOption> | undefined, fallback: DeliveryOption): DeliveryOption {
  if (!raw || typeof raw.value !== "number" || !Number.isFinite(raw.value)) return { ...fallback };
  return {
    enabled: raw.enabled !== false,
    value: Math.max(0, Math.round(raw.value)),
    unit: raw.unit === "hour" ? "hour" : "day",
    price: coercePrice(raw.price, fallback.price),
  };
}

/**
 * Resolve the delivery durations + prices to SHOW for a product. Priority:
 *   1. seller.sellerProfile.deliveryOptions — the seller's own config (wins)
 *   2. product.deliveryDays — legacy per-product days (smooth migration;
 *      price falls back to the platform default since products never had one)
 *   3. platform DEFAULT_DELIVERY_OPTIONS
 *
 * Always returns a full 3-tier object with every field present, so callers
 * never have to null-check individual tiers.
 */
export function resolveDeliveryOptions(
  seller: SellerSummary | string | null | undefined,
  productDeliveryDays?: Product["deliveryDays"],
): DeliveryOptions {
  const sellerOpts =
    seller && typeof seller === "object" ? seller.sellerProfile?.deliveryOptions : undefined;

  const out = {} as DeliveryOptions;
  for (const tier of DELIVERY_TIER_ORDER) {
    const fromSeller = sellerOpts?.[tier];
    if (fromSeller && typeof fromSeller.value === "number") {
      out[tier] = coerceTier(fromSeller, DEFAULT_DELIVERY_OPTIONS[tier]);
    } else if (productDeliveryDays && typeof productDeliveryDays[tier] === "number") {
      out[tier] = {
        enabled: true,
        value: productDeliveryDays[tier],
        unit: "day",
        price: DEFAULT_DELIVERY_OPTIONS[tier].price,
      };
    } else {
      out[tier] = { ...DEFAULT_DELIVERY_OPTIONS[tier] };
    }
  }
  return out;
}

/** Tiers a buyer can actually pick (enabled), in canonical order. */
export function enabledTiers(opts: DeliveryOptions): DeliveryTierKey[] {
  return DELIVERY_TIER_ORDER.filter((t) => opts[t].enabled);
}

/**
 * The seller's delivery fee (MNT) for one tier — the DISPLAY mirror of the
 * server-authoritative value. Falls back to the platform default when the
 * seller (or their config) is missing. Used by cart/checkout/drawer totals.
 */
export function deliveryPriceFor(
  seller: SellerSummary | string | null | undefined,
  tier: DeliveryTierKey,
): number {
  return resolveDeliveryOptions(seller)[tier].price;
}

/**
 * Fill a possibly-partial config into a COMPLETE 3-tier object — used by
 * the seller settings form to hydrate its initial state from whatever the
 * backend stored (which may be undefined for sellers who never customised).
 */
export function mergeDeliveryOptions(partial?: Partial<DeliveryOptions>): DeliveryOptions {
  const out = {} as DeliveryOptions;
  for (const tier of DELIVERY_TIER_ORDER) {
    out[tier] = coerceTier(partial?.[tier], DEFAULT_DELIVERY_OPTIONS[tier]);
  }
  return out;
}
