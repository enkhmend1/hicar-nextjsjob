"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Navbar from "@/app/components/Navbar";
import ProductCard from "@/app/components/ProductCard";
import { useAuthStore } from "@/store";
import { useWishlistStore } from "@/store/wishlist";
import { api } from "@/lib/api";
import { Product } from "@/app/types";
import { Heart } from "lucide-react";

export default function WishlistPage() {
  const router = useRouter();
  const { user, _hasHydrated } = useAuthStore();
  const ids = useWishlistStore(s => s.ids);
  const [items, setItems] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!_hasHydrated) return;
    if (!user) { router.replace("/auth/login"); return; }
    let cancelled = false;
    (async () => {
      try {
        const { items } = await api.get<{ items: Product[] }>("/wishlist");
        if (!cancelled) setItems(items);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user, _hasHydrated, router, ids]);

  if (!_hasHydrated || !user) return null;

  return (
    <>
      <Navbar />
      <div className="max-w-6xl mx-auto px-5 py-6">
        <header className="mb-6">
          <h1 className="text-[22px] font-semibold text-gray-900 flex items-center gap-2">
            <Heart size={20} className="text-red-500" fill="currentColor" /> Хадгалсан бараа
          </h1>
          <p className="text-[13px] text-gray-500 mt-0.5">{items.length} бараа</p>
        </header>

        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="bg-white border border-gray-200 rounded-xl h-[220px] animate-pulse" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-20">
            <Heart size={48} className="mx-auto text-gray-200 mb-3" />
            <p className="text-[15px] font-medium text-gray-700 mb-1">Хадгалсан бараа байхгүй</p>
            <p className="text-[13px] text-gray-400 mb-5">Дэлгүүрээс таалагдсан бараагаа ❤️ дарж хадгална уу</p>
            <Link href="/shop" className="inline-block bg-blue-600 hover:bg-blue-700 text-white rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-colors">
              Дэлгүүр үзэх
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {items.map(p => <ProductCard key={p._id ?? p.id} p={p} />)}
          </div>
        )}
      </div>
    </>
  );
}
