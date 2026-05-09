"use client";
import { useCartStore } from "@/store";
import Navbar from "@/app/components/Navbar";
import Link from "next/link";
import { Trash2, Plus, Minus, ShoppingCart, ArrowRight } from "lucide-react";
import { DELIVERY_PRICE } from "@/lib/data";

const DEL_LABELS = { fast: "Яаралтай", normal: "Энгийн", cheap: "Хямд" };

export default function CartPage() {
  const { items, removeItem, updateQty, updateDelivery, total } = useCartStore();

  if (items.length === 0) return (
    <>
      <Navbar />
      <div className="min-h-[70vh] flex flex-col items-center justify-center text-center px-6">
        <div className="w-20 h-20 bg-gray-100 rounded-2xl flex items-center justify-center mb-5">
          <ShoppingCart size={36} className="text-gray-300" />
        </div>
        <h2 className="text-[18px] font-semibold text-gray-900 mb-2">Таны сагс хоосон</h2>
        <p className="text-[14px] text-gray-500 mb-6">Дэлгүүрт очиж хайлт хийнэ үү</p>
        <Link href="/shop" className="bg-violet-600 hover:bg-violet-700 text-white rounded-xl px-6 py-3 text-[14px] font-semibold transition-colors" style={{ textDecoration: "none" }}>
          Дэлгүүр үзэх
        </Link>
      </div>
    </>
  );

  const deliveryTotal = items.reduce((s, i) => s + DELIVERY_PRICE[i.deliveryType], 0);
  const subtotal = items.reduce((s, i) => s + i.product.price * i.quantity, 0);

  return (
    <>
      <Navbar />
      <div className="max-w-2xl mx-auto px-5 py-5">
        <h1 className="text-[20px] font-semibold text-gray-900 mb-5">
          Миний сагс
          <span className="text-[15px] text-gray-400 font-normal ml-2">({items.length} бараа)</span>
        </h1>

        <div className="space-y-3 mb-5">
          {items.map(item => (
            <div key={item.product.id} className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
              <div className="flex gap-3 mb-3">
                <div className="w-14 h-14 bg-violet-50 rounded-xl flex items-center justify-center shrink-0">
                  <svg className="w-7 h-7 fill-violet-400" viewBox="0 0 24 24"><path d={item.product.iconPath} /></svg>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] font-semibold text-gray-900 truncate">{item.product.name}</div>
                  <div className="text-[11px] text-gray-400 font-mono mt-0.5">{item.product.oem}</div>
                  <div className="text-[14px] font-bold text-violet-600 mt-1">₮{item.product.price.toLocaleString()}</div>
                </div>
                <button onClick={() => removeItem(item.product.id)}
                  className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-300 hover:text-red-400 hover:bg-red-50 transition-colors cursor-pointer bg-transparent border-none shrink-0">
                  <Trash2 size={15} />
                </button>
              </div>

              <div className="flex items-center justify-between gap-3 flex-wrap">
                {/* Delivery selector */}
                <div className="flex gap-1">
                  {(["fast", "normal", "cheap"] as const).map(d => (
                    <button key={d} onClick={() => updateDelivery(item.product.id, d)}
                      className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold cursor-pointer border-2 transition-all font-sans ${
                        item.deliveryType === d
                          ? "border-violet-500 bg-violet-50 text-violet-700"
                          : "border-gray-200 text-gray-400 hover:border-violet-300"
                      }`}>
                      {DEL_LABELS[d]}
                      <span className="ml-1 opacity-60">
                        {DELIVERY_PRICE[d] === 0 ? "Free" : `₮${(DELIVERY_PRICE[d] / 1000).toFixed(0)}K`}
                      </span>
                    </button>
                  ))}
                </div>

                {/* Qty */}
                <div className="flex items-center gap-0 border-2 border-gray-200 rounded-xl overflow-hidden">
                  <button onClick={() => updateQty(item.product.id, item.quantity - 1)}
                    className="w-8 h-8 flex items-center justify-center text-gray-500 hover:text-violet-600 hover:bg-violet-50 cursor-pointer bg-transparent border-none transition-colors">
                    <Minus size={13} />
                  </button>
                  <span className="text-[14px] font-semibold text-gray-900 w-8 text-center">{item.quantity}</span>
                  <button onClick={() => updateQty(item.product.id, item.quantity + 1)}
                    className="w-8 h-8 flex items-center justify-center text-gray-500 hover:text-violet-600 hover:bg-violet-50 cursor-pointer bg-transparent border-none transition-colors">
                    <Plus size={13} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Order summary */}
        <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
          <h3 className="text-[14px] font-semibold text-gray-900 mb-3">Захиалгын дүн</h3>
          <div className="space-y-2 mb-4">
            {items.map(i => (
              <div key={i.product.id} className="flex justify-between text-[13px] text-gray-500">
                <span className="truncate mr-4 flex-1">{i.product.name} ×{i.quantity}</span>
                <span className="shrink-0 font-medium">₮{(i.product.price * i.quantity).toLocaleString()}</span>
              </div>
            ))}
            <div className="flex justify-between text-[13px] text-gray-500 pt-2 border-t border-gray-100">
              <span>Хүргэлт</span>
              <span className="font-medium">{deliveryTotal === 0 ? "Үнэгүй" : `₮${deliveryTotal.toLocaleString()}`}</span>
            </div>
          </div>
          <div className="flex justify-between text-[16px] font-bold text-gray-900 pt-3 border-t-2 border-gray-200 mb-4">
            <span>Нийт дүн</span>
            <span className="text-violet-600">₮{total().toLocaleString()}</span>
          </div>
          <Link href="/checkout"
            className="flex items-center justify-center gap-2 w-full bg-violet-600 hover:bg-violet-700 text-white rounded-xl py-3.5 text-[15px] font-semibold transition-colors shadow-lg shadow-violet-200"
            style={{ textDecoration: "none" }}>
            Захиалга үргэлжлүүлэх <ArrowRight size={16} />
          </Link>
          <Link href="/shop" className="block text-center text-[13px] text-gray-400 hover:text-violet-600 mt-3 transition-colors" style={{ textDecoration: "none" }}>
            ← Дэлгүүр рүү буцах
          </Link>
        </div>
      </div>
    </>
  );
}
