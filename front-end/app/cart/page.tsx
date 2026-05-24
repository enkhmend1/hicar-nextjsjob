"use client";
import { useEffect, useState } from "react";
import Image from "next/image";
import { useCartStore } from "@/store";
import Navbar from "@/app/components/Navbar";
import Link from "next/link";
import { Trash2, Plus, Minus, ShoppingCart, ArrowRight, AlertTriangle } from "lucide-react";
import { DELIVERY_PRICE } from "@/lib/data";
import { api } from "@/lib/api";
import { Product, CartItem } from "@/app/types";

const DEL_LABELS = { fast: "Яаралтай", normal: "Энгийн", cheap: "Хямд" };
const pid = (p: Product) => (p._id ?? p.id ?? "") as string;

export default function CartPage() {
  const { items, removeItem, updateQty, updateDelivery, total } = useCartStore();
  const [warnings, setWarnings] = useState<string[]>([]);

  // Sync cart with backend: re-fetch products & remove stale/missing items
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
          // Update price/name if changed
          fresh.push({ product: item, quantity: it.quantity, deliveryType: it.deliveryType });
        } catch {
          messages.push(`"${it.product.name || "Нэргүй бараа"}" — устгагдсан тул хасагдлаа.`);
        }
      }
      if (cancelled) return;
      setWarnings(messages);
      // Apply changes — only if anything actually changed
      const changed = fresh.length !== items.length ||
        fresh.some((f, i) => f.product.price !== items[i]?.product.price);
      if (changed) {
        useCartStore.setState({ items: fresh });
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (items.length === 0) return (
    <>
      <Navbar />
      <div className="min-h-[70vh] flex flex-col items-center justify-center text-center px-6">
        <div className="w-20 h-20 bg-gray-100 rounded-2xl flex items-center justify-center mb-5">
          <ShoppingCart size={36} className="text-gray-300" />
        </div>
        <h2 className="text-[18px] font-semibold text-gray-900 mb-2">Таны сагс хоосон</h2>
        <p className="text-[14px] text-gray-500 mb-6">Дэлгүүрт очиж хайлт хийнэ үү</p>
        {warnings.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 text-[12px] rounded-xl px-3 py-2 mb-4 max-w-sm">
            {warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
          </div>
        )}
        <Link href="/shop" className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl px-6 py-3 text-[14px] font-semibold transition-colors">
          Дэлгүүр үзэх
        </Link>
      </div>
    </>
  );

  const deliveryTotal = items.reduce((s, i) => s + DELIVERY_PRICE[i.deliveryType], 0);

  return (
    <>
      <Navbar />
      <div className="max-w-2xl mx-auto px-5 py-5">
        <h1 className="text-[20px] font-semibold text-gray-900 mb-5">
          Миний сагс
          <span className="text-[15px] text-gray-400 font-normal ml-2">({items.length} бараа)</span>
        </h1>

        {warnings.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 text-[12px] rounded-xl p-3 mb-4 flex items-start gap-2">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              {warnings.map((w, i) => <div key={i}>{w}</div>)}
            </div>
          </div>
        )}

        <div className="space-y-3 mb-5">
          {items.map(item => {
            const id = pid(item.product);
            return (
              <div key={id} className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm hover:shadow-md transition-shadow">
                <div className="flex gap-4 mb-3">
                  {/* Phase O.3: thumbnail 56 → 80px so the buyer
                      actually sees what they're paying for at a glance.
                      object-contain with padding matches the catalogue
                      card treatment (same product → same crop). */}
                  <div className="relative w-20 h-20 bg-gradient-to-br from-blue-50 to-amber-50 rounded-xl flex items-center justify-center shrink-0 overflow-hidden border border-gray-100">
                    {item.product.images && item.product.images.length > 0 ? (
                      <Image src={item.product.images[0]} alt={item.product.name} fill sizes="80px" className="object-contain p-1.5" />
                    ) : item.product.iconPath ? (
                      <svg className="w-9 h-9 fill-blue-400" viewBox="0 0 24 24"><path d={item.product.iconPath} /></svg>
                    ) : (
                      <ShoppingCart size={24} className="text-blue-300" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[14px] font-semibold text-gray-900 line-clamp-2 leading-snug">{item.product.name || "Нэргүй бараа"}</div>
                    <div className="text-[11px] text-gray-400 font-mono mt-0.5">{item.product.oem}</div>
                    {/* Amber price — matches ProductCard treatment. */}
                    <div className="text-[15px] font-bold text-amber-700 mt-1">₮{(item.product.price ?? 0).toLocaleString()}</div>
                  </div>
                  <button onClick={() => removeItem(id)}
                    className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-300 hover:text-red-400 hover:bg-red-50 transition-colors cursor-pointer bg-transparent border-none shrink-0">
                    <Trash2 size={15} />
                  </button>
                </div>

                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex gap-1">
                    {(["fast", "normal", "cheap"] as const).map(d => (
                      <button key={d} onClick={() => updateDelivery(id, d)}
                        className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold cursor-pointer border-2 transition-all font-sans ${
                          item.deliveryType === d
                            ? "border-blue-500 bg-blue-50 text-blue-700"
                            : "border-gray-200 text-gray-400 hover:border-blue-300"
                        }`}>
                        {DEL_LABELS[d]}
                        <span className="ml-1 opacity-60">
                          {DELIVERY_PRICE[d] === 0 ? "Free" : `₮${(DELIVERY_PRICE[d] / 1000).toFixed(0)}K`}
                        </span>
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-0 border-2 border-gray-200 rounded-xl overflow-hidden">
                    <button onClick={() => updateQty(id, item.quantity - 1)}
                      className="w-8 h-8 flex items-center justify-center text-gray-500 hover:text-blue-600 hover:bg-blue-50 cursor-pointer bg-transparent border-none transition-colors">
                      <Minus size={13} />
                    </button>
                    <span className="text-[14px] font-semibold text-gray-900 w-8 text-center">{item.quantity}</span>
                    <button onClick={() => updateQty(id, item.quantity + 1)}
                      className="w-8 h-8 flex items-center justify-center text-gray-500 hover:text-blue-600 hover:bg-blue-50 cursor-pointer bg-transparent border-none transition-colors">
                      <Plus size={13} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
          <h3 className="text-[14px] font-semibold text-gray-900 mb-3">Захиалгын дүн</h3>
          <div className="space-y-2 mb-4">
            {items.map(i => (
              <div key={pid(i.product)} className="flex justify-between text-[13px] text-gray-500">
                <span className="truncate mr-4 flex-1">{i.product.name} ×{i.quantity}</span>
                <span className="shrink-0 font-medium">₮{((i.product.price ?? 0) * i.quantity).toLocaleString()}</span>
              </div>
            ))}
            <div className="flex justify-between text-[13px] text-gray-500 pt-2 border-t border-gray-100">
              <span>Хүргэлт</span>
              <span className="font-medium">{deliveryTotal === 0 ? "Үнэгүй" : `₮${deliveryTotal.toLocaleString()}`}</span>
            </div>
          </div>
          <div className="flex justify-between text-[16px] font-bold text-gray-900 pt-3 border-t-2 border-gray-200 mb-4">
            <span>Нийт дүн</span>
            <span className="text-blue-600">₮{total().toLocaleString()}</span>
          </div>
          <Link href="/checkout"
            className="flex items-center justify-center gap-2 w-full bg-blue-600 hover:bg-blue-700 text-white rounded-xl py-3.5 text-[15px] font-semibold transition-colors shadow-lg shadow-blue-200"
           >
            Захиалга үргэлжлүүлэх <ArrowRight size={16} />
          </Link>
          <Link href="/shop" className="block text-center text-[13px] text-gray-400 hover:text-blue-600 mt-3 transition-colors">
            ← Дэлгүүр рүү буцах
          </Link>
        </div>
      </div>
    </>
  );
}
