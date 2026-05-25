"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import Navbar from "./components/Navbar";
import SearchCard from "./components/SearchCard";
import BrandsBar from "./components/BrandsBar";
import CategoryCard from "./components/CategoryCard";
import ProductCard from "./components/ProductCard";
import AIBanner from "./components/AIBanner";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useAuthStore } from "@/store";
import { Product } from "@/app/types";
import { Shield, Truck, Clock, Star } from "lucide-react";

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
type HomepageCategory = { id: string; name: string; iconPath: string; count: number };

export default function Home() {
  const t = useT();
  const user = useAuthStore((s) => s.user);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<HomepageCategory[]>([]);

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
    <>
      <Navbar />
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
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[16px] font-semibold text-gray-900">{t("home.categoriesTitle")}</h2>
            <Link href="/shop" className="text-[13px] text-blue-600 hover:underline font-medium">{t("home.viewAll")} →</Link>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {categories.length === 0
              ? Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="bg-white border border-gray-200 rounded-xl h-[90px] animate-pulse" />
                ))
              : categories.map((c) => (
                  <Link key={c.id} href={`/shop?cat=${c.id}`}>
                    <CategoryCard
                      id={c.id}
                      name={c.name}
                      count={`${c.count.toLocaleString()} зүйл`}
                      icon={<CatIcon d={c.iconPath} />}
                    />
                  </Link>
                ))}
          </div>
        </div>

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
            { icon: <Shield size={20} />, title: "OEM Баталгаа", desc: "Оригинал бараа OEM" },
            { icon: <Truck size={20} />, title: "Хурдан хүргэлт", desc: " Хурдан хүргэлт" },
            { icon: <Clock size={20} />, title: "7/24 Дэмжлэг", desc: "Техникийн асуудлаар манай багт хандана уу" },
          ].map(({ icon, title, desc }) => (
            <div key={title} className="bg-white border border-gray-200 rounded-xl p-4 flex gap-3 items-start">
              <div className="w-9 h-9 bg-blue-50 rounded-xl flex items-center justify-center shrink-0 text-blue-600">{icon}</div>
              <div><div className="text-[13px] font-semibold text-gray-900 mb-0.5">{title}</div><div className="text-[12px] text-gray-500 leading-relaxed">{desc}</div></div>
            </div>
          ))}
        </div>
      </div>

      {/* Phase N — footer expanded from 1-line strip to a proper
          marketplace footer: brand block + 3 link columns + payment
          row. Builds trust (the previous footer felt placeholder-y for
          a checkout-bearing site that handles real money). */}
      <footer className="bg-gray-900 text-gray-300 mt-8">
        <div className="max-w-6xl mx-auto px-5 py-10">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-8">
            <div className="col-span-2 md:col-span-1">
              <div className="text-[22px] font-semibold text-white mb-3">
                <em className="text-amber-400 not-italic">Hi</em>car
              </div>
              <p className="text-[12px] text-gray-400 leading-relaxed mb-4 max-w-xs">
                {t("home.subtitle")}
              </p>
              <div className="flex gap-2 text-[10px] text-gray-500">
                <span className="bg-gray-800 border border-gray-700 px-2 py-1 rounded">QPay</span>
                <span className="bg-gray-800 border border-gray-700 px-2 py-1 rounded">Khan Bank</span>
                <span className="bg-gray-800 border border-gray-700 px-2 py-1 rounded">Golomt</span>
              </div>
            </div>

            <div>
              <div className="text-[12px] font-semibold text-white mb-3 uppercase tracking-wider">{t("home.footerHelp")}</div>
              <ul className="space-y-2 text-[13px]">
                <li><Link href="/shop" className="text-gray-400 hover:text-amber-400 transition-colors">{t("nav.shop")}</Link></li>
                <li><Link href="/lookup" className="text-gray-400 hover:text-amber-400 transition-colors">Улсын дугаар</Link></li>
                <li><Link href="/orders" className="text-gray-400 hover:text-amber-400 transition-colors">{t("nav.orders")}</Link></li>
                <li><Link href="/garage" className="text-gray-400 hover:text-amber-400 transition-colors">Миний машинууд</Link></li>
              </ul>
            </div>

            <div>
              <div className="text-[12px] font-semibold text-white mb-3 uppercase tracking-wider">{t("home.footerAbout")}</div>
              <ul className="space-y-2 text-[13px]">
                <li><a href="#" className="text-gray-400 hover:text-amber-400 transition-colors">{t("home.footerShipping")}</a></li>
                <li><a href="#" className="text-gray-400 hover:text-amber-400 transition-colors">{t("home.footerReturn")}</a></li>
                <li><Link href="/seller/apply" className="text-gray-400 hover:text-amber-400 transition-colors">{t("nav.becomeSeller")}</Link></li>
              </ul>
            </div>

            <div>
              <div className="text-[12px] font-semibold text-white mb-3 uppercase tracking-wider">Холбоо барих</div>
              <ul className="space-y-2 text-[13px] text-gray-400">
                <li>📞 +976 7700-0000</li>
                <li>✉ info@hicar.mn</li>
                <li>📍 Улаанбаатар</li>
              </ul>
            </div>
          </div>

          <div className="pt-6 border-t border-gray-800 flex flex-wrap items-center justify-between gap-3 text-[11px] text-gray-500">
            <span>© 2026 HiCar MN. Бүх эрх хуулиар хамгаалагдсан.</span>
            <span>OEM-баталгаатай авто сэлбэгийн платформ</span>
          </div>
        </div>
      </footer>
    </>
  );
}
