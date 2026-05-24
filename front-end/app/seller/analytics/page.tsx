"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, getToken } from "@/lib/api";
import { useAuthStore } from "@/store";
import DateRangePicker, { DateRange, computeRange } from "@/app/components/ui/DateRangePicker";
import {
  TrendingUp, Coins, Package, ShoppingBag, FileSpreadsheet, FileText, FileDown,
  Loader2, AlertTriangle, BarChart3,
} from "lucide-react";

// ── Types ───────────────────────────────────────────────────────────
interface Analytics {
  range: { from: string; to: string };
  platformFeePercent: number;
  totals: {
    orders: number; revenue: number; units: number;
    commission: number; profit: number; avgOrderValue: number;
  };
  daily: Array<{ date: string; revenue: number; units: number; orderCount: number }>;
  monthly: Array<{ month: string; revenue: number; units: number; orderCount: number }>;
  topProducts: Array<{ _id: string; name: string; oem?: string; units: number; revenue: number }>;
  statusBreakdown: Record<string, number>;
  inventory: {
    totalProducts: number; approved: number; pending: number; rejected: number;
    inStockCount: number; outOfStockCount: number; totalStock: number; stockValue: number;
  };
  recentOrders: Array<{
    _id: string; total: number; status: string; createdAt: string;
    user?: { name?: string; email?: string };
  }>;
}

const STATUS_COLOR: Record<string, string> = {
  pending:    "bg-amber-100 text-amber-700",
  paid:       "bg-blue-100 text-blue-700",
  processing: "bg-blue-100 text-blue-700",
  shipped:    "bg-indigo-100 text-indigo-700",
  delivered:  "bg-emerald-100 text-emerald-700",
  cancelled:  "bg-red-100 text-red-700",
};
const STATUS_LABEL: Record<string, string> = {
  pending: "Хүлээгдэж буй", paid: "Төлсөн", processing: "Бэлдэж буй",
  shipped: "Илгээсэн", delivered: "Хүргэгдсэн", cancelled: "Цуцалсан",
};

// ── Page ────────────────────────────────────────────────────────────
export default function SellerAnalyticsPage() {
  const user = useAuthStore((s) => s.user);
  const [range, setRange] = useState<DateRange>(() => computeRange("30d"));
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [exporting, setExporting] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!range.from || !range.to) return;
    setLoading(true); setErr("");
    try {
      const a = await api.get<Analytics>(`/seller/analytics?from=${range.from}&to=${range.to}`);
      setData(a);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [range]);

  // queueMicrotask defers load()'s setLoading(true) past the effect
  // commit — React 19 warns on sync setState in effect bodies.
  useEffect(() => { queueMicrotask(load); }, [load]);

  const download = async (format: "xlsx" | "csv" | "pdf") => {
    if (!range.from || !range.to) return;
    setExporting(format);
    try {
      // Direct fetch (not via api.get) because we need the binary stream
      const BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5001/api";
      const token = getToken();
      const res = await fetch(
        `${BASE}/seller/analytics/export?format=${format}&from=${range.from}&to=${range.to}`,
        { credentials: "include", headers: token ? { Authorization: `Bearer ${token}` } : {} },
      );
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const disposition = res.headers.get("content-disposition") || "";
      const match = disposition.match(/filename="?([^"]+)"?/);
      const fallback = `hicar-seller.${format}`;
      const filename = match ? match[1] : fallback;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setExporting(null);
    }
  };

  // ── Derived: revenue sparkline ────────────────────────────────────
  const peakRevenue = useMemo(
    () => Math.max(0, ...(data?.daily.map((d) => d.revenue) ?? [])),
    [data],
  );

  return (
    <div className="space-y-5">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-[22px] font-semibold text-gray-900 flex items-center gap-2">
            <BarChart3 size={20} className="text-amber-500" /> Аналитик
          </h1>
          <p className="text-[13px] text-gray-500 mt-0.5">
            Орлого, ашиг, бараа материал, борлуулалтын тайлан
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <DateRangePicker value={range} onChange={setRange} />
        </div>
      </header>

      {err && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-[13px] rounded-xl px-3 py-2 flex items-center gap-2">
          <AlertTriangle size={14} /> {err}
        </div>
      )}

      {/* Export bar */}
      <div className="bg-gradient-to-r from-blue-50 to-amber-50 border border-blue-100 rounded-2xl px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-[12px] text-gray-700">
          <FileDown size={14} className="text-blue-600" />
          Энэ хугацааны тайланг татах:
        </div>
        <div className="flex gap-2">
          <ExportButton format="xlsx" icon={FileSpreadsheet} label="Excel"
            busy={exporting === "xlsx"} onClick={() => download("xlsx")} color="emerald" />
          <ExportButton format="csv" icon={FileText} label="CSV"
            busy={exporting === "csv"} onClick={() => download("csv")} color="blue" />
          <ExportButton format="pdf" icon={FileText} label="PDF"
            busy={exporting === "pdf"} onClick={() => download("pdf")} color="red" />
        </div>
      </div>

      {loading && !data ? (
        <div className="text-center py-16 text-gray-400 text-[13px]">
          <Loader2 className="inline animate-spin mr-1.5" size={14} /> Уншиж байна...
        </div>
      ) : !data ? null : (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi label="Орлого" value={`₮${data.totals.revenue.toLocaleString()}`} sub={`${data.totals.orders} захиалга`} icon={Coins} tone="blue" />
            <Kpi label="Цэвэр ашиг" value={`₮${data.totals.profit.toLocaleString()}`} sub={`Хураамж ${data.platformFeePercent}% (₮${data.totals.commission.toLocaleString()})`} icon={TrendingUp} tone="emerald" />
            <Kpi label="Дундаж захиалга" value={`₮${data.totals.avgOrderValue.toLocaleString()}`} sub={`${data.totals.units} ширхэг`} icon={ShoppingBag} tone="amber" />
            <Kpi label="Нөөц" value={`₮${data.inventory.stockValue.toLocaleString()}`} sub={`${data.inventory.totalStock} ширхэг`} icon={Package} tone="indigo" />
          </div>

          {/* Daily revenue mini-chart */}
          <section className="bg-white border border-gray-200 rounded-2xl p-4">
            <h2 className="text-[14px] font-semibold text-gray-900 mb-3">Өдөр тутмын орлого</h2>
            {data.daily.length === 0 ? (
              <p className="text-[13px] text-gray-400 text-center py-6">Өгөгдөл алга</p>
            ) : (
              <div className="overflow-x-auto">
                <div className="flex items-end gap-1 h-32 min-w-full" style={{ minWidth: `${Math.max(data.daily.length * 14, 320)}px` }}>
                  {data.daily.map((d) => {
                    const h = peakRevenue > 0 ? (d.revenue / peakRevenue) * 100 : 0;
                    return (
                      <div key={d.date}
                        title={`${d.date}: ₮${d.revenue.toLocaleString()} (${d.orderCount} order, ${d.units} ширх.)`}
                        className="flex-1 min-w-[8px] relative group cursor-help">
                        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-blue-600 to-amber-400 rounded-t-sm transition-all"
                          style={{ height: `${h}%` }} />
                      </div>
                    );
                  })}
                </div>
                <div className="flex justify-between text-[10px] text-gray-400 mt-1 px-1">
                  <span>{data.daily[0]?.date}</span>
                  <span>Дээд: ₮{peakRevenue.toLocaleString()}</span>
                  <span>{data.daily[data.daily.length - 1]?.date}</span>
                </div>
              </div>
            )}
          </section>

          {/* Two-up: status + top products */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <section className="bg-white border border-gray-200 rounded-2xl p-4">
              <h2 className="text-[14px] font-semibold text-gray-900 mb-3">Захиалгын төлөв</h2>
              {Object.keys(data.statusBreakdown).length === 0 ? (
                <p className="text-[13px] text-gray-400 text-center py-4">—</p>
              ) : (
                <ul className="space-y-1.5">
                  {Object.entries(STATUS_LABEL).map(([key, label]) => {
                    const v = data.statusBreakdown[key] || 0;
                    return (
                      <li key={key} className="flex items-center justify-between text-[12px]">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${STATUS_COLOR[key] || "bg-gray-100 text-gray-600"}`}>
                          {label}
                        </span>
                        <span className="font-semibold tabular-nums text-gray-700">{v}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className="lg:col-span-2 bg-white border border-gray-200 rounded-2xl p-4">
              <h2 className="text-[14px] font-semibold text-gray-900 mb-3">Шилдэг бараа</h2>
              {data.topProducts.length === 0 ? (
                <p className="text-[13px] text-gray-400 text-center py-6">Өгөгдөл алга</p>
              ) : (
                <table className="w-full text-[13px]">
                  <thead className="text-[11px] text-gray-400">
                    <tr>
                      <th className="text-left pb-1">#</th>
                      <th className="text-left pb-1">Бараа</th>
                      <th className="text-right pb-1">Ширхэг</th>
                      <th className="text-right pb-1">Орлого</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topProducts.map((p, i) => (
                      <tr key={p._id} className="border-t border-gray-100">
                        <td className="py-1.5 text-gray-400 tabular-nums">{i + 1}</td>
                        <td className="py-1.5">
                          <div className="font-medium text-gray-900 truncate max-w-[260px]">{p.name}</div>
                          {p.oem && <div className="text-[10px] text-gray-400 font-mono">{p.oem}</div>}
                        </td>
                        <td className="py-1.5 text-right tabular-nums text-gray-700">{p.units}</td>
                        <td className="py-1.5 text-right font-semibold tabular-nums text-blue-600">₮{p.revenue.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </div>

          {/* Monthly */}
          {data.monthly.length > 0 && (
            <section className="bg-white border border-gray-200 rounded-2xl p-4">
              <h2 className="text-[14px] font-semibold text-gray-900 mb-3">Сар бүрийн борлуулалт</h2>
              <table className="w-full text-[13px]">
                <thead className="text-[11px] text-gray-400">
                  <tr>
                    <th className="text-left pb-1">Сар</th>
                    <th className="text-right pb-1">Захиалга</th>
                    <th className="text-right pb-1">Ширхэг</th>
                    <th className="text-right pb-1">Орлого</th>
                  </tr>
                </thead>
                <tbody>
                  {data.monthly.map((m) => (
                    <tr key={m.month} className="border-t border-gray-100">
                      <td className="py-1.5 font-medium text-gray-700">{m.month}</td>
                      <td className="py-1.5 text-right tabular-nums">{m.orderCount}</td>
                      <td className="py-1.5 text-right tabular-nums">{m.units}</td>
                      <td className="py-1.5 text-right font-semibold tabular-nums text-blue-600">₮{m.revenue.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {/* Inventory snapshot */}
          <section className="bg-white border border-gray-200 rounded-2xl p-4">
            <h2 className="text-[14px] font-semibold text-gray-900 mb-3">Бараа материалын төлөв</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Stat label="Нийт бараа" value={data.inventory.totalProducts} />
              <Stat label="Идэвхтэй" value={data.inventory.inStockCount} tone="emerald" />
              <Stat label="Дууссан" value={data.inventory.outOfStockCount} tone="red" />
              <Stat label="Хянагдаж буй" value={data.inventory.pending} tone="amber" />
            </div>
          </section>

          {user?.sellerProfile?.emailAlertsEnabled === false && (
            <div className="bg-amber-50 border border-amber-200 text-amber-800 text-[12px] rounded-xl p-3 flex items-start gap-2">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <span>Email сэрэмжлүүлэг унтраалттай байна. <a href="/seller/profile" className="font-semibold underline">Тохиргоо руу очих →</a></span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Reusable bits ───────────────────────────────────────────────────
function Kpi({ label, value, sub, icon: Icon, tone }: {
  label: string; value: string | number; sub?: string;
  icon: typeof Coins; tone: "blue" | "emerald" | "amber" | "indigo";
}) {
  const toneClass = {
    blue:  "bg-blue-50 text-blue-600",
    emerald: "bg-emerald-50 text-emerald-600",
    amber: "bg-amber-50 text-amber-600",
    indigo:  "bg-indigo-50 text-indigo-600",
  }[tone];
  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-4">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${toneClass}`}>
        <Icon size={18} />
      </div>
      <div className="text-[20px] font-bold text-gray-900 tabular-nums">{value}</div>
      <div className="text-[12px] text-gray-500 mt-0.5">{label}</div>
      {sub && <div className="text-[10px] text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}

function Stat({ label, value, tone = "gray" }: { label: string; value: number; tone?: "gray" | "emerald" | "red" | "amber" }) {
  const toneClass = {
    gray: "text-gray-900", emerald: "text-emerald-700", red: "text-red-600", amber: "text-amber-700",
  }[tone];
  return (
    <div className="bg-gray-50 border border-gray-100 rounded-xl p-2.5">
      <div className={`text-[16px] font-bold tabular-nums ${toneClass}`}>{value}</div>
      <div className="text-[10px] text-gray-500">{label}</div>
    </div>
  );
}

function ExportButton({ format, icon: Icon, label, busy, onClick, color }: {
  format: string; icon: typeof FileText; label: string; busy: boolean; onClick: () => void;
  color: "emerald" | "blue" | "red";
}) {
  const cls = {
    emerald: "border-emerald-200 text-emerald-700 hover:bg-emerald-50",
    blue:    "border-blue-200 text-blue-700 hover:bg-blue-50",
    red:     "border-red-200 text-red-700 hover:bg-red-50",
  }[color];
  return (
    <button onClick={onClick} disabled={busy}
      className={`inline-flex items-center gap-1.5 border rounded-lg px-3 py-1.5 text-[12px] font-semibold cursor-pointer bg-white transition-colors disabled:opacity-50 font-sans ${cls}`}>
      {busy ? <Loader2 size={12} className="animate-spin" /> : <Icon size={12} />}
      {label}
      <span className="text-[10px] opacity-60">.{format}</span>
    </button>
  );
}
