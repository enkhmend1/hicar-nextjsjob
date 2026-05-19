"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { Users, Package, ShoppingBag, TrendingUp } from "lucide-react";

interface DashboardData {
  totals: { users: number; products: number; orders: number; revenue: number };
  statusBreakdown: Record<string, number>;
  recentOrders: Array<{
    _id: string; total: number; status: string; createdAt: string; paymentMethod: string;
    user?: { name: string; email: string };
  }>;
  topProducts: Array<{ _id: string; name: string; qty: number; revenue: number }>;
}

const STATUS_LABEL: Record<string, string> = {
  pending: "Хүлээгдэж буй", paid: "Төлсөн", processing: "Бэлдэж буй",
  shipped: "Илгээсэн", delivered: "Хүргэгдсэн", cancelled: "Цуцалсан",
};
const STATUS_COLOR: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700",
  paid: "bg-blue-50 text-blue-700",
  processing: "bg-violet-50 text-violet-700",
  shipped: "bg-indigo-50 text-indigo-700",
  delivered: "bg-emerald-50 text-emerald-700",
  cancelled: "bg-red-50 text-red-700",
};

export default function AdminDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    api.get<DashboardData>("/stats/dashboard")
      .then(setData)
      .catch(e => setErr((e as Error).message));
  }, []);

  if (err) return <div className="text-red-600 text-sm">⚠ {err}</div>;
  if (!data) return <div className="text-gray-400 text-sm">Уншиж байна...</div>;

  const cards = [
    { label: "Нийт хэрэглэгч", value: data.totals.users.toLocaleString(), icon: Users, color: "violet" },
    { label: "Нийт бараа", value: data.totals.products.toLocaleString(), icon: Package, color: "blue" },
    { label: "Нийт захиалга", value: data.totals.orders.toLocaleString(), icon: ShoppingBag, color: "emerald" },
    { label: "Нийт борлуулалт", value: `₮${data.totals.revenue.toLocaleString()}`, icon: TrendingUp, color: "orange" },
  ];
  const colorMap: Record<string, string> = {
    violet: "bg-violet-50 text-violet-600",
    blue: "bg-blue-50 text-blue-600",
    emerald: "bg-emerald-50 text-emerald-600",
    orange: "bg-orange-50 text-orange-600",
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[22px] font-semibold text-gray-900">Хяналтын самбар</h1>
        <p className="text-[13px] text-gray-500 mt-0.5">HiCar дэлгүүрийн ерөнхий мэдээлэл</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {cards.map(c => {
          const Icon = c.icon;
          return (
            <div key={c.label} className="bg-white border border-gray-200 rounded-2xl p-4">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${colorMap[c.color]}`}>
                <Icon size={18} />
              </div>
              <div className="text-[20px] font-bold text-gray-900">{c.value}</div>
              <div className="text-[12px] text-gray-500 mt-0.5">{c.label}</div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white border border-gray-200 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[14px] font-semibold text-gray-900">Сүүлийн захиалгууд</h2>
            <Link href="/admin/orders" className="text-[12px] text-violet-600 hover:underline" style={{ textDecoration: "none" }}>Бүгд →</Link>
          </div>
          {data.recentOrders.length === 0 ? (
            <p className="text-[13px] text-gray-400 text-center py-6">Захиалга байхгүй</p>
          ) : (
            <div className="space-y-2">
              {data.recentOrders.map(o => (
                <div key={o._id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-gray-900 truncate">{o.user?.name ?? "—"}</div>
                    <div className="text-[11px] text-gray-400 truncate">{o.user?.email ?? ""} · {new Date(o.createdAt).toLocaleString("mn-MN")}</div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${STATUS_COLOR[o.status]}`}>{STATUS_LABEL[o.status]}</span>
                    <span className="text-[13px] font-semibold text-violet-600 w-24 text-right">₮{o.total.toLocaleString()}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white border border-gray-200 rounded-2xl p-4">
          <h2 className="text-[14px] font-semibold text-gray-900 mb-4">Шилдэг бараа</h2>
          {data.topProducts.length === 0 ? (
            <p className="text-[13px] text-gray-400 text-center py-6">Мэдээлэл байхгүй</p>
          ) : (
            <div className="space-y-2">
              {data.topProducts.map((p, i) => (
                <div key={p._id} className="flex items-center gap-3 py-2 border-b border-gray-100 last:border-0">
                  <div className="w-7 h-7 bg-violet-50 text-violet-600 rounded-lg flex items-center justify-center text-[12px] font-bold shrink-0">{i + 1}</div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] font-medium text-gray-900 truncate">{p.name}</div>
                    <div className="text-[10px] text-gray-400">×{p.qty} · ₮{p.revenue.toLocaleString()}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl p-4">
        <h2 className="text-[14px] font-semibold text-gray-900 mb-4">Захиалгын төлөв</h2>
        <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
          {Object.entries(STATUS_LABEL).map(([k, label]) => (
            <div key={k} className={`rounded-xl p-3 ${STATUS_COLOR[k]}`}>
              <div className="text-[11px] font-medium">{label}</div>
              <div className="text-[18px] font-bold mt-1">{data.statusBreakdown[k] || 0}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
