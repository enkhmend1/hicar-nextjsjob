"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import BuyerShell from "./components/BuyerShell";
import SearchCard from "./components/SearchCard";
import BrandsBar from "./components/BrandsBar";
import CategoryCard from "./components/CategoryCard";
import ProductCard from "./components/ProductCard";
import AIBanner from "./components/AIBanner";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useAuthStore } from "@/store";
import { Product } from "@/app/types";
import { Shield, Truck, Clock, Star, ChevronDown, LayoutGrid } from "lucide-react";

function CatIcon({ d }: { d: string }) {
  return <svg className="w-4 h-4 fill-blue-600" viewBox="0 0 24 24"><path d={d} /></svg>;
}

/**
 * Homepage category strip. Was previously driven by a hardcoded list in
 * lib/data.ts (5200, 860, 1240, ...) — those were placeholder numbers
 * that never matched the real catalogue.
 *
 * Now sourced from `/api/site-content/categories` which joins admin-
 * editable display metadata (name, icon SVG path, order, visible) with
 * a live MongoDB aggregate count of approved products. Admins can edit
 * the labels/icons/visibility at /admin/site-content; the counts are
 * always real.
 */
type HomepageCategory = { id: string; name: string; iconPath: string; imageUrl?: string; count: number };

export default function Home() {
  const t = useT();
  const user = useAuthStore((s) => s.user);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<HomepageCategory[]>([]);
  // Phase R: categories collapsed by default — show a teaser of the
  // most popular 6 (one desktop row) + an "expand to all 34" toggle.
  // Same pattern Amazon / AliExpress use to keep the homepage scannable.
  const [showAllCategories, setShowAllCategories] = useState(false);
  const CATEGORY_PREVIEW_COUNT = 6;

  useEffect(() => {
    api.get<{ items: Product[] }>("/products?limit=8")
      .then(d => setProducts(d.items))
      .catch(() => setProducts([]))
      .finally(() => setLoading(false));
    api.get<{ categories: HomepageCategory[] }>("/site-content/categories")
      .then(d => setCategories(d.categories || []))
      .catch(() => setCategories([]));
  }, []);

  return (
    <BuyerShell>
      {/* Phase N — hero re-architected. The OLD hero buried the search
          under a wall of copy + redundant CTAs (Register + Shop). The
          single most valuable action on this site is "find a part for
          my car" → the search card now anchors the hero, headline is
          leaner, trust strip + register link move BELOW the search
          where they don't compete for the user's attention. */}
      <section className="hero-bg px-5 pt-12 pb-10">
        <div className="max-w-5xl mx-auto text-center">
          <div className="inline-flex items-center gap-1.5 bg-blue-50 text-blue-700 text-[11px] font-semibold px-3 py-1.5 rounded-full mb-6 tracking-wide border border-blue-100">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />{t("home.badge")}
          </div>

          <h1 className="text-[clamp(32px,5.5vw,52px)] font-semibold text-gray-900 leading-[1.1] tracking-tight mb-4 max-w-3xl mx-auto">
            {t("home.title1")}{" "}
            <em className="text-blue-700 not-italic relative inline-block">
              {t("home.titleAi")}
              {/* Amber underline accent — small dose, big visual weight. */}
              <span className="absolute -bottom-1 left-0 right-0 h-1 bg-amber-400/60 rounded" />
            </em>
            {t("home.title3")} {t("home.title4")}
          </h1>
          <p className="text-[15px] text-gray-500 leading-relaxed mb-8 max-w-xl mx-auto">
            {t("home.subtitle")}
          </p>

          {/* Search dominates — wider container + shadow anchors it visually. */}
          <div className="max-w-2xl mx-auto mb-6 text-left">
            <SearchCard />
          </div>

          {/* Trust strip below — compact, doesn't compete with the search. */}
          <div className="flex flex-wrap items-center justify-center gap-2 mb-5">
            {[
              { icon: <Shield size={12} />, text: t("home.trust1") },
              { icon: <Truck size={12} />,  text: t("home.trust2") },
              { icon: <Star size={12} />,   text: t("home.trust3") },
            ].map(({ icon, text }) => (
              <div key={text} className="flex items-center gap-1.5 text-[11px] text-gray-600 bg-white/80 backdrop-blur border border-gray-200/80 rounded-full px-3 py-1">
                <span className="text-amber-600">{icon}</span>{text}
              </div>
            ))}
          </div>

          {/* Only show register CTA for anon users — logged-in users
              don't need to be sold on signing up. */}
          {!user && (
            <Link href="/auth/register"
              className="inline-flex items-center gap-1.5 text-[13px] text-gray-500 hover:text-blue-700 transition-colors">
              {t("home.btnRegister")} <span className="text-blue-700">→</span>
            </Link>
          )}
        </div>
      </section>

      <BrandsBar />

      <div className="max-w-6xl mx-auto px-5 py-7 space-y-8">
        {/* ── CATEGORIES SECTION ──────────────────────────────────────
            Was: cramped 2/4 col grid, only ~8 cards above the fold.
            Now: full grid up to 6 cols on desktop showing EVERY visible
            category (admin-curated in SiteContent), so the user gets a
            real sense of the catalogue depth at a glance. Section header
            promotes the count to a chip so "we have 34 categories" lands
            as a trust signal, not a footnote. */}
        <section>
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2 mb-5">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h2 className="text-[20px] font-semibold text-gray-900 tracking-tight">{t("home.categoriesTitle")}</h2>
                {categories.length > 0 && (
                  <span className="inline-flex items-center bg-blue-50 text-blue-700 text-[11px] font-semibold px-2 py-0.5 rounded-full border border-blue-100">
                    {categories.length}
                  </span>
                )}
              </div>
              <p className="text-[13px] text-gray-500">
                Хүссэн сэлбэгээ ангилалаар хайж олоорой
              </p>
            </div>
            <Link href="/shop"
              className="inline-flex items-center gap-1 self-start sm:self-auto text-[13px] text-blue-700 hover:text-blue-800 font-medium transition-colors">
              {t("home.viewAll")} <span className="transition-transform group-hover:translate-x-0.5">→</span>
            </Link>
          </div>

          {/* Responsive grid: 3 cols on phone, 4 / 5 / 6 as viewport
              grows. Phase R — sliced to a teaser (6 = one full desktop
              row) when collapsed; full list when the user opts in. */}
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
            {categories.length === 0
              ? Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="bg-white border border-gray-200 rounded-2xl h-[120px] animate-pulse" />
                ))
              : (showAllCategories
                  ? categories
                  : categories.slice(0, CATEGORY_PREVIEW_COUNT)
                ).map((c) => (
                  <Link key={c.id} href={`/shop?cat=${c.id}`}>
                    <CategoryCard
                      id={c.id}
                      imageUrl={c.imageUrl || undefined}
                      name={c.name}
                      count={`${c.count.toLocaleString()} зүйл`}
                      icon={<CatIcon d={c.iconPath} />}
                    />
                  </Link>
                ))}
          </div>

          {/* Phase R: expand/collapse toggle — anchors the section so
              the homepage stays scannable above the fold (no infinite
              scroll of category cards before "Featured products"). */}
          {categories.length > CATEGORY_PREVIEW_COUNT && (
            <div className="mt-5 flex justify-center">
              <button
                type="button"
                onClick={() => setShowAllCategories((v) => !v)}
                className="group inline-flex items-center gap-2 bg-white hover:bg-blue-50 border border-gray-200 hover:border-blue-300 text-gray-700 hover:text-blue-700 rounded-xl px-5 py-2.5 text-[13px] font-semibold cursor-pointer transition-all shadow-sm hover:shadow-md font-sans">
                <LayoutGrid size={13} />
                {showAllCategories ? (
                  <>Хумих</>
                ) : (
                  <>
                    Бүх ангилал
                    <span className="inline-flex items-center bg-blue-100 text-blue-700 text-[10px] font-bold px-1.5 py-0.5 rounded-full ml-0.5">
                      {categories.length}
                    </span>
                  </>
                )}
                <ChevronDown
                  size={13}
                  className={`transition-transform duration-200 ${showAllCategories ? "rotate-180" : ""}`}
                />
              </button>
            </div>
          )}
        </section>

        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[16px] font-semibold text-gray-900">{t("home.featuredTitle")}</h2>
            <Link href="/shop" className="text-[13px] text-blue-600 hover:underline font-medium">{t("home.viewAll")} →</Link>
          </div>
          {loading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="bg-white border border-gray-200 rounded-xl h-[220px] animate-pulse" />
              ))}
            </div>
          ) : products.length === 0 ? (
            <div className="text-center py-10 text-[13px] text-gray-400">
              {t("home.empty")}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {products.map(p => <ProductCard key={p._id ?? p.id} p={p} />)}
            </div>
          )}
        </div>

        <AIBanner />

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { icon: <Shield size={20} />, title: "OEM баталгаа", desc: "Япон үйлдвэрлэгчийн жинхэнэ эх сурвалжтай" },
            { icon: <Truck size={20} />,  title: "Хурдан хүргэлт", desc: "Хурдан хүргэлт" },
            { icon: <Clock size={20} />,  title: "7/24 дэмжлэг", desc: "Техникийн асуудлаар бидэнтэй чөлөөтэй холбогдоно уу" },
          ].map(({ icon, title, desc }) => (
            <div key={title} className="bg-white border border-gray-200 rounded-xl p-4 flex gap-3 items-start">
              <div className="w-9 h-9 bg-blue-50 rounded-xl flex items-center justify-center shrink-0 text-blue-600">{icon}</div>
              <div><div className="text-[13px] font-semibold text-gray-900 mb-0.5">{title}</div><div className="text-[12px] text-gray-500 leading-relaxed">{desc}</div></div>
            </div>
          ))}
        </div>
      </div>

      {/* Phase U.1: footer + bottom nav moved to BuyerShell so every
          buyer page gets the same chrome (not just the homepage). */}
    </BuyerShell>
  );
}
