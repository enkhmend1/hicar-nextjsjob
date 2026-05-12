"use client";
import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Navbar from "@/app/components/Navbar";
import ProductCard from "@/app/components/ProductCard";
import { PRODUCTS, CATEGORIES } from "@/lib/data";
import { Search, SlidersHorizontal } from "lucide-react";

function ShopInner() {
  const params = useSearchParams();
  const [cat, setCat] = useState(params.get("cat") || "all");
  const [q, setQ] = useState(params.get("q") || "");
  const [sort, setSort] = useState("default");
  const [srcFilter, setSrcFilter] = useState("all");

  const filtered = PRODUCTS
    .filter(p => cat === "all" || p.category === cat)
    .filter(p => srcFilter === "all" || p.source === srcFilter)
    .filter(p => !q || p.name.toLowerCase().includes(q.toLowerCase()) || p.oem.includes(q) || p.brand.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) =>
      sort === "price_asc" ? a.price - b.price :
      sort === "price_desc" ? b.price - a.price :
      sort === "name" ? a.name.localeCompare(b.name) : 0
    );

  return (
    <>
      <Navbar />
      <div className="max-w-6xl mx-auto px-5 py-5">
        {/* Header */}
        <div className="flex flex-col sm:flex-row gap-3 mb-5">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={q} onChange={e => setQ(e.target.value)}
              className="w-full bg-white border border-gray-200 rounded-xl pl-9 pr-4 py-2.5 text-[14px] focus:border-violet-500 shadow-sm"
              placeholder="Сэлбэг хайх... (нэр, OEM, брэнд)" />
          </div>
          <div className="flex gap-2">
            <select value={srcFilter} onChange={e => setSrcFilter(e.target.value)}
              className="bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-[13px] text-gray-600 cursor-pointer focus:border-violet-500 font-sans shadow-sm">
              <option value="all">Бүх эх сурвалж</option>
              <option value="amayama">Amayama JP</option>
              <option value="partsouq">Partsouq UAE</option>
              <option value="local">Монгол дэлгүүр</option>
            </select>
            <select value={sort} onChange={e => setSort(e.target.value)}
              className="bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-[13px] text-gray-600 cursor-pointer focus:border-violet-500 font-sans shadow-sm">
              <option value="default">Ангилах</option>
              <option value="price_asc">Үнэ: бага → их</option>
              <option value="price_desc">Үнэ: их → бага</option>
              <option value="name">Нэрээр</option>
            </select>
          </div>
        </div>

        {/* Category pills */}
        <div className="flex gap-2 overflow-x-auto scrollbar-none pb-1 mb-5">
          {CATEGORIES.map(c => (
            <button key={c.id} onClick={() => setCat(c.id)}
              className={`shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-full text-[13px] font-medium cursor-pointer border transition-all font-sans ${
                cat === c.id
                  ? "bg-violet-600 text-white border-violet-600 shadow-md shadow-violet-200"
                  : "bg-white text-gray-600 border-gray-200 hover:border-violet-400 hover:text-violet-600"
              }`}>
              {c.name}
              {cat === c.id && <span className="text-[11px] opacity-75">{filtered.length}</span>}
            </button>
          ))}
        </div>

        {/* Results info */}
        <div className="flex items-center justify-between mb-3">
          <p className="text-[13px] text-gray-500">
            <span className="font-semibold text-gray-900">{filtered.length}</span> бараа олдлоо
          </p>
          <div className="flex items-center gap-1 text-[12px] text-gray-400">
            <SlidersHorizontal size={12} /> Шүүлт
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="text-center py-20">
            <div className="text-4xl mb-3">🔍</div>
            <p className="text-[15px] font-medium text-gray-700 mb-1">Илэрц олдсонгүй</p>
            <p className="text-[13px] text-gray-400">Хайлтын үгийг өөрчилж үзнэ үү</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {filtered.map(p => <ProductCard key={p.id} p={p} />)}
          </div>
        )}
      </div>
    </>
  );
}

export default function ShopPage() {
  return <Suspense fallback={<div className="min-h-screen bg-gray-50" />}><ShopInner /></Suspense>;
}
