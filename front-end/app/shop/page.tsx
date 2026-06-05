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
import Link from "next/link";
import BuyerShell from "@/app/components/BuyerShell";
import ProductCard from "@/app/components/ProductCard";
import { api } from "@/lib/api";
import { Product } from "@/app/types";
import { useT } from "@/lib/i18n";
import { useCategories, type SiteCategoryWithCount } from "@/app/lib/useCategories";
import { useCarStore, type ActiveVehicle } from "@/store";
import { Car as CarIcon } from "lucide-react";

// Phase AF: dynamic category list — sourced from /api/site-content/categories,
// editable in /admin/site-content. Backend currently seeds 29+ categories
// (tires, oils, filters, battery, A/C, exhaust, fuel system, etc.). Bound
// to "Бүгд" as the first entry so the existing filter UI still works.
const ALL_CATEGORY: SiteCategoryWithCount = {
  id: "all", name: "Бүгд", iconPath: "", count: 0,
};
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
  /**
   * Phase AG: vehicle-aware filter. When true and the user has an
   * activeVehicle, the data source switches from `/api/products` →
   * `/api/vehicle/compatible` so the grid shows ONLY parts whose
   * OEM/fitment data matches the buyer's car. Defaults to OFF so
   * fresh visits still see the full catalogue.
   */
  vehicleOnly: boolean;
}

const DEFAULTS: ShopFilters = {
  cat: "all", q: "", sort: "default", source: "all", brand: "",
  priceMin: "", priceMax: "", minRating: 0, inStock: false,
  vehicleOnly: false,
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

  // Debounce the text search — avoids a new API round-trip on EVERY keystroke.
  // Other filters (cat, sort, brand, price) are discrete clicks so no debounce needed.
  const [debouncedQ, setDebouncedQ] = useState(filters.q);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(filters.q), 250);
    return () => clearTimeout(t);
  }, [filters.q]);

  // Phase AF: dynamic category list. The hook is module-cached so all
  // shop visits share one fetch. Prepend "Бүгд" so the "all" filter
  // stays the first option. Empty list (cold cache / API down) still
  // renders cleanly — just the "Бүгд" entry.
  const { categories: liveCategories } = useCategories();
  const categories = useMemo<SiteCategoryWithCount[]>(
    () => [ALL_CATEGORY, ...liveCategories],
    [liveCategories],
  );

  // Phase AG: active vehicle context for the "only-fits-my-car" filter.
  // Hydration-gated so the SSR shell doesn't try to read localStorage.
  const activeVehicle = useCarStore((s) => s.activeVehicle);
  const carHydrated   = useCarStore((s) => s._hasHydrated);

  // ── Build query + fetch ─────────────────────────────────────────
  // Phase AG: two branches.
  //   1. vehicleOnly=true + activeVehicle present → POST /vehicle/compatible
  //      so the catalogue is filtered by OEM/fitment ranking. Other
  //      client-side filters (price, brand, rating) still apply via the
  //      post-fetch filter pass below.
  //   2. Otherwise → /products?... as before.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    const ctrl = new AbortController();

    const useVehicleEndpoint = filters.vehicleOnly && !!activeVehicle?.id;

    const promise = useVehicleEndpoint
      ? api.post<{ items: Product[] }>("/vehicle/compatible", {
          vehicleId: activeVehicle!.id,
          category:  filters.cat !== "all" ? filters.cat : undefined,
          limit:     60,
        })
      : (() => {
          const usp = new URLSearchParams();
          if (filters.cat !== "all")      usp.set("category", filters.cat);
          if (filters.source !== "all")   usp.set("source", filters.source);
          if (debouncedQ)                 usp.set("q", debouncedQ);  // use debounced value
          if (filters.sort !== "default") usp.set("sort", filters.sort);
          if (filters.brand)              usp.set("brand", filters.brand);
          if (filters.priceMin)           usp.set("priceMin", filters.priceMin);
          if (filters.priceMax)           usp.set("priceMax", filters.priceMax);
          if (filters.minRating > 0)      usp.set("minRating", String(filters.minRating));
          if (filters.inStock)            usp.set("inStock", "true");
          return api.get<{ items: Product[] }>(`/products?${usp.toString()}`);
        })();

    promise
      .then((d) => {
        // Vehicle-compatible endpoint doesn't take all the same query
        // params, so apply the rest CLIENT-SIDE on the returned items.
        // This keeps the OEM-fitment ranking AS-IS but still honours
        // price/brand/rating/in-stock filters the user picked.
        let arr = d.items;
        if (useVehicleEndpoint) {
          if (filters.q) {
            const rx = new RegExp(filters.q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
            arr = arr.filter((p) =>
              rx.test(p.name) || rx.test(p.oem || "") || rx.test(p.brand || ""),
            );
          }
          if (filters.brand)         arr = arr.filter((p) => p.brand === filters.brand);
          if (filters.source !== "all") arr = arr.filter((p) => p.source === filters.source);
          if (filters.priceMin)      arr = arr.filter((p) => p.price >= Number(filters.priceMin));
          if (filters.priceMax)      arr = arr.filter((p) => p.price <= Number(filters.priceMax));
          if (filters.minRating > 0) arr = arr.filter((p) => (p.rating || 0) >= filters.minRating);
          if (filters.inStock)       arr = arr.filter((p) => p.inStock !== false);
        }
        setItems(arr);
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  // debouncedQ replaces filters.q so typing doesn't fire a new API call
  // on every keystroke. All other filter fields (cat, sort…) are discrete
  // clicks, so they trigger immediately via the rest of the filters object.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.cat, filters.sort, filters.source, filters.brand, filters.priceMin,
      filters.priceMax, filters.minRating, filters.inStock, filters.vehicleOnly,
      debouncedQ, activeVehicle]);

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
      const cat = categories.find((c) => c.id === filters.cat);
      chips.push({ key: "cat", label: cat?.name || filters.cat, clear: () => update({ cat: "all" }) });
    }
    if (filters.vehicleOnly && activeVehicle) {
      chips.push({
        key: "vehicleOnly",
        label: `🚗 ${activeVehicle.manufacturer} ${activeVehicle.model}`,
        clear: () => update({ vehicleOnly: false }),
      });
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
      categories={categories}
      activeVehicle={carHydrated ? activeVehicle : null}
    />
  );

  return (
    <BuyerShell>
      <div className="max-w-6xl mx-auto px-5 py-5">
        {/* Page header */}
        <h1 className="text-[22px] font-semibold text-gray-900 mb-1">{t("shop.title")}</h1>
        <p className="text-[13px] text-gray-500 mb-4">
          Манай {Math.max(0, categories.length - 1)}+ ангилалаас сэлбэг хайж олоорой
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
  /** Phase AF: dynamic category list (29+ entries from admin). */
  categories: SiteCategoryWithCount[];
  /** Phase AG: hydration-gated active vehicle (null if user hasn't picked). */
  activeVehicle: ActiveVehicle | null;
}
function FilterContent({
  filters, onChange, brandOptions, categories, activeVehicle,
}: FilterContentProps) {
  const update = (patch: Partial<ShopFilters>) =>
    onChange((p) => ({ ...p, ...patch }));

  // Nested category accordion: split the flat list into MAIN categories and
  // their sub-parts. Selecting a main filters by [main + all descendants]
  // (the backend expands it); selecting a sub narrows to that sub only.
  const mains = categories.filter((c) => c.id !== "all" && !c.parentId);
  const subsOf = (id: string) => categories.filter((c) => c.parentId === id);
  const [openCats, setOpenCats] = useState<Set<string>>(new Set());
  const toggleCat = (id: string) => setOpenCats((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const openCat = (id: string) => setOpenCats((prev) => new Set(prev).add(id));

  return (
    <div className="space-y-4">
      {/* ── Phase AG: VEHICLE FILTER ──────────────────────────────
          Top-of-sidebar position so it's the FIRST thing a buyer sees.
          Three states:
            1. No active vehicle: gentle nudge to /lookup
            2. Active vehicle + toggle OFF: chip + "Зөвхөн энэ машинд" button
            3. Active vehicle + toggle ON: blue active card + "Болих" X
          Tap toggles `vehicleOnly` which switches the data source from
          /api/products → /api/vehicle/compatible (OEM-fitment ranking). */}
      <FilterSection title="Машинаар шүүх">
        {!activeVehicle ? (
          <Link
            href="/lookup"
            className="block bg-gray-50 hover:bg-blue-50 border border-dashed border-gray-300 hover:border-blue-300 rounded-lg p-3 text-center transition-colors"
          >
            <CarIcon size={18} className="mx-auto text-gray-400 mb-1" />
            <div className="text-[12px] text-gray-700 font-medium">
              Машинаа сонгох
            </div>
            <div className="text-[10px] text-gray-400 mt-0.5">
              Plate дугаараар хайх →
            </div>
          </Link>
        ) : filters.vehicleOnly ? (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-2.5">
            <div className="flex items-start gap-2">
              <div className="w-7 h-7 rounded-md bg-blue-600 text-white flex items-center justify-center shrink-0">
                <CarIcon size={13} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[11px] text-blue-700 font-semibold">
                  Зөвхөн энэ машинд тааралттай
                </div>
                <div className="text-[12px] font-semibold text-gray-900 truncate">
                  {activeVehicle.manufacturer} {activeVehicle.model}
                  {activeVehicle.generation && (
                    <span className="text-gray-400 font-normal"> · {activeVehicle.generation}</span>
                  )}
                </div>
                <div className="text-[10px] text-gray-500 font-mono">{activeVehicle.plate}</div>
              </div>
            </div>
            <button
              onClick={() => update({ vehicleOnly: false })}
              className="w-full mt-2 text-[11px] text-blue-700 hover:text-blue-900 bg-white border border-blue-200 hover:border-blue-300 rounded-md py-1.5 cursor-pointer font-sans transition-colors"
            >
              Шүүлтийг арилгах
            </button>
          </div>
        ) : (
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-2.5">
            <div className="flex items-start gap-2 mb-2">
              <div className="w-7 h-7 rounded-md bg-gray-200 text-gray-600 flex items-center justify-center shrink-0">
                <CarIcon size={13} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[12px] font-semibold text-gray-900 truncate">
                  {activeVehicle.manufacturer} {activeVehicle.model}
                </div>
                <div className="text-[10px] text-gray-500 font-mono truncate">
                  {activeVehicle.plate}
                </div>
              </div>
            </div>
            <button
              onClick={() => update({ vehicleOnly: true })}
              className="w-full text-[11px] bg-blue-600 hover:bg-blue-700 text-white rounded-md py-1.5 cursor-pointer border-none font-semibold font-sans transition-colors"
            >
              Зөвхөн энэ машинд тааруулах
            </button>
          </div>
        )}
      </FilterSection>

      {/* CATEGORY — nested accordion (Main → Sub), scrollable */}
      <FilterSection title="Ангилал">
        <div className="space-y-0.5 max-h-80 overflow-y-auto pr-1 -mr-1">
          {/* Бүгд */}
          <button onClick={() => update({ cat: "all" })}
            className={`w-full text-left px-2.5 py-1.5 rounded-lg text-[12.5px] cursor-pointer border-none font-sans transition-colors ${
              filters.cat === "all" ? "bg-blue-50 text-blue-700 font-semibold" : "bg-transparent text-gray-600 hover:bg-gray-50"
            }`}>
            Бүгд
          </button>

          {mains.map((m) => {
            const subs = subsOf(m.id);
            const selfActive  = filters.cat === m.id;
            const childActive = subs.some((s) => s.id === filters.cat);
            const open = openCats.has(m.id) || childActive;
            return (
              <div key={m.id}>
                <div className="flex items-center gap-0.5">
                  {subs.length > 0 ? (
                    <button onClick={() => toggleCat(m.id)} aria-label="Дэлгэх/Хумих"
                      className="shrink-0 w-6 h-7 flex items-center justify-center text-gray-400 hover:text-blue-700 cursor-pointer bg-transparent border-none">
                      <ChevronDown size={13} className={`transition-transform ${open ? "" : "-rotate-90"}`} />
                    </button>
                  ) : (
                    <span className="shrink-0 w-6" />
                  )}
                  <button onClick={() => { update({ cat: m.id }); if (subs.length) openCat(m.id); }}
                    className={`flex-1 min-w-0 text-left px-2 py-1.5 rounded-lg text-[12.5px] cursor-pointer border-none font-sans transition-colors flex items-center justify-between gap-2 ${
                      selfActive ? "bg-blue-50 text-blue-700 font-semibold"
                      : childActive ? "text-blue-700 font-medium hover:bg-gray-50"
                      : "bg-transparent text-gray-600 hover:bg-gray-50"
                    }`}>
                    <span className="flex items-center gap-1.5 truncate">
                      {m.imageUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={m.imageUrl} alt="" className="w-4 h-4 rounded object-cover shrink-0" />
                      )}
                      <span className="truncate">{m.name}</span>
                    </span>
                    {m.count > 0 && (
                      <span className="shrink-0 text-[10px] text-gray-400 font-mono">{m.count}</span>
                    )}
                  </button>
                </div>

                {/* sub-parts */}
                {open && subs.length > 0 && (
                  <div className="ml-6 mt-0.5 mb-1 space-y-0.5 border-l border-gray-100 pl-1.5">
                    {subs.map((s) => {
                      const active = filters.cat === s.id;
                      return (
                        <button key={s.id} onClick={() => update({ cat: s.id })}
                          className={`w-full text-left px-2 py-1 rounded-lg text-[12px] cursor-pointer border-none font-sans transition-colors flex items-center justify-between gap-2 ${
                            active ? "bg-blue-50 text-blue-700 font-semibold" : "bg-transparent text-gray-500 hover:bg-gray-50"
                          }`}>
                          <span className="truncate">{s.name}</span>
                          {s.count > 0 && (
                            <span className="shrink-0 text-[10px] text-gray-400 font-mono">{s.count}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
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
