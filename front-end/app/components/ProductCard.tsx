"use client";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Product } from "@/app/types";
import { useCartStore, useAuthStore } from "@/store";
import { useWishlistStore } from "@/store/wishlist";
import { toast } from "@/app/lib/toast";
import { openCartDrawer } from "@/app/lib/cartDrawer";
import {
  ShoppingCart, CheckCircle, Package, Heart, Star, Camera, Store,
} from "lucide-react";
import { useState } from "react";

/**
 * ProductCard — Phase R redesign.
 *
 * BEFORE: source chip (Amayama / Partsouq / Local) was the only social
 * signal in the body; the actual seller's identity was invisible. With
 * the Phase P public storefront live, every card NEEDS to surface "who
 * is selling this" so buyers can jump into the seller's shop in one
 * tap — the same pattern Amazon ("Sold by X") / eBay ("X store") use.
 *
 * NEW body grammar:
 *   ┌──────────────────────────────┐
 *   │  Title (2 lines max)         │
 *   │  OEM-CODE                    │
 *   │  ─────────────────────────── │
 *   │  🏪 Shop name      ⭐ 4.8    │  ← clickable seller chip
 *   │  ─────────────────────────── │
 *   │  ₮50,000              [+Sag] │
 *   │  ₮55,000 (struck)            │
 *   └──────────────────────────────┘
 *
 * The source provenance chip (Amayama / Partsouq / Local) moves into
 * the image overlay (top-right under the heart) — it's still discoverable
 * for power users who care about origin, but it doesn't compete with
 * the seller identity in the body.
 *
 * Implementation notes:
 *   • Outer wrapper stays a <Link> to the product detail page so the
 *     entire card is one tap target.
 *   • Seller chip is a <button> + router.push (NOT a nested <Link>) so
 *     we don't emit invalid <a> inside <a> HTML. stopPropagation on
 *     mousedown + click keeps the outer card link from firing.
 *   • p.seller may be SellerSummary | string | null — every branch
 *     handled (string = lean lookup, object = populated, null = legacy
 *     listings without a seller assignment).
 */

const KNOWN_SRC: Record<string, { label: string }> = {
  amayama:  { label: "Amayama" },
  partsouq: { label: "Partsouq" },
  local:    { label: "Local" },
};
const sourceLabel = (s?: string) =>
  KNOWN_SRC[s?.toLowerCase?.() ?? ""]?.label ?? (s || "");

export default function ProductCard({ p }: { p: Product }) {
  const router = useRouter();
  const addItem = useCartStore(s => s.addItem);
  const user = useAuthStore(s => s.user);
  const isFav = useWishlistStore(s => s.ids.has((p._id ?? p.id ?? "")));
  const toggleFav = useWishlistStore(s => s.toggle);
  const [added, setAdded] = useState(false);

  const handleAdd = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!p.inStock) return;
    addItem(p);
    setAdded(true);
    setTimeout(() => setAdded(false), 2000);
    // Phase Y: open the cart drawer instead of just firing a toast.
    // Drawer shows the full cart preview right there so the buyer can
    // decide whether to keep browsing OR checkout WITHOUT leaving the
    // catalogue page — Amazon / Shopee pattern.
    openCartDrawer();
  };
  const handleFav = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!user) {
      toast.warning("Нэвтэрнэ үү", { action: { label: "Нэвтрэх", href: "/auth/login" } });
      return;
    }
    const wasFav = isFav;
    toggleFav((p._id ?? p.id) as string);
    // Optimistic — toggleFav is fire-and-forget API-wise. Show what
    // the user just did so they know it landed.
    toast.success(wasFav ? "Wishlist-аас хасагдлаа" : "Wishlist-д нэмэгдлээ");
  };

  // ── Seller resolution — three possible shapes from the backend ──
  const sellerId = typeof p.seller === "object" && p.seller ? p.seller._id : (typeof p.seller === "string" ? p.seller : undefined);
  const sellerName = typeof p.seller === "object" && p.seller
    ? (p.seller.sellerProfile?.shopName || p.seller.name || "Дэлгүүр")
    : "Дэлгүүр";
  const sellerRating = typeof p.seller === "object" && p.seller
    ? (p.seller.sellerProfile?.rating ?? 0)
    : 0;

  const openSeller = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (sellerId) router.push(`/store/${sellerId}`);
  };

  const srcLabel = sourceLabel(p.source);
  const discount = p.originalPrice && p.originalPrice > p.price
    ? Math.round(100 * (p.originalPrice - p.price) / p.originalPrice)
    : 0;

  return (
    <Link href={`/shop/${p._id ?? p.id}`}
      className="group block bg-white border border-gray-200 rounded-2xl overflow-hidden hover:border-blue-400 hover:shadow-lg hover:shadow-blue-100/50 hover:-translate-y-0.5 transition-all duration-200">

      {/* ── IMAGE AREA ─────────────────────────────────────────── */}
      <div className="relative h-[168px] bg-gradient-to-br from-blue-50/60 to-amber-50/60 flex items-center justify-center group-hover:from-blue-100/80 group-hover:to-amber-100/80 transition-colors overflow-hidden">

        {/* TOP-LEFT: badge OR discount % — never both (price wins if
            both set, so a "PROMO" badge doesn't lie next to a stale %). */}
        {discount > 0 ? (
          <span className="absolute top-2 left-2 bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-md z-10 shadow-sm">
            −{discount}%
          </span>
        ) : p.badge && (
          <span className="absolute top-2 left-2 bg-amber-500 text-white text-[10px] font-semibold px-2 py-0.5 rounded-md z-10 shadow-sm">
            {p.badge}
          </span>
        )}

        {/* TOP-RIGHT: heart + source chip stacked. */}
        <div className="absolute top-1.5 right-1.5 z-10 flex flex-col items-end gap-1">
          <button onClick={handleFav}
            className={`w-7 h-7 flex items-center justify-center rounded-full bg-white/95 hover:bg-white shadow-sm border-none cursor-pointer transition-all ${isFav ? "text-red-500" : "text-gray-300 hover:text-red-400"}`}
            aria-label="favorite">
            <Heart size={14} fill={isFav ? "currentColor" : "none"} />
          </button>
          {srcLabel && (
            <span className="text-[9px] bg-white/90 backdrop-blur text-gray-500 border border-gray-200 px-1.5 py-0.5 rounded-full font-medium shadow-sm">
              {srcLabel}
            </span>
          )}
        </div>

        {/* BOTTOM-LEFT: multi-photo indicator. */}
        {p.images && p.images.length > 1 && (
          <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 bg-black/55 backdrop-blur text-white text-[10px] font-medium px-2 py-0.5 rounded-full z-10">
            <Camera size={9} /> {p.images.length}
          </span>
        )}

        {/* Out-of-stock veil. */}
        {!p.inStock && (
          <div className="absolute inset-0 bg-white/75 flex items-center justify-center z-10">
            <span className="text-[11px] font-medium text-gray-500 border border-gray-300 bg-white px-2.5 py-1 rounded-full shadow-sm">Дууссан</span>
          </div>
        )}

        {/* Image / icon / empty state. */}
        {p.images && p.images.length > 0 ? (
          <Image
            src={p.images[0]}
            alt={p.name}
            fill
            sizes="(max-width: 640px) 50vw, 25vw"
            className="object-contain p-3 transition-transform duration-300 group-hover:scale-105"
          />
        ) : p.iconPath ? (
          <svg className="w-14 h-14 fill-blue-300/80 group-hover:fill-blue-400 transition-colors" viewBox="0 0 24 24"><path d={p.iconPath}/></svg>
        ) : (
          <div className="flex flex-col items-center gap-1.5 border-2 border-dashed border-blue-200 rounded-xl px-5 py-3 bg-white/40">
            <Package className="w-9 h-9 text-blue-300/80" strokeWidth={1.5} />
            <span className="text-[10px] text-gray-400 font-medium">Зураггүй</span>
          </div>
        )}

        <div className="absolute inset-0 ring-1 ring-inset ring-blue-500/0 group-hover:ring-blue-500/15 transition-all pointer-events-none rounded-t-2xl" />
      </div>

      {/* ── BODY ────────────────────────────────────────────────── */}
      <div className="p-3">
        {/* Title + OEM */}
        <div className="text-[13px] font-semibold text-gray-900 mb-0.5 leading-snug line-clamp-2 min-h-[2.5em]">{p.name}</div>
        {p.oem && (
          <div className="text-[10px] text-gray-400 font-mono mb-2 truncate">{p.oem}</div>
        )}

        {/* SELLER CHIP — Phase R: clickable, routes to /store/[id].
            Button (not Link) to avoid nested <a> inside the outer card
            link. stopPropagation prevents double-navigation. Falls back
            to a non-clickable display when sellerId is missing
            (legacy products without a seller assignment). */}
        {sellerId ? (
          <button
            type="button"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={openSeller}
            title={`${sellerName} дэлгүүр рүү очих`}
            className="w-full flex items-center gap-1.5 bg-gray-50 hover:bg-blue-50 border border-gray-100 hover:border-blue-200 rounded-lg px-2 py-1.5 mb-2.5 cursor-pointer transition-colors font-sans">
            <div className="w-5 h-5 rounded-md bg-gradient-to-br from-blue-100 to-amber-100 flex items-center justify-center shrink-0">
              <Store size={10} className="text-blue-700" />
            </div>
            <span className="text-[11px] font-medium text-gray-700 truncate flex-1 text-left">
              {sellerName}
            </span>
            {sellerRating > 0 && (
              <span className="flex items-center gap-0.5 text-[10px] text-amber-600 shrink-0">
                <Star size={9} fill="currentColor" /> {sellerRating.toFixed(1)}
              </span>
            )}
          </button>
        ) : (
          // No-seller fallback (legacy / imported items): show product
          // rating in the same slot so the row never looks empty.
          p.rating !== undefined && p.rating > 0 && (
            <div className="flex items-center gap-1 text-[11px] text-amber-600 mb-2.5 px-2">
              <Star size={10} fill="currentColor" /> {p.rating.toFixed(1)}
              <span className="text-gray-400">({p.ratingCount})</span>
            </div>
          )
        )}

        {/* Price + add-to-cart */}
        <div className="flex items-end justify-between">
          <div className="min-w-0">
            <div className="text-[16px] font-bold text-amber-700 leading-none">
              ₮{p.price.toLocaleString()}
            </div>
            {p.originalPrice && p.originalPrice > p.price && (
              <div className="text-[11px] text-gray-400 line-through mt-0.5">
                ₮{p.originalPrice.toLocaleString()}
              </div>
            )}
          </div>
          <button onClick={handleAdd}
            className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold cursor-pointer border-none transition-all shrink-0 ${
              added ? "bg-emerald-500 text-white" :
              p.inStock ? "bg-blue-700 hover:bg-blue-800 text-white shadow-sm shadow-blue-200" :
              "bg-gray-100 text-gray-400 cursor-not-allowed"
            }`}>
            {added ? <><CheckCircle size={11}/>Нэмсэн</> : p.inStock ? <><ShoppingCart size={11}/>Сагс</> : <><Package size={11}/>Дууссан</>}
          </button>
        </div>
      </div>
    </Link>
  );
}
