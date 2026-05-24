"use client";
import Link from "next/link";
import Image from "next/image";
import { Product } from "@/app/types";
import { useCartStore, useAuthStore } from "@/store";
import { useWishlistStore } from "@/store/wishlist";
import { ShoppingCart, CheckCircle, Package, Heart, Star } from "lucide-react";
import { useState } from "react";

const KNOWN_SRC: Record<string, { label: string; color: string }> = {
  amayama:  { label: "Amayama JP",       color: "text-blue-600 bg-blue-50 border-blue-100" },
  partsouq: { label: "Partsouq UAE",     color: "text-emerald-600 bg-emerald-50 border-emerald-100" },
  local:    { label: "Монгол дэлгүүр",  color: "text-orange-600 bg-orange-50 border-orange-100" },
};
const srcMeta = (s: string) =>
  KNOWN_SRC[s?.toLowerCase?.()] ?? { label: s || "—", color: "text-gray-600 bg-gray-50 border-gray-200" };

export default function ProductCard({ p }: { p: Product }) {
  const addItem = useCartStore(s => s.addItem);
  const user = useAuthStore(s => s.user);
  const isFav = useWishlistStore(s => s.ids.has((p._id ?? p.id ?? "")));
  const toggleFav = useWishlistStore(s => s.toggle);
  const [added, setAdded] = useState(false);
  const handleAdd = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!p.inStock) return;
    addItem(p);
    setAdded(true);
    setTimeout(() => setAdded(false), 2000);
  };
  const handleFav = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!user) { window.location.href = "/auth/login"; return; }
    toggleFav((p._id ?? p.id) as string);
  };
  const src = srcMeta(p.source);

  return (
    <Link href={`/shop/${p._id ?? p.id}`}
      className="group block bg-white border border-gray-200 rounded-xl overflow-hidden hover:border-blue-400 hover:shadow-lg hover:shadow-blue-100/50 transition-all duration-200">
      {/* Phase N: image background is now blue↔amber (matches the new
          palette) instead of the leftover blue↔purple. Subtle, so the
          actual product image still dominates. */}
      <div className="relative h-[96px] bg-gradient-to-br from-blue-50 to-amber-50 flex items-center justify-center group-hover:from-blue-100 group-hover:to-amber-100 transition-colors overflow-hidden">
        {p.badge && (
          <span className="absolute top-2 left-2 bg-amber-500 text-white text-[10px] font-semibold px-2 py-0.5 rounded-md z-10 shadow-sm">{p.badge}</span>
        )}
        <button onClick={handleFav}
          className={`absolute top-1.5 right-1.5 w-7 h-7 flex items-center justify-center rounded-full bg-white/90 hover:bg-white shadow-sm border-none cursor-pointer z-10 transition-all ${isFav ? "text-red-500" : "text-gray-300 hover:text-red-400"}`}
          aria-label="favorite">
          <Heart size={14} fill={isFav ? "currentColor" : "none"} />
        </button>
        {!p.inStock && (
          <div className="absolute inset-0 bg-white/70 flex items-center justify-center z-10">
            <span className="text-[11px] font-medium text-gray-400 border border-gray-300 bg-white px-2.5 py-1 rounded-full">Дууссан</span>
          </div>
        )}
        {p.images && p.images.length > 0 ? (
          <Image src={p.images[0]} alt={p.name} fill sizes="(max-width: 640px) 50vw, 25vw" className="object-cover" />
        ) : p.iconPath ? (
          <svg className="w-10 h-10 fill-blue-400 group-hover:fill-blue-500 transition-colors" viewBox="0 0 24 24"><path d={p.iconPath}/></svg>
        ) : (
          <Package className="w-8 h-8 text-blue-300" />
        )}
      </div>
      {/* Body */}
      <div className="p-3">
        <div className="text-[12px] font-semibold text-gray-900 mb-1 leading-snug line-clamp-2">{p.name}</div>
        <div className="text-[10px] text-gray-400 font-mono mb-2">{p.oem}</div>
        <div className="flex items-center gap-1.5 mb-2">
          <span className={`inline-flex text-[10px] font-medium px-1.5 py-0.5 rounded border ${src.color}`}>{src.label}</span>
          {p.rating !== undefined && p.rating > 0 && (
            <span className="flex items-center gap-0.5 text-[10px] text-amber-500 font-semibold">
              <Star size={9} fill="currentColor" /> {p.rating.toFixed(1)}
              <span className="text-gray-400 font-normal">({p.ratingCount})</span>
            </span>
          )}
        </div>
        <div className="flex items-end justify-between mt-1">
          <div>
            {/* Phase N: price is the single most important number on
                the card — promoted to amber-700 (darker, weightier than
                the previous blue) so it stays the visual anchor even
                surrounded by other blue chrome. */}
            <div className="text-[15px] font-bold text-amber-700">₮{p.price.toLocaleString()}</div>
            {p.originalPrice && <div className="text-[11px] text-gray-400 line-through">₮{p.originalPrice.toLocaleString()}</div>}
          </div>
          <button onClick={handleAdd}
            className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold cursor-pointer border-none transition-all ${
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
