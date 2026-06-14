"use client";

/**
 * CartDrawer — Phase Y.
 *
 * Right-slide panel that opens after add-to-cart so the buyer can
 * peek + checkout without leaving /shop. Closes via:
 *   • Backdrop click
 *   • ESC key
 *   • Close (×) button
 *   • Clicking the "Үргэлжлүүлэн харах" button at the bottom
 *
 * Body scroll is locked while open (overflow-hidden on <body>) so the
 * underlying page doesn't scroll under the drawer.
 *
 * Content:
 *   • Header: "Сагс · N бараа · M зарагч"
 *   • Item rows grouped by seller (mini-version of the full /cart
 *     groupBySeller — avatar + shop name + items with qty controls)
 *   • Sticky footer: subtotal, "Худалдан авах" → /checkout, secondary
 *     "Үргэлжлүүлэн харах" close
 *
 * Width: 380px desktop, full-width on mobile.
 * z-index higher than MobileBottomNav (z-40) so it covers correctly.
 */

import { useEffect, useMemo } from "react";
import { tierUnitPrice } from "@/app/lib/price";
import Image from "next/image";
import Link from "next/link";
import { useCartStore } from "@/store";
import { useCartDrawer } from "@/app/lib/cartDrawer";
import { useBackClose } from "@/app/lib/useBackClose";
import { deliveryPriceFor } from "@/app/lib/delivery";
import { CartItem, Product } from "@/app/types";
import {
  X, ShoppingCart, Store, Plus, Minus, Trash2, ArrowRight, Package,
} from "lucide-react";

const pid = (p: Product) => (p._id ?? p.id ?? "") as string;
const NO_SELLER = "__no_seller__";

interface DrawerGroup {
  sellerId: string;
  shopName: string;
  logo:     string;
  items:    CartItem[];
}
const groupBySeller = (items: CartItem[]): DrawerGroup[] => {
  const map = new Map<string, DrawerGroup>();
  for (const it of items) {
    const s = it.product.seller;
    let key = NO_SELLER, shopName = "Бусад", logo = "";
    if (s && typeof s === "object") {
      key = s._id ?? NO_SELLER;
      shopName = s.sellerProfile?.shopName || s.name || "Дэлгүүр";
      logo     = s.sellerProfile?.logo || "";
    } else if (typeof s === "string" && s) {
      key = s; shopName = "Дэлгүүр";
    }
    const existing = map.get(key);
    if (existing) existing.items.push(it);
    else map.set(key, { sellerId: key, shopName, logo, items: [it] });
  }
  // Keep insertion order — most-recently-added items end up at top.
  return Array.from(map.values());
};

export default function CartDrawer() {
  const open    = useCartDrawer((s) => s.open);
  const set     = useCartDrawer((s) => s.set);
  const items   = useCartStore((s) => s.items);
  const removeItem    = useCartStore((s) => s.removeItem);
  const updateQty     = useCartStore((s) => s.updateQty);
  const total         = useCartStore((s) => s.total);

  // ── ESC to close + body scroll lock ────────────────────────────
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") set(false); };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, set]);

  // Phone / browser BACK button closes the drawer instead of leaving /shop.
  useBackClose(open, () => set(false));

  const groups = useMemo(() => groupBySeller(items), [items]);
  const itemCount   = items.reduce((s, i) => s + i.quantity, 0);
  const sellerCount = groups.length;
  const deliveryTotal = items.reduce((s, i) => s + deliveryPriceFor(i.product.seller, i.deliveryType), 0);

  // Don't render the DOM when closed — saves the body-scroll listeners.
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[55]" role="dialog" aria-modal="true" aria-label="Сагс">
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Хаах"
        onClick={() => set(false)}
        className="absolute inset-0 bg-black/40 backdrop-blur-[1px] cursor-pointer border-none animate-in fade-in duration-150"
      />

      {/* Panel — anchored to the right edge. */}
      <aside className="absolute right-0 top-0 h-full w-full sm:w-[420px] bg-white shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
        {/* HEADER */}
        <header className="flex items-center justify-between px-4 h-14 border-b border-gray-200 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-700 flex items-center justify-center">
              <ShoppingCart size={15} />
            </div>
            <div className="min-w-0">
              <div className="text-[14px] font-semibold text-gray-900 leading-tight">Сагс</div>
              {itemCount > 0 && (
                <div className="text-[10px] text-gray-500 leading-tight">
                  {itemCount} бараа · {sellerCount} зарагч
                </div>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => set(false)}
            aria-label="Хаах"
            className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 cursor-pointer bg-transparent border-none transition-colors"
          >
            <X size={17} />
          </button>
        </header>

        {/* BODY — scrollable. */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {items.length === 0 ? (
            <EmptyState onClose={() => set(false)} />
          ) : (
            groups.map((g) => (
              <section key={g.sellerId} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                {/* Group header (compact version of cart page's). */}
                <header className="flex items-center gap-2 px-3 py-2 bg-gradient-to-r from-blue-50/40 to-amber-50/30 border-b border-gray-100">
                  <div className="w-6 h-6 rounded-md bg-gradient-to-br from-blue-100 to-amber-100 flex items-center justify-center overflow-hidden shrink-0">
                    {g.logo
                      ? <Image src={g.logo} alt="" width={24} height={24} className="object-cover w-full h-full" unoptimized />
                      : <Store size={11} className="text-blue-700" />}
                  </div>
                  <div className="text-[12px] font-medium text-gray-700 truncate flex-1">{g.shopName}</div>
                  <span className="text-[10px] text-gray-500">{g.items.length}</span>
                </header>

                {/* Items */}
                <div className="divide-y divide-gray-100">
                  {g.items.map((it) => {
                    const id = pid(it.product);
                    return (
                      <div key={id} className="p-2.5 flex gap-2.5 items-start">
                        {/* Thumb */}
                        <div className="relative w-12 h-12 bg-gradient-to-br from-blue-50 to-amber-50 rounded-lg flex items-center justify-center shrink-0 overflow-hidden border border-gray-100">
                          {it.product.images?.[0]
                            ? <Image src={it.product.images[0]} alt={it.product.name} fill sizes="48px" className="object-contain p-1" />
                            : <Package size={16} className="text-blue-300" />}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="text-[12px] font-medium text-gray-900 line-clamp-2 leading-snug">
                            {it.product.name || "Нэргүй бараа"}
                          </div>
                          <div className="text-[12px] font-semibold text-amber-700 mt-0.5">
                            ₮{tierUnitPrice(it.product, it.quantity).toLocaleString()}
                          </div>

                          {/* Qty stepper + delete on the row */}
                          <div className="flex items-center justify-between gap-2 mt-1.5">
                            <div className="inline-flex items-center border border-gray-200 rounded-md overflow-hidden">
                              <button onClick={() => updateQty(id, it.quantity - 1)}
                                className="w-8 h-8 inline-flex items-center justify-center text-gray-600 hover:bg-gray-50 cursor-pointer bg-transparent border-none">
                                <Minus size={12} />
                              </button>
                              <span className="text-[11px] font-semibold w-6 text-center">{it.quantity}</span>
                              <button onClick={() => updateQty(id, it.quantity + 1)}
                                className="w-8 h-8 inline-flex items-center justify-center text-gray-600 hover:bg-gray-50 cursor-pointer bg-transparent border-none">
                                <Plus size={12} />
                              </button>
                            </div>
                            <button onClick={() => removeItem(id)}
                              aria-label="Устгах"
                              className="w-8 h-8 inline-flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 cursor-pointer bg-transparent border-none rounded">
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))
          )}
        </div>

        {/* FOOTER — only when there's something in the cart. */}
        {items.length > 0 && (
          <footer className="border-t border-gray-200 bg-white px-4 py-3 space-y-2.5 shrink-0">
            <div className="flex justify-between text-[12px] text-gray-500">
              <span>Хүргэлт</span>
              <span className="font-medium">
                {deliveryTotal === 0 ? "Үнэгүй" : `₮${deliveryTotal.toLocaleString()}`}
              </span>
            </div>
            <div className="flex justify-between text-[15px] font-bold text-gray-900 pt-2 border-t border-gray-100">
              <span>Нийт дүн</span>
              <span className="text-amber-700">₮{total().toLocaleString()}</span>
            </div>

            <Link
              href="/checkout"
              onClick={() => set(false)}
              className="flex items-center justify-center gap-2 w-full bg-blue-700 hover:bg-blue-800 text-white rounded-xl py-3 text-[14px] font-semibold transition-colors shadow-sm shadow-blue-200"
            >
              Худалдан авах <ArrowRight size={14} />
            </Link>
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => set(false)}
                className="flex-1 text-[12px] text-gray-500 hover:text-blue-700 py-1.5 cursor-pointer bg-transparent border-none font-sans"
              >
                ← Үргэлжлүүлэн харах
              </button>
              <Link
                href="/cart"
                onClick={() => set(false)}
                className="text-[12px] text-gray-500 hover:text-blue-700"
              >
                Бүтэн сагс →
              </Link>
            </div>
          </footer>
        )}
      </aside>
    </div>
  );
}

function EmptyState({ onClose }: { onClose: () => void }) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center px-6 py-12">
      <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mb-3">
        <ShoppingCart size={28} className="text-gray-300" />
      </div>
      <p className="text-[14px] font-medium text-gray-700 mb-1">Сагс хоосон</p>
      <p className="text-[12px] text-gray-400 mb-4">
        Сэлбэгүүд рүү очиж хайна уу
      </p>
      <Link
        href="/shop"
        onClick={onClose}
        className="bg-blue-700 hover:bg-blue-800 text-white rounded-xl px-4 py-2 text-[13px] font-semibold transition-colors"
      >
        Сэлбэгүүд үзэх
      </Link>
    </div>
  );
}
