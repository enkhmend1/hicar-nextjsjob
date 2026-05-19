"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Navbar from "@/app/components/Navbar";
import { useAuthStore } from "@/store";
import { api } from "@/lib/api";
import { Order } from "@/app/types";
import { Package, ChevronRight } from "lucide-react";

const STATUS_LABEL: Record<string, string> = {
  pending: "Хүлээгдэж буй",
  paid: "Төлбөр төлсөн",
  processing: "Бэлдэж буй",
  shipped: "Илгээсэн",
  delivered: "Хүргэгдсэн",
  cancelled: "Цуцалсан",
};
const STATUS_COLOR: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700 border-amber-200",
  paid: "bg-blue-50 text-blue-700 border-blue-200",
  processing: "bg-violet-50 text-violet-700 border-violet-200",
  shipped: "bg-indigo-50 text-indigo-700 border-indigo-200",
  delivered: "bg-emerald-50 text-emerald-700 border-emerald-200",
  cancelled: "bg-red-50 text-red-700 border-red-200",
};

export default function OrdersPage() {
  const router = useRouter();
  const { user, _hasHydrated } = useAuthStore();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!_hasHydrated) return;
    if (!user) { router.push("/auth/login"); return; }
    api.get<{ orders: Order[] }>("/orders/mine")
      .then(d => setOrders(d.orders))
      .catch(() => setOrders([]))
      .finally(() => setLoading(false));
  }, [user, router, _hasHydrated]);

  if (!_hasHydrated || !user) return null;

  return (
    <>
      <Navbar />
      <div className="max-w-2xl mx-auto px-5 py-5">
        <h1 className="text-[20px] font-semibold text-gray-900 mb-5">Миний захиалгууд</h1>

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="bg-white border border-gray-200 rounded-2xl h-[120px] animate-pulse" />
            ))}
          </div>
        ) : orders.length === 0 ? (
          <div className="text-center py-20">
            <div className="w-20 h-20 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Package size={36} className="text-gray-300" />
            </div>
            <p className="text-[15px] font-medium text-gray-700 mb-2">Захиалга байхгүй</p>
            <Link href="/shop" className="inline-block bg-violet-600 text-white rounded-xl px-5 py-2.5 text-[13px] font-semibold" style={{ textDecoration: "none" }}>Дэлгүүр</Link>
          </div>
        ) : (
          <div className="space-y-3">
            {orders.map(o => (
              <div key={o._id ?? o.id} className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[12px] text-gray-400 font-mono">#{(o._id ?? o.id ?? "").toString().slice(-8).toUpperCase()}</div>
                  <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${STATUS_COLOR[o.status]}`}>
                    {STATUS_LABEL[o.status]}
                  </span>
                </div>
                <div className="text-[12px] text-gray-500 mb-2">
                  {new Date(o.createdAt).toLocaleString("mn-MN")} · {o.paymentMethod.toUpperCase()}
                </div>
                <div className="space-y-1 mb-3">
                  {(o.items as { name: string; quantity: number; price: number }[]).map((i, idx) => (
                    <div key={idx} className="flex justify-between text-[13px]">
                      <span className="text-gray-600 truncate flex-1 mr-3">{i.name} ×{i.quantity}</span>
                      <span className="text-gray-500 shrink-0">₮{(i.price * i.quantity).toLocaleString()}</span>
                    </div>
                  ))}
                </div>
                <div className="flex justify-between items-center pt-3 border-t border-gray-100">
                  <span className="text-[13px] text-gray-500">Нийт</span>
                  <span className="text-[15px] font-bold text-violet-600">₮{o.total.toLocaleString()}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
