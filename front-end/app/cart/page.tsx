"use client";

/**
 * Cart page — Phase S redesign.
 *
 * Items grouped by seller (Amazon / eBay multi-seller cart pattern).
 * Each group card has:
 *
 *   ┌─ Sold by [LOGO] Shop Name (3 items)         [Visit shop →] ─┐
 *   │  ─────────────────────────────────────────────────────────  │
 *   │  Product row 1                                              │
 *   │  Product row 2                                              │
 *   │  Product row 3                                              │
 *   │  ─────────────────────────────────────────────────────────  │
 *   │  Хүргэлт      ₮5,000                                        │
 *   │  Дэд дүн      ₮145,000                                      │
 *   └─────────────────────────────────────────────────────────────┘
 *
 * Why this matters:
 *   • Visual grouping reveals the marketplace nature — buyer sees
 *     they're paying THREE sellers, not one mystery vendor.
 *   • Per-seller shipping subtotal is explicit (was buried in the
 *     grand total before).
 *   • Disputes are scoped per seller — grouping prepares the UI for
 *     the eventual "Refund just this seller's items" flow.
 *   • Single-seller carts collapse gracefully — header still shows but
 *     reads naturally as "Sold by X".
 *
 * Items without a seller (legacy listings / data migration leftovers)
 * collect into an "Бусад" bucket so they're not dropped.
 */

import { useEffect, useMemo, useState } from "react";
import { tierUnitPrice } from "@/app/lib/price";
import Image from "next/image";
import Link from "next/link";
import { useCartStore } from "@/store";
import BuyerShell from "@/app/components/BuyerShell";
import {
  Trash2, Plus, Minus, ShoppingCart, ArrowRight, AlertTriangle, Store,
  ChevronRight, Package,
} from "lucide-react";
import { deliveryPriceFor, resolveDeliveryOptions, enabledTiers } from "@/app/lib/delivery";
import { api } from "@/lib/api";
import { Product, CartItem } from "@/app/types";

const DEL_LABELS = { fast: "Яаралтай", normal: "Энгийн", cheap: "Хямд" };
/** Compact price for the narrow cart tier buttons: "Үнэгүй" / "₮15K" / "₮5,500". */
const compactDeliveryPrice = (n: number) =>
  n === 0 ? "Үнэгүй" : n % 1000 === 0 ? `₮${n / 1000}K` : `₮${n.toLocaleString()}`;
const pid = (p: Product) => (p._id ?? p.id ?? "") as string;

// ─────────────────────────────────────────────────────────────────
// Seller grouping helpers
// ─────────────────────────────────────────────────────────────────

const NO_SELLER_KEY = "__no_seller__";

interface SellerGroup {
  sellerId: string;     // NO_SELLER_KEY for legacy/orphan items
  shopName: string;
  logo:     string;
  items:    CartItem[];
  subtotal: number;     // products × qty
  delivery: number;     // sum of delivery for this group's items
}

/** Resolve seller identity from a CartItem.product.seller field. The
 *  populated shape (SellerSummary), the lean string id, and null all
 *  produce a stable group key. */
const sellerOf = (it: CartItem): { id: string; shopName: string; logo: string } => {
  const s = it.product.seller;
  if (s && typeof s === "object") {
    return {
      id:       s._id ?? NO_SELLER_KEY,
      shopName: s.sellerProfile?.shopName || s.name || "Дэлгүүр",
      logo:     s.sellerProfile?.logo || "",
    };
  }
  if (typeof s === "string" && s) {
    return { id: s, shopName: "Дэлгүүр", logo: "" };
  }
  return { id: NO_SELLER_KEY, shopName: "Бусад", logo: "" };
};

const groupBySeller = (items: CartItem[]): SellerGroup[] => {
  const map = new Map<string, SellerGroup>();
  for (const it of items) {
    const meta = sellerOf(it);
    const itemSubtotal = tierUnitPrice(it.product, it.quantity) * it.quantity;
    const itemDelivery = deliveryPriceFor(it.product.seller, it.deliveryType);
    const existing = map.get(meta.id);
    if (existing) {
      existing.items.push(it);
      existing.subtotal += itemSubtotal;
      existing.delivery += itemDelivery;
    } else {
      map.set(meta.id, {
        sellerId: meta.id,
        shopName: meta.shopName,
        logo:     meta.logo,
        items:    [it],
        subtotal: itemSubtotal,
        delivery: itemDelivery,
      });
    }
  }
  // Stable order: larger subtotals first, "Бусад" always at the end.
  return Array.from(map.values()).sort((a, b) => {
    if (a.sellerId === NO_SELLER_KEY) return 1;
    if (b.sellerId === NO_SELLER_KEY) return -1;
    return b.subtotal - a.subtotal;
  });
};

// ─────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────

export default function CartPage() {
  const { items, removeItem, updateQty, updateDelivery, total } = useCartStore();
  const [warnings, setWarnings] = useState<string[]>([]);

  // Sync cart with backend on mount: re-fetch every product so stale
  // prices update + sold-out items drop. (Unchanged from before — the
  // grouping pass below is purely render-time.)
  useEffect(() => {
    if (items.length === 0) return;
    let cancelled = false;
    (async () => {
      const messages: string[] = [];
      const fresh: CartItem[] = [];
      for (const it of items) {
        const id = pid(it.product);
        if (!id) continue;
        try {
          const { item } = await api.get<{ item: Product }>(`/products/${id}`);
          if (!item.inStock) {
            messages.push(`"${item.name}" — нөөцөд байхгүй. Сагснаас хасагдлаа.`);
            continue;
          }
          fresh.push({ product: item, quantity: it.quantity, deliveryType: it.deliveryType });
        } catch {
          messages.push(`"${it.product.name || "Нэргүй бараа"}" — устгагдсан тул хасагдлаа.`);
        }
      }
      if (cancelled) return;
      setWarnings(messages);
      const changed = fresh.length !== items.length ||
        fresh.some((f, i) => f.product.price !== items[i]?.product.price);
      if (changed) {
        useCartStore.setState({ items: fresh });
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const groups = useMemo(() => groupBySeller(items), [items]);
  const sellerCount = groups.length;
  const deliveryTotal = items.reduce((s, i) => s + deliveryPriceFor(i.product.seller, i.deliveryType), 0);

  // ── EMPTY STATE ──────────────────────────────────────────────────
  if (items.length === 0) {
    return (
      <BuyerShell>
        <div className="min-h-[70vh] flex flex-col items-center justify-center text-center px-6">
          <div className="w-20 h-20 bg-gray-100 rounded-2xl flex items-center justify-center mb-5">
            <ShoppingCart size={36} className="text-gray-300" />
          </div>
          <h2 className="text-[18px] font-semibold text-gray-900 mb-2">Таны сагс хоосон</h2>
          <p className="text-[14px] text-gray-500 mb-6">Сэлбэгүүд рүү очиж хайлт хийнэ үү</p>
          {warnings.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 text-amber-800 text-[12px] rounded-xl px-3 py-2 mb-4 max-w-sm">
              {warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
            </div>
          )}
          <Link href="/shop" className="bg-blue-700 hover:bg-blue-800 text-white rounded-xl px-6 py-3 text-[14px] font-semibold transition-colors">
            Сэлбэгүүд үзэх
          </Link>
        </div>
      </BuyerShell>
    );
  }

  return (
    <BuyerShell>
      <div className="max-w-3xl mx-auto px-5 py-5">
        <div className="flex items-baseline justify-between mb-5">
          <h1 className="text-[20px] font-semibold text-gray-900">
            Миний сагс
            <span className="text-[14px] text-gray-500 font-normal ml-2">
              {items.length} бараа · {sellerCount} зарагч
            </span>
          </h1>
        </div>

        {warnings.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 text-[12px] rounded-xl p-3 mb-4 flex items-start gap-2">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              {warnings.map((w, i) => <div key={i}>{w}</div>)}
            </div>
          </div>
        )}

        {/* ─── SELLER GROUPS ──────────────────────────────────── */}
        <div className="space-y-4 mb-5">
          {groups.map((g) => (
            <SellerGroupCard
              key={g.sellerId}
              group={g}
              onRemove={removeItem}
              onQty={updateQty}
              onDelivery={updateDelivery}
            />
          ))}
        </div>

        {/* ─── GRAND TOTAL ────────────────────────────────────── */}
        <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
          <h3 className="text-[14px] font-semibold text-gray-900 mb-3 flex items-center justify-between">
            <span>Захиалгын дүн</span>
            {sellerCount > 1 && (
              <span className="text-[11px] text-gray-500 font-normal">{sellerCount} зарагчид хуваагдана</span>
            )}
          </h3>
          <div className="space-y-2 mb-4">
            {/* Per-group line so the total breaks down cleanly. */}
            {groups.map((g) => (
              <div key={g.sellerId} className="flex justify-between text-[13px] text-gray-500">
                <span className="truncate mr-4 flex-1">
                  {g.shopName} ({g.items.length} бараа)
                </span>
                <span className="shrink-0 font-medium">
                  ₮{(g.subtotal + g.delivery).toLocaleString()}
                </span>
              </div>
            ))}
            <div className="flex justify-between text-[13px] text-gray-500 pt-2 border-t border-gray-100">
              <span>Нийт хүргэлт</span>
              <span className="font-medium">{deliveryTotal === 0 ? "Үнэгүй" : `₮${deliveryTotal.toLocaleString()}`}</span>
            </div>
          </div>
          <div className="flex justify-between text-[16px] font-bold text-gray-900 pt-3 border-t-2 border-gray-200 mb-4">
            <span>Нийт дүн</span>
            <span className="text-amber-700">₮{total().toLocaleString()}</span>
          </div>
          <Link href="/checkout"
            className="flex items-center justify-center gap-2 w-full bg-blue-700 hover:bg-blue-800 text-white rounded-xl py-3.5 text-[15px] font-semibold transition-colors shadow-lg shadow-blue-200">
            Захиалга үргэлжлүүлэх <ArrowRight size={16} />
          </Link>
          <Link href="/shop" className="block text-center text-[13px] text-gray-500 hover:text-blue-700 mt-3 transition-colors">
            ← Сэлбэгүүд рүү буцах
          </Link>
        </div>
      </div>
    </BuyerShell>
  );
}

// ─────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────

interface SellerGroupProps {
  group: SellerGroup;
  onRemove:   (id: string) => void;
  onQty:      (id: string, n: number) => void;
  onDelivery: (id: string, d: CartItem["deliveryType"]) => void;
}
function SellerGroupCard({ group, onRemove, onQty, onDelivery }: SellerGroupProps) {
  const isOrphan = group.sellerId === NO_SELLER_KEY;
  return (
    <section className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
      {/* GROUP HEADER — sticky-feeling band with avatar + shop name */}
      <header className="flex items-center justify-between gap-3 px-4 py-3 bg-gradient-to-r from-blue-50/50 to-amber-50/30 border-b border-gray-100">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-100 to-amber-100 flex items-center justify-center overflow-hidden shrink-0 ring-2 ring-white">
            {group.logo ? (
              <Image src={group.logo} alt="" width={32} height={32} className="object-cover w-full h-full" unoptimized />
            ) : (
              <Store size={14} className="text-blue-700" />
            )}
          </div>
          <div className="min-w-0">
            <div className="text-[11px] text-blue-700 font-semibold uppercase tracking-wider leading-none">
              {isOrphan ? "Бусад" : "Зарагч"}
            </div>
            <div className="text-[14px] font-semibold text-gray-900 truncate leading-tight">
              {group.shopName}
              <span className="text-[11px] text-gray-500 font-normal ml-1.5">
                ({group.items.length} бараа)
              </span>
            </div>
          </div>
        </div>
        {!isOrphan && (
          <Link href={`/store/${group.sellerId}`}
            className="inline-flex items-center gap-0.5 text-[12px] text-blue-700 hover:text-blue-800 font-medium transition-colors shrink-0">
            Дэлгүүр үзэх <ChevronRight size={12} />
          </Link>
        )}
      </header>

      {/* ITEM ROWS */}
      <div className="divide-y divide-gray-100">
        {group.items.map((item) => (
          <CartItemRow
            key={pid(item.product)}
            item={item}
            onRemove={onRemove}
            onQty={onQty}
            onDelivery={onDelivery}
          />
        ))}
      </div>

      {/* PER-GROUP SUBTOTAL */}
      <div className="px-4 py-3 bg-gray-50/60 border-t border-gray-100">
        <div className="flex justify-between text-[12px] text-gray-500">
          <span>Хүргэлт</span>
          <span className="font-medium">
            {group.delivery === 0 ? "Үнэгүй" : `₮${group.delivery.toLocaleString()}`}
          </span>
        </div>
        <div className="flex justify-between text-[13px] font-semibold text-gray-900 mt-1">
          <span>Дэд дүн</span>
          <span className="text-amber-700">₮{(group.subtotal + group.delivery).toLocaleString()}</span>
        </div>
      </div>
    </section>
  );
}

interface RowProps {
  item: CartItem;
  onRemove:   (id: string) => void;
  onQty:      (id: string, n: number) => void;
  onDelivery: (id: string, d: CartItem["deliveryType"]) => void;
}
function CartItemRow({ item, onRemove, onQty, onDelivery }: RowProps) {
  const id = pid(item.product);
  // Phase AV: tiers + prices come from THIS item's seller config. Show only
  // the tiers the seller offers, but always keep the current selection
  // visible (in case the seller disabled it after the item was added).
  const opts = resolveDeliveryOptions(item.product.seller);
  const offered = enabledTiers(opts);
  const shownTiers = offered.includes(item.deliveryType)
    ? offered
    : [item.deliveryType, ...offered];
  return (
    <div className="p-4">
      <div className="flex gap-4 mb-3">
        <div className="relative w-20 h-20 bg-gradient-to-br from-blue-50 to-amber-50 rounded-xl flex items-center justify-center shrink-0 overflow-hidden border border-gray-100">
          {item.product.images && item.product.images.length > 0 ? (
            <Image src={item.product.images[0]} alt={item.product.name} fill sizes="80px" className="object-contain p-1.5" />
          ) : item.product.iconPath ? (
            <svg className="w-9 h-9 fill-blue-400" viewBox="0 0 24 24"><path d={item.product.iconPath} /></svg>
          ) : (
            <Package size={24} className="text-blue-300" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[14px] font-semibold text-gray-900 line-clamp-2 leading-snug">
            {item.product.name || "Нэргүй бараа"}
          </div>
          {item.product.oem && (
            <div className="text-[11px] text-gray-500 font-mono mt-0.5">{item.product.oem}</div>
          )}
          <div className="text-[15px] font-bold text-amber-700 mt-1">
            ₮{tierUnitPrice(item.product, item.quantity).toLocaleString()}
          </div>
        </div>
        <button onClick={() => onRemove(id)}
          className="w-9 h-9 flex items-center justify-center rounded-lg text-gray-500 hover:text-red-500 hover:bg-red-50 transition-colors cursor-pointer bg-transparent border-none shrink-0">
          <Trash2 size={15} />
        </button>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-1 flex-wrap">
          {shownTiers.map((d) => (
            <button key={d} onClick={() => onDelivery(id, d)}
              className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold cursor-pointer border-2 transition-all font-sans ${
                item.deliveryType === d
                  ? "border-blue-500 bg-blue-50 text-blue-700"
                  : "border-gray-200 text-gray-600 hover:border-blue-300"
              }`}>
              {DEL_LABELS[d]}
              <span className="ml-1 opacity-80">{compactDeliveryPrice(opts[d].price)}</span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-0 border-2 border-gray-200 rounded-xl overflow-hidden">
          <button onClick={() => onQty(id, item.quantity - 1)}
            className="w-9 h-9 flex items-center justify-center text-gray-500 hover:text-blue-600 hover:bg-blue-50 cursor-pointer bg-transparent border-none transition-colors">
            <Minus size={13} />
          </button>
          <span className="text-[14px] font-semibold text-gray-900 w-8 text-center">{item.quantity}</span>
          <button onClick={() => onQty(id, item.quantity + 1)}
            className="w-9 h-9 flex items-center justify-center text-gray-500 hover:text-blue-600 hover:bg-blue-50 cursor-pointer bg-transparent border-none transition-colors">
            <Plus size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}
