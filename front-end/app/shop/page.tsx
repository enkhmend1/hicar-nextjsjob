"use client";

/**
 * Shop page — Phase T senior-grade filter sidebar.
 *
 * Layout (desktop):
 *
 *   ┌─────────────┬──────────────────────────────────────────────┐
 *   │             │  [Хайх...]              [Эрэмбэлэх ▾]        │
 *   │  Sticky     │  Active-filter chips: [Brake ×] [In stock ×] │
 *   │  filter     │  ─────────────────────────────────────────── │
 *   │  sidebar    │  42 бараа олдлоо                              │
 *   │             │  ┌────┐ ┌────┐ ┌────┐ ┌────┐                │
 *   │  • Cats     │  │card│ │card│ │card│ │card│                │
 *   │  • Price    │  └────┘ └────┘ └────┘ └────┘                │
 *   │  • Brand    │  ┌────┐ ┌────┐ ┌────┐ ┌────┐                │
 *   │  • Rating   │  │card│ │card│ │card│ │card│                │
 *   │  • Source   │  └────┘ └────┘ └────┘ └────┘                │
 *   │  • In stock │                                              │
 *   │             │                                              │
 *   └─────────────┴──────────────────────────────────────────────┘
 *
 * Layout (mobile):
 *   • Search + sort + "Шүүлт" button → slides out a left drawer
 *     with the same controls.
 *
 * Design notes:
 *   • All filter state lives in component state; URL is read on first
 *     mount for deep-linking but not pushed back (avoids history spam
 *     while the user is dragging the price slider).
 *   • Backend filter set extended in Phase T — see Controller/product.controller
 *     buildFilter for the supported params (priceMin, priceMax, brand,
 *     inStock, minRating).
 *   • Active-filter chips at the top with × per chip + "Бүгдийг арилгах"
 *     reset link — pattern lifted from Amazon's left-sidebar facet UI.
 *   • Categories live in the sidebar as a scrollable list; the previous
 *     top-of-page chip strip is gone (it always pushed the grid below
 *     the fold when there were 30+ categories).
 */

import { useEffect, useMemo, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import BuyerShell from "@/app/components/BuyerShell";
import ProductCard from "@/app/components/ProductCard";
import { CATEGORIES } from "@/lib/data";
import { api } from "@/lib/api";
import { Product } from "@/app/types";
import { useT } from "@/lib/i18n";
import {
  Search, SlidersHorizontal, X, Star, Check, Package2, Filter as FilterIcon,
  ChevronDown,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────
// State + utilities
// ─────────────────────────────────────────────────────────────────

interface ShopFilters {
  cat:        string;          // "all" or category id
  q:          string;
  sort:       string;          // "default" | "price_asc" | ...
  source:     string;          // "all" | "amayama" | "partsouq" | "local"
  brand:      string;          // exact brand name or ""
  priceMin:   string;          // string (input bound) → number when sent
  priceMax:   string;
  minRating:  number;          // 0 | 1 | 2 | 3 | 4 | 5
  inStock:    boolean;
}

const DEFAULTS: ShopFilters = {
  cat: "all", q: "", sort: "default", source: "all", brand: "",
  priceMin: "", priceMax: "", minRating: 0, inStock: false,
};

const SORT_OPTIONS = [
  { id: "default",    label: "Шинэ нь түрүүнд" },
  { id: "price_asc",  label: "Үнэ: бага → их" },
  { id: "price_desc", label: "Үнэ: их → бага" },
  { id: "name",       label: "Нэрээр" },
];

const SOURCE_OPTIONS = [
  { id: "all",      label: "Бүх эх сурвалж" },
  { id: "amayama",  label: "Amayama JP" },
  { id: "partsouq", label: "Partsouq UAE" },
  { id: "local",    label: "Монгол дэлгүүр" },
];

// ─────────────────────────────────────────────────────────────────
// Inner component (Suspense boundary handles useSearchParams)
// ─────────────────────────────────────────────────────────────────

function ShopInner() {
  const params = useSearchParams();
  const t = useT();
  const [filters, setFilters] = useState<ShopFilters>(() => ({
    ...DEFAULTS,
    cat: params.get("cat") || "all",
    q:   params.get("q")   || "",
  }));
  const [items,   setItems]   = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  // ── Build query + fetch ─────────────────────────────────────────
  useEffect(() => {
    setLoading(true);
    const usp = new URLSearchParams();
    if (filters.cat !== "all")    usp.set("category", filters.cat);
    if (filters.source !== "all") usp.set("source", filters.source);
    if (filters.q)                usp.set("q", filters.q);
    if (filters.sort !== "default") usp.set("sort", filters.sort);
    if (filters.brand)            usp.set("brand", filters.brand);
    if (filters.priceMin)         usp.set("priceMin", filters.priceMin);
    if (filters.priceMax)         usp.set("priceMax", filters.priceMax);
    if (filters.minRating > 0)    usp.set("minRating", String(filters.minRating));
    if (filters.inStock)          usp.set("inStock", "true");

    const ctrl = new AbortController();
    api.get<{ items: Product[] }>(`/products?${usp.toString()}`)
      .then((d) => setItems(d.items))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [filters]);

  // ── Derived: brand list (from current results) ──────────────────
  // We don't have a /brands endpoint, so we surface whatever's in the
  // current result set as filter choices. Capped at 12 most-frequent.
  const brandOptions = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of items) {
      const b = p.brand?.trim();
      if (b) counts[b] = (counts[b] || 0) + 1;
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([brand, count]) => ({ brand, count }));
  }, [items]);

  // ── Active filter list (for the chip strip + reset) ─────────────
  const activeChips = useMemo(() => {
    const chips: { key: keyof ShopFilters; label: string; clear: () => void }[] = [];
    const update = (patch: Partial<ShopFilters>) => setFilters((p) => ({ ...p, ...patch }));
    if (filters.cat !== "all") {
      const cat = CATEGORIES.find((c) => c.id === filters.cat);
      chips.push({ key: "cat", label: cat?.name || filters.cat, clear: () => update({ cat: "all" }) });
    }
    if (filters.source !== "all") {
      const s = SOURCE_OPTIONS.find((o) => o.id === filters.source);
      chips.push({ key: "source", label: s?.label || filters.source, clear: () => update({ source: "all" }) });
    }
    if (filters.brand)    chips.push({ key: "brand",    label: `Брэнд: ${filters.brand}`, clear: () => update({ brand: "" }) });
    if (filters.priceMin) chips.push({ key: "priceMin", label: `≥ ₮${Number(filters.priceMin).toLocaleString()}`, clear: () => update({ priceMin: "" }) });
    if (filters.priceMax) chips.push({ key: "priceMax", label: `≤ ₮${Number(filters.priceMax).toLocaleString()}`, clear: () => update({ priceMax: "" }) });
    if (filters.minRating > 0) chips.push({ key: "minRating", label: `${filters.minRating}+ ★`, clear: () => update({ minRating: 0 }) });
    if (filters.inStock)  chips.push({ key: "inStock",  label: "Нөөцөнд", clear: () => update({ inStock: false }) });
    if (filters.q)        chips.push({ key: "q",        label: `"${filters.q}"`, clear: () => update({ q: "" }) });
    return chips;
  }, [filters]);

  const resetAll = () => setFilters({ ...DEFAULTS });

  // Filter panel — shared between desktop sidebar and mobile drawer.
  const FilterPanel = (
    <FilterContent
      filters={filters}
      onChange={setFilters}
      brandOptions={brandOptions}
    />
  );

  return (
    <BuyerShell>
      <div className="max-w-6xl mx-auto px-5 py-5">
        {/* Page header */}
        <h1 className="text-[22px] font-semibold text-gray-900 mb-1">{t("shop.title")}</h1>
        <p className="text-[13px] text-gray-500 mb-4">
          Манай {CATEGORIES.length - 1}+ ангилалаас сэлбэг хайж олоорой
        </p>

        {/* ── TOP BAR: search + sort + mobile filter toggle ─────── */}
        <div className="flex flex-col sm:flex-row gap-2 mb-4">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={filters.q}
              onChange={(e) => setFilters((p) => ({ ...p, q: e.target.value }))}
              className="w-full bg-white border border-gray-200 rounded-xl pl-9 pr-4 py-2.5 text-[14px] focus:border-blue-500 outline-none shadow-sm"
              placeholder="Сэлбэг хайх... (нэр, OEM, брэнд)" />
          </div>
          <div className="flex gap-2">
            <button onClick={() => setMobileFiltersOpen(true)}
              className="lg:hidden inline-flex items-center gap-1.5 bg-white border border-gray-200 hover:border-blue-400 rounded-xl px-3 py-2.5 text-[13px] text-gray-700 cursor-pointer font-sans transition-colors shadow-sm">
              <FilterIcon size={13} /> Шүүлт
              {activeChips.length > 0 && (
                <span className="bg-blue-700 text-white text-[10px] font-bold w-4 h-4 rounded-full inline-flex items-center justify-center">
                  {activeChips.length}
                </span>
              )}
            </button>
            <div className="relative">
              <select value={filters.sort}
                onChange={(e) => setFilters((p) => ({ ...p, sort: e.target.value }))}
                className="appearance-none bg-white border border-gray-200 rounded-xl pl-3 pr-8 py-2.5 text-[13px] text-gray-700 cursor-pointer focus:border-blue-500 font-sans shadow-sm">
                {SORT_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
              <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            </div>
          </div>
        </div>

        {/* ── ACTIVE FILTER CHIPS ────────────────────────────────── */}
        {activeChips.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 mb-4">
            {activeChips.map((chip) => (
              <span key={chip.key} className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 border border-blue-200 rounded-full pl-2.5 pr-1 py-0.5 text-[11px] font-medium">
                {chip.label}
                <button onClick={chip.clear}
                  className="w-4 h-4 inline-flex items-center justify-center rounded-full text-blue-700 hover:bg-blue-200 cursor-pointer bg-transparent border-none">
                  <X size={9} />
                </button>
              </span>
            ))}
            <button onClick={resetAll}
              className="text-[11px] text-gray-500 hover:text-red-500 underline cursor-pointer bg-transparent border-none ml-1 font-sans">
              Бүгдийг арилгах
            </button>
          </div>
        )}

        {/* ── MAIN LAYOUT: sidebar + grid ────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-5">
          {/* Desktop sidebar */}
          <aside className="hidden lg:block">
            <div className="sticky top-5 max-h-[calc(100vh-2rem)] overflow-y-auto pr-1">
              {FilterPanel}
            </div>
          </aside>

          {/* Mobile drawer */}
          {mobileFiltersOpen && (
            <div className="lg:hidden fixed inset-0 z-50 flex"
              onClick={() => setMobileFiltersOpen(false)}>
              <div className="absolute inset-0 bg-black/40" />
              <aside className="relative w-[85%] max-w-sm bg-white h-full overflow-y-auto shadow-2xl p-5"
                onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-[15px] font-semibold text-gray-900 flex items-center gap-1.5">
                    <SlidersHorizontal size={14} /> Шүүлт
                  </h3>
                  <button onClick={() => setMobileFiltersOpen(false)}
                    className="w-7 h-7 inline-flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 cursor-pointer bg-transparent border-none">
                    <X size={15} />
                  </button>
                </div>
                {FilterPanel}
                <button onClick={() => setMobileFiltersOpen(false)}
                  className="w-full mt-5 bg-blue-700 hover:bg-blue-800 text-white rounded-xl py-3 text-[14px] font-semibold cursor-pointer border-none transition-colors font-sans">
                  Үзэх ({items.length})
                </button>
              </aside>
            </div>
          )}

          {/* Results column */}
          <div className="min-w-0">
            <div className="flex items-baseline justify-between mb-3">
              <p className="text-[13px] text-gray-500">
                <span className="font-semibold text-gray-900">{items.length}</span> бараа олдлоо
              </p>
            </div>

            {loading ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {Array.from({ length: 9 }).map((_, i) => (
                  <div key={i} className="bg-white border border-gray-200 rounded-2xl h-[280px] animate-pulse" />
                ))}
              </div>
            ) : items.length === 0 ? (
              <div className="bg-white border border-gray-200 rounded-2xl p-10 text-center">
                <Package2 size={36} className="text-gray-300 mx-auto mb-3" strokeWidth={1.5} />
                <p className="text-[15px] font-medium text-gray-700 mb-1">Илэрц олдсонгүй</p>
                <p className="text-[13px] text-gray-400 mb-4">Шүүлтийн утгаа арилгаж эсвэл өөр түлхүүр үг туршаад үзнэ үү</p>
                {activeChips.length > 0 && (
                  <button onClick={resetAll}
                    className="inline-flex items-center gap-1.5 text-[13px] text-blue-700 hover:text-blue-800 font-medium cursor-pointer bg-transparent border-none font-sans">
                    Бүгдийг арилгах
                  </button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {items.map((p) => <ProductCard key={p._id ?? p.id} p={p} />)}
              </div>
            )}
          </div>
        </div>
      </div>
    </BuyerShell>
  );
}

// ─────────────────────────────────────────────────────────────────
// Filter panel (shared by sidebar + drawer)
// ─────────────────────────────────────────────────────────────────

interface FilterContentProps {
  filters: ShopFilters;
  onChange: (next: ShopFilters | ((p: ShopFilters) => ShopFilters)) => void;
  brandOptions: { brand: string; count: number }[];
}
function FilterContent({ filters, onChange, brandOptions }: FilterContentProps) {
  const update = (patch: Partial<ShopFilters>) =>
    onChange((p) => ({ ...p, ...patch }));

  return (
    <div className="space-y-4">
      {/* CATEGORY */}
      <FilterSection title="Ангилал">
        <div className="space-y-0.5 max-h-72 overflow-y-auto pr-1 -mr-1">
          {CATEGORIES.map((c) => (
            <button key={c.id} onClick={() => update({ cat: c.id })}
              className={`w-full text-left px-2.5 py-1.5 rounded-lg text-[12.5px] cursor-pointer border-none font-sans transition-colors ${
                filters.cat === c.id
                  ? "bg-blue-50 text-blue-700 font-semibold"
                  : "bg-transparent text-gray-600 hover:bg-gray-50"
              }`}>
              {c.name}
            </button>
          ))}
        </div>
      </FilterSection>

      {/* PRICE RANGE */}
      <FilterSection title="Үнэ (₮)">
        <div className="grid grid-cols-2 gap-2">
          <input type="number" min={0} placeholder="0"
            value={filters.priceMin} onChange={(e) => update({ priceMin: e.target.value })}
            className="w-full bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1.5 text-[12px] focus:border-blue-500 outline-none font-sans" />
          <input type="number" min={0} placeholder="∞"
            value={filters.priceMax} onChange={(e) => update({ priceMax: e.target.value })}
            className="w-full bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1.5 text-[12px] focus:border-blue-500 outline-none font-sans" />
        </div>
        {/* Preset chips for one-tap common ranges */}
        <div className="flex flex-wrap gap-1 mt-2">
          {[
            { label: "< 50K",     min: "", max: "50000" },
            { label: "50–200K",   min: "50000", max: "200000" },
            { label: "200K–1M",   min: "200000", max: "1000000" },
            { label: "1M+",       min: "1000000", max: "" },
          ].map((r) => (
            <button key={r.label} onClick={() => update({ priceMin: r.min, priceMax: r.max })}
              className="px-2 py-0.5 rounded-md text-[10.5px] text-gray-600 bg-gray-50 hover:bg-blue-50 hover:text-blue-700 cursor-pointer border border-gray-200 font-sans transition-colors">
              {r.label}
            </button>
          ))}
        </div>
      </FilterSection>

      {/* RATING */}
      <FilterSection title="Үнэлгээ">
        <div className="space-y-0.5">
          {[4, 3, 2, 1].map((n) => (
            <button key={n} onClick={() => update({ minRating: filters.minRating === n ? 0 : n })}
              className={`w-full flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg cursor-pointer border-none font-sans transition-colors ${
                filters.minRating === n
                  ? "bg-amber-50 text-amber-700"
                  : "bg-transparent text-gray-600 hover:bg-gray-50"
              }`}>
              <span className="flex">
                {[1, 2, 3, 4, 5].map((s) => (
                  <Star key={s} size={11}
                    className={s <= n ? "fill-amber-400 text-amber-400" : "text-gray-200"} />
                ))}
              </span>
              <span className="text-[11px]">≥ {n}</span>
            </button>
          ))}
        </div>
      </FilterSection>

      {/* SOURCE */}
      <FilterSection title="Эх сурвалж">
        <div className="space-y-0.5">
          {SOURCE_OPTIONS.map((o) => (
            <button key={o.id} onClick={() => update({ source: o.id })}
              className={`w-full text-left px-2.5 py-1.5 rounded-lg text-[12px] cursor-pointer border-none font-sans transition-colors ${
                filters.source === o.id
                  ? "bg-blue-50 text-blue-700 font-semibold"
                  : "bg-transparent text-gray-600 hover:bg-gray-50"
              }`}>
              {o.label}
            </button>
          ))}
        </div>
      </FilterSection>

      {/* BRAND (only when results have ≥1 brand) */}
      {brandOptions.length > 0 && (
        <FilterSection title="Брэнд">
          <div className="space-y-0.5 max-h-56 overflow-y-auto pr-1 -mr-1">
            {brandOptions.map((b) => (
              <button key={b.brand} onClick={() => update({ brand: filters.brand === b.brand ? "" : b.brand })}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg cursor-pointer border-none font-sans transition-colors ${
                  filters.brand === b.brand
                    ? "bg-blue-50 text-blue-700 font-semibold"
                    : "bg-transparent text-gray-600 hover:bg-gray-50"
                }`}>
                <span className="text-[12px] truncate">{b.brand}</span>
                <span className="text-[10px] text-gray-400 shrink-0">{b.count}</span>
              </button>
            ))}
          </div>
        </FilterSection>
      )}

      {/* IN STOCK */}
      <FilterSection title="">
        <label className="flex items-center gap-2 cursor-pointer bg-gray-50 hover:bg-blue-50 border border-gray-200 hover:border-blue-200 rounded-lg p-2.5 transition-colors">
          <input type="checkbox"
            checked={filters.inStock}
            onChange={(e) => update({ inStock: e.target.checked })}
            className="accent-blue-700 w-4 h-4" />
          <span className="text-[12.5px] font-medium text-gray-700 flex items-center gap-1">
            <Check size={11} className="text-emerald-600" /> Зөвхөн нөөцөнд байгаа
          </span>
        </label>
      </FilterSection>
    </div>
  );
}

function FilterSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      {title && (
        <h4 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2 px-1">
          {title}
        </h4>
      )}
      {children}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────
// Export with Suspense (useSearchParams requires it)
// ─────────────────────────────────────────────────────────────────

export default function ShopPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50" />}>
      <ShopInner />
    </Suspense>
  );
}
