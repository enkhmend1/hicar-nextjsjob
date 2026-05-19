"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { Package, ShoppingBag, TrendingUp, Coins, Clock } from "lucide-react";

interface DashboardData {
  totals: {
    products: number; approved: number; pending: number; rejected: number;
    orders: number; revenue: number; commission: number; netRevenue: number;
  };
  statusBreakdown: Record<string, number>;
  recentOrders: Array<{
    _id: string; total: number; status: string; createdAt: string;
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

export default function SellerDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    api.get<DashboardData>("/seller/dashboard")
      .then(setData)
      .catch(e => setErr((e as Error).message));
  }, []);

  if (err) return <div className="text-red-600 text-sm">⚠ {err}</div>;
  if (!data) return <div className="text-gray-400 text-sm">Уншиж байна...</div>;

  const cards = [
    { label: "Зөвшөөрөгдсөн бараа", value: data.totals.approved, sub: `Нийт ${data.totals.products}`, icon: Package, color: "fuchsia" },
    { label: "Хүлээгдэж буй", value: data.totals.pending, sub: `Татгалзсан: ${data.totals.rejected}`, icon: Clock, color: "amber" },
    { label: "Захиалга", value: data.totals.orders, sub: "Нийт", icon: ShoppingBag, color: "violet" },
    { label: "Цэвэр орлого", value: `₮${data.totals.netRevenue.toLocaleString()}`, sub: `Хураамж: ₮${data.totals.commission.toLocaleString()}`, icon: TrendingUp, color: "emerald" },
  ];
  const colorMap: Record<string, string> = {
    fuchsia: "bg-fuchsia-50 text-fuchsia-600",
    amber: "bg-amber-50 text-amber-600",
    violet: "bg-violet-50 text-violet-600",
    emerald: "bg-emerald-50 text-emerald-600",
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[22px] font-semibold text-gray-900">Хяналтын самбар</h1>
        <p className="text-[13px] text-gray-500 mt-0.5">Танай дэлгүүрийн борлуулалт, нөөц</p>
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
              <div className="text-[10px] text-gray-400 mt-0.5">{c.sub}</div>
            </div>
          );
        })}
      </div>

      <div className="bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white rounded-2xl p-4 flex items-center gap-3">
        <Coins size={22} />
        <div className="flex-1">
          <div className="text-[12px] opacity-80">Нийт борлуулалт</div>
          <div className="text-[22px] font-bold">₮{data.totals.revenue.toLocaleString()}</div>
        </div>
        <Link href="/seller/products" className="bg-white/15 hover:bg-white/25 backdrop-blur rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-colors" style={{ textDecoration: "none", color: "white" }}>
          Бараа удирдах →
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white border border-gray-200 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[14px] font-semibold text-gray-900">Сүүлийн захиалгууд</h2>
            <Link href="/seller/orders" className="text-[12px] text-fuchsia-600 hover:underline" style={{ textDecoration: "none" }}>Бүгд →</Link>
          </div>
          {data.recentOrders.length === 0 ? (
            <p className="text-[13px] text-gray-400 text-center py-6">Захиалга байхгүй</p>
          ) : (
            <div className="space-y-2">
              {data.recentOrders.map(o => (
                <div key={o._id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-gray-900 truncate">{o.user?.name ?? "—"}</div>
                    <div className="text-[11px] text-gray-400 truncate">{new Date(o.createdAt).toLocaleString("mn-MN")}</div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${STATUS_COLOR[o.status]}`}>{STATUS_LABEL[o.status]}</span>
                    <span className="text-[13px] font-semibold text-fuchsia-600 w-24 text-right">₮{o.total.toLocaleString()}</span>
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
                  <div className="w-7 h-7 bg-fuchsia-50 text-fuchsia-600 rounded-lg flex items-center justify-center text-[12px] font-bold shrink-0">{i + 1}</div>
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
    </div>
  );
}
