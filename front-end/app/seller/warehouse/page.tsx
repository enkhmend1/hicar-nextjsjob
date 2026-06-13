"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { api } from "@/lib/api";
import {
  Warehouse, Search, AlertTriangle, XCircle, Boxes, MapPin,
  Check, X, Pencil, Loader2, ImagePlus, PackageCheck,
} from "lucide-react";
import PageHeader from "@/app/seller/_components/PageHeader";
import { StatCardInline } from "@/app/seller/_components/StatCard";
import { ErrorBanner, EmptyState, TableRowsSkeleton } from "@/app/seller/_components/States";
import { TableCard, Th } from "@/app/seller/_components/Table";

/**
 * Warehouse / inventory page.
 *
 * Server resolves the low-stock fallback chain and ships an
 * `effectiveThreshold` per row, so this page never re-derives the
 * seller-default logic — it just compares `stockQty <= effectiveThreshold`.
 *
 * Stock is NOT decremented here. Checkout decrements atomically server-side
 * (order.controller.js). This page is for manual recounts + shelf location.
 */
interface WarehouseItem {
  _id: string;
  name: string;
  oem?: string;
  brand?: string;
  category?: string;
  images?: string[];
  stockQty?: number;
  lowStockThreshold?: number;
  warehouseLocation?: string;
  inStock?: boolean;
  effectiveThreshold: number;
  updatedAt?: string;
}

type Draft = { stockQty: number; lowStockThreshold: number; warehouseLocation: string };

// Stock health tier — drives the row tint + badge.
const tierOf = (qty: number, threshold: number, inStock: boolean): "out" | "low" | "ok" => {
  if (qty === 0 || !inStock) return "out";
  if (qty <= threshold) return "low";
  return "ok";
};

export default function SellerWarehousePage() {
  const [items, setItems] = useState<WarehouseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [query, setQuery] = useState("");
  const [lowOnly, setLowOnly] = useState(false);

  // Inline edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Row that just saved — flashes green for ~1.2s.
  const [savedId, setSavedId] = useState<string | null>(null);

  // ── Data fetch ────────────────────────────────────────────────────
  const reload = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const { items } = await api.get<{ items: WarehouseItem[]; sellerDefault: number }>("/seller/warehouse");
      setItems(items);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  // queueMicrotask defers reload()'s setLoading(true) past the effect
  // commit — React 19 warns on sync setState in effect bodies.
  useEffect(() => { queueMicrotask(reload); }, [reload]);

  // ── Derived: filtered rows + KPI summary ──────────────────────────
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((p) => {
      if (lowOnly && tierOf(p.stockQty ?? 0, p.effectiveThreshold, p.inStock ?? false) === "ok") return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        (p.oem ?? "").toLowerCase().includes(q) ||
        (p.warehouseLocation ?? "").toLowerCase().includes(q) ||
        (p.brand ?? "").toLowerCase().includes(q)
      );
    });
  }, [items, query, lowOnly]);

  const stats = useMemo(() => {
    let low = 0, out = 0, units = 0;
    for (const p of items) {
      const t = tierOf(p.stockQty ?? 0, p.effectiveThreshold, p.inStock ?? false);
      if (t === "out") out++;
      else if (t === "low") low++;
      units += p.stockQty ?? 0;
    }
    return { low, out, units };
  }, [items]);

  // ── Inline edit handlers ──────────────────────────────────────────
  const startEdit = (p: WarehouseItem) => {
    setErr("");
    setEditingId(p._id);
    setDraft({
      stockQty: p.stockQty ?? 0,
      // -1 sentinel shows as empty in the input.
      lowStockThreshold: p.lowStockThreshold ?? -1,
      warehouseLocation: p.warehouseLocation ?? "",
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft(null);
  };

  const saveEdit = async (p: WarehouseItem) => {
    if (!draft) return;
    setBusyId(p._id);
    setErr("");
    try {
      const { item } = await api.patch<{ item: WarehouseItem }>(`/seller/warehouse/${p._id}`, {
        stockQty: draft.stockQty,
        lowStockThreshold: draft.lowStockThreshold,
        warehouseLocation: draft.warehouseLocation,
      });
      // Patch the single row in place — no full reload needed.
      setItems((prev) => prev.map((x) => (x._id === p._id ? { ...x, ...item } : x)));
      setEditingId(null);
      setDraft(null);
      // Flash the row green for a moment.
      setSavedId(p._id);
      setTimeout(() => setSavedId((s) => (s === p._id ? null : s)), 1200);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Агуулахын үлдэгдэл"
        subtitle={`${items.length} бараа · Үлдэгдэл, байршлыг шууд засна`}
        icon={Warehouse}
        iconClassName="text-blue-600"
        actions={
          <Link href="/seller/products"
            className="inline-flex items-center gap-1.5 border border-gray-200 hover:border-blue-400 hover:bg-blue-50 text-gray-700 rounded-lg px-3 py-2 text-[13px] font-semibold cursor-pointer bg-white transition-all">
            <PackageCheck size={14} /> Бараа удирдах
          </Link>
        }
      />

      {/* KPI summary */}
      <div className="grid grid-cols-3 gap-3">
        <StatCardInline label="Цөөн үлдсэн" value={stats.low} tone={stats.low > 0 ? "amber" : "gray"} icon={AlertTriangle} />
        <StatCardInline label="Дууссан" value={stats.out} tone={stats.out > 0 ? "red" : "gray"} icon={XCircle} />
        <StatCardInline label="Нийт ширхэг" value={stats.units.toLocaleString()} tone="blue" icon={Boxes} />
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Нэр, OEM, байршлаар хайх..."
            className="w-full min-w-0 bg-white border border-gray-200 rounded-lg pl-9 pr-3 py-2 text-[16px] md:text-[13px] focus:outline-none focus:border-blue-400"
          />
        </div>
        <button
          onClick={() => setLowOnly((v) => !v)}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-semibold border cursor-pointer transition-colors ${
            lowOnly
              ? "bg-red-50 text-red-600 border-red-200"
              : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
          }`}>
          <AlertTriangle size={14} /> Зөвхөн анхааруулга
        </button>
      </div>

      {err && <ErrorBanner message={err} />}

      {/* Table */}
      <TableCard>
        <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-gray-500 text-[12px]">
                <Th className="w-12" />
                <Th>Нэр / Брэнд</Th>
                <Th>OEM</Th>
                <Th align="right">Үлдэгдэл</Th>
                <Th align="right">Анхааруулах босго</Th>
                <Th>Байршил</Th>
                <Th align="right" className="w-28">Үйлдэл</Th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableRowsSkeleton rows={6} cols={7} />
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7}>
                  <EmptyState
                    icon={items.length === 0 ? Warehouse : Search}
                    title={items.length === 0 ? "Бараа байхгүй байна" : "Хайлтад тохирох бараа алга"}
                    hint={items.length === 0 ? "Бараа нэмсний дараа энд агуулахын үлдэгдэл харагдана." : "Өөр түлхүүр үг эсвэл шүүлтүүр ашиглана уу."}
                  />
                </td></tr>
              ) : filtered.map((p) => {
                const isEditing = editingId === p._id;
                const tier = tierOf(p.stockQty ?? 0, p.effectiveThreshold, p.inStock ?? false);
                const isSaved = savedId === p._id;
                const isBusy = busyId === p._id;
                // Green flash wins over the low-stock red tint while it lasts.
                const rowTint = isSaved
                  ? "bg-green-50"
                  : tier === "out" || tier === "low"
                    ? "bg-red-50"
                    : "";
                return (
                  <tr key={p._id} className={`border-b border-gray-100 last:border-0 transition-colors duration-500 ${rowTint} ${!isEditing && !isSaved ? "hover:bg-gray-50" : ""}`}>
                    {/* Image */}
                    <td className="px-3 py-2">
                      <div className="relative w-9 h-9 bg-amber-50 rounded-md overflow-hidden flex items-center justify-center">
                        {p.images && p.images.length > 0
                          ? <Image src={p.images[0]} alt="" fill sizes="36px" className="object-cover" unoptimized />
                          : <ImagePlus size={13} className="text-gray-300" />}
                      </div>
                    </td>

                    {/* Name / brand */}
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-gray-900 truncate max-w-[240px]">{p.name}</div>
                      <div className="text-[11px] text-gray-400 truncate">{p.brand || "—"}</div>
                    </td>

                    {/* OEM */}
                    <td className="px-4 py-2.5 text-gray-500 font-mono text-[12px]">{p.oem || "—"}</td>

                    {/* Stock qty */}
                    <td className="px-4 py-2.5 text-right">
                      {isEditing ? (
                        <input
                          type="number" min={0} autoFocus
                          value={draft?.stockQty ?? 0}
                          onChange={(e) => setDraft((d) => d && ({ ...d, stockQty: Math.max(0, Number(e.target.value) || 0) }))}
                          className="w-20 text-right bg-white border border-blue-300 rounded-md px-2 py-1 text-[13px] focus:outline-none focus:border-blue-500 tabular-nums"
                        />
                      ) : (
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[12px] font-semibold border tabular-nums ${
                          tier === "out" ? "bg-red-100 text-red-700 border-red-200"
                          : tier === "low" ? "bg-amber-50 text-amber-700 border-amber-200"
                          : "bg-emerald-50 text-emerald-700 border-emerald-200"
                        }`}>
                          {p.stockQty ?? 0} ш
                          {tier === "out" && <span className="font-normal opacity-80">· Дууссан</span>}
                          {tier === "low" && <span className="font-normal opacity-80">· Бага</span>}
                        </span>
                      )}
                    </td>

                    {/* Threshold */}
                    <td className="px-4 py-2.5 text-right">
                      {isEditing ? (
                        <input
                          type="number" min={0}
                          placeholder={`default: ${p.effectiveThreshold}`}
                          value={draft && draft.lowStockThreshold >= 0 ? draft.lowStockThreshold : ""}
                          onChange={(e) => setDraft((d) => d && ({
                            ...d,
                            lowStockThreshold: e.target.value === "" ? -1 : Math.max(0, Number(e.target.value) || 0),
                          }))}
                          className="w-24 text-right bg-white border border-blue-300 rounded-md px-2 py-1 text-[13px] focus:outline-none focus:border-blue-500 tabular-nums"
                        />
                      ) : (
                        <span className="text-gray-600 tabular-nums">
                          {p.effectiveThreshold}
                          {(p.lowStockThreshold ?? -1) < 0 && <span className="text-[10px] text-gray-400 ml-1">(default)</span>}
                        </span>
                      )}
                    </td>

                    {/* Warehouse location */}
                    <td className="px-4 py-2.5">
                      {isEditing ? (
                        <input
                          type="text" maxLength={60}
                          placeholder="Жнь: B-3"
                          value={draft?.warehouseLocation ?? ""}
                          onChange={(e) => setDraft((d) => d && ({ ...d, warehouseLocation: e.target.value }))}
                          className="w-28 bg-white border border-blue-300 rounded-md px-2 py-1 text-[13px] focus:outline-none focus:border-blue-500"
                        />
                      ) : p.warehouseLocation ? (
                        <span className="inline-flex items-center gap-1 text-gray-600">
                          <MapPin size={12} className="text-gray-400" /> {p.warehouseLocation}
                        </span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-2.5 text-right">
                      {isEditing ? (
                        <div className="inline-flex items-center gap-1">
                          <button onClick={() => saveEdit(p)} disabled={isBusy} title="Хадгалах"
                            className="w-7 h-7 inline-flex items-center justify-center rounded-lg text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 cursor-pointer border-none transition-colors">
                            {isBusy ? <Loader2 size={13} className="animate-spin" /> : <Check size={14} />}
                          </button>
                          <button onClick={cancelEdit} disabled={isBusy} title="Болих"
                            className="w-7 h-7 inline-flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 cursor-pointer bg-transparent border-none transition-colors">
                            <X size={14} />
                          </button>
                        </div>
                      ) : isSaved ? (
                        <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-green-600">
                          <Check size={13} /> Хадгаллаа
                        </span>
                      ) : (
                        <button onClick={() => startEdit(p)} title="Хурдан засах"
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[12px] font-medium text-gray-500 hover:text-blue-600 hover:bg-blue-50 cursor-pointer bg-transparent border border-gray-200 transition-colors">
                          <Pencil size={12} /> Засах
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
        </table>
      </TableCard>
    </div>
  );
}
