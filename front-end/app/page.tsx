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
  return <svg className="w-4 h-4 fill-violet-600" viewBox="0 0 24 24"><path d={d} /></svg>;
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
      <section className="hero-bg px-5 pt-10 pb-8">
        <div className="max-w-6xl mx-auto">
          <div className="inline-flex items-center gap-1.5 bg-violet-100 text-violet-600 text-[11px] font-semibold px-3 py-1.5 rounded-full mb-5 tracking-wide">
            <span className="w-1.5 h-1.5 rounded-full bg-violet-600" />{t("home.badge")}
          </div>
          <h1 className="text-[clamp(28px,5vw,46px)] font-semibold text-gray-900 leading-[1.15] tracking-tight mb-3">
            {t("home.title1")}<br />
            {t("home.title2")} <em className="text-violet-600 not-italic">{t("home.titleAi")}</em>{t("home.title3")}<br />
            {t("home.title4")}
          </h1>
          <p className="text-[15px] text-gray-500 leading-relaxed mb-6 max-w-md">
            {t("home.subtitle")}
          </p>
          <div className="flex flex-wrap gap-3 mb-4">
            {[{ icon: <Shield size={13} />, text: t("home.trust1") }, { icon: <Truck size={13} />, text: t("home.trust2") }, { icon: <Star size={13} />, text: t("home.trust3") }].map(({ icon, text }) => (
              <div key={text} className="flex items-center gap-1.5 text-[12px] text-gray-600 bg-white border border-gray-200 rounded-full px-3 py-1.5">
                <span className="text-violet-500">{icon}</span>{text}
              </div>
            ))}
          </div>
          <div className="flex gap-2.5 mb-8">
            {!user && (
              <Link href="/auth/register"
                className="bg-violet-600 hover:bg-violet-700 text-white rounded-xl px-6 py-2.5 text-[14px] font-semibold transition-colors"
                style={{ textDecoration: "none" }}>
                {t("home.btnRegister")}
              </Link>
            )}
            <Link href="/shop"
              className={`${user ? "bg-violet-600 hover:bg-violet-700 text-white" : "border border-gray-300 hover:border-violet-500 hover:text-violet-600 text-gray-700"} rounded-xl px-6 py-2.5 text-[14px] ${user ? "font-semibold" : ""} transition-colors`}
              style={{ textDecoration: "none" }}>
              {t("home.btnShop")}
            </Link>
          </div>
          <SearchCard />
        </div>
      </section>

      <BrandsBar />

      <div className="max-w-6xl mx-auto px-5 py-7 space-y-8">
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[16px] font-semibold text-gray-900">{t("home.categoriesTitle")}</h2>
            <Link href="/shop" className="text-[13px] text-violet-600 hover:underline font-medium" style={{ textDecoration: "none" }}>{t("home.viewAll")} →</Link>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {categories.length === 0
              ? Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="bg-white border border-gray-200 rounded-xl h-[90px] animate-pulse" />
                ))
              : categories.map((c) => (
                  <Link key={c.id} href={`/shop?cat=${c.id}`} style={{ textDecoration: "none" }}>
                    <CategoryCard
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
            <Link href="/shop" className="text-[13px] text-violet-600 hover:underline font-medium" style={{ textDecoration: "none" }}>{t("home.viewAll")} →</Link>
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
            { icon: <Shield size={20} />, title: "OEM Баталгаа", desc: "Бүх бараа оригинал OEM чанарын гэрчилгээтэй" },
            { icon: <Truck size={20} />, title: "Хурдан хүргэлт", desc: "Японоос 7–14 хоногт Улаанбаатар хүргэнэ" },
            { icon: <Clock size={20} />, title: "7/24 Дэмжлэг", desc: "Техникийн асуудлаар манай багт хандана уу" },
          ].map(({ icon, title, desc }) => (
            <div key={title} className="bg-white border border-gray-200 rounded-xl p-4 flex gap-3 items-start">
              <div className="w-9 h-9 bg-violet-50 rounded-xl flex items-center justify-center shrink-0 text-violet-600">{icon}</div>
              <div><div className="text-[13px] font-semibold text-gray-900 mb-0.5">{title}</div><div className="text-[12px] text-gray-500 leading-relaxed">{desc}</div></div>
            </div>
          ))}
        </div>
      </div>

      <footer className="bg-white border-t border-gray-200 mt-4">
        <div className="max-w-6xl mx-auto px-5 py-5 flex flex-wrap items-center justify-between gap-3">
          <span className="text-[18px] font-semibold"><em className="text-violet-600 not-italic">Hi</em>car</span>
          <div className="flex flex-wrap gap-5">
            {[t("home.footerHelp"), t("home.footerShipping"), t("home.footerReturn"), t("home.footerAbout")].map(l => (
              <a key={l} href="#" className="text-[13px] text-gray-400 hover:text-violet-600 transition-colors" style={{ textDecoration: "none" }}>{l}</a>
            ))}
          </div>
          <div className="text-[12px] text-gray-400">© 2025 HiCar MN</div>
        </div>
      </footer>
    </>
  );
}
