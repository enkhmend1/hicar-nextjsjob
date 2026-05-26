"use client";

/**
 * Public seller storefront — Phase P.2.
 *
 * /store/[id]  — anyone can visit (no auth). Buyer-facing showcase of
 * a single seller: identity, trust signals, full product catalogue,
 * about copy. Designed to feel like a real shop page (Etsy, Amazon
 * seller storefront) — not a debug dump of a User document.
 *
 * Visual architecture:
 *
 *   ┌──────────────────────────────────────────────────────┐
 *   │  Cover gradient (decorative)                         │
 *   │                                                      │
 *   │         [Logo]  Shop Name           ← overlap card   │
 *   │                 ⭐ rating · trust ## · joined        │
 *   └──────────────────────────────────────────────────────┘
 *   │  [KPI · KPI · KPI · KPI]                            │
 *   │  [Tabs:  Бараа  ·  Бидний тухай  ·  Ангилал]        │
 *   │                                                      │
 *   │  Filter chips: All · Тоормос · Хөдөлгүүр · …         │
 *   │  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐                    │
 *   │  │ Pro │ │ Pro │ │ Pro │ │ Pro │  ← reuses          │
 *   │  └─────┘ └─────┘ └─────┘ └─────┘    ProductCard     │
 *
 * Design rationale (why "senior frontend"):
 *   • Asymmetric hero (cover + overlap logo) borrowed from LinkedIn /
 *     Etsy patterns — instantly readable as a "profile" surface.
 *   • Per-family category chips reuse the Phase O.5 tone system, so
 *     the storefront feels native to the rest of the catalogue.
 *   • Trust signals (rating, trust score, joined date, product count)
 *     are first-class above the fold — exactly what a buyer needs to
 *     decide whether to trust this seller in 3 seconds.
 *   • Empty-state messaging is friendly, not error-shaped — a new
 *     seller without products yet still looks intentional.
 *   • All public data is sanitized server-side (Phase P.1) so we don't
 *     even have access to leak email/phone/bank/commission from this
 *     page even if we wanted to.
 */

import { use, useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import BuyerShell from "@/app/components/BuyerShell";
import ProductCard from "@/app/components/ProductCard";
import Breadcrumbs from "@/app/components/Breadcrumbs";
import { api, ApiError } from "@/lib/api";
import { Product } from "@/app/types";
import { visualFor, toneStyles, type CategoryTone } from "@/app/lib/categoryIcons";
import {
  Store, Star, Shield, Package, Calendar, ShoppingBag,
  ArrowLeft, Award, TrendingUp,
} from "lucide-react";

interface Shop {
  id:          string;
  shopName:    string;
  description: string;
  logo:        string;
  /** Optional custom cover banner (16:5). Empty string → render the
   *  default brand gradient instead. */
  coverImage:  string;
  trustScore:  number;
  rating:      number;
  ratingCount: number;
  totalSales:  number;
  joinedAt:    string;
}
interface StorefrontResponse {
  shop:     Shop;
  products: Product[];
  stats:    { totalProducts: number; categoryBreakdown: Record<string, number> };
}

type Tab = "products" | "about" | "categories";

const fmtJoinDate = (iso: string) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("mn-MN", { year: "numeric", month: "long" });
};

/** Trust-score colour bands — same logic as the admin sellers list,
 *  duplicated locally to keep this page self-contained. */
const trustTone = (score: number): { bg: string; text: string; label: string } => {
  if (score >= 80) return { bg: "bg-emerald-50 border-emerald-200", text: "text-emerald-700", label: "Маш найдвартай" };
  if (score >= 60) return { bg: "bg-blue-50 border-blue-200",       text: "text-blue-700",    label: "Найдвартай" };
  if (score >= 40) return { bg: "bg-amber-50 border-amber-200",     text: "text-amber-700",   label: "Дунд зэргийн" };
  return                   { bg: "bg-red-50 border-red-200",        text: "text-red-700",     label: "Шинэ / шалгагдаж байна" };
};

export default function SellerStorefrontPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const [data, setData]       = useState<StorefrontResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [tab, setTab]   = useState<Tab>("products");
  const [cat, setCat]   = useState<string>("all");

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setNotFound(false);
    api.get<StorefrontResponse>(`/seller/store/${id}`)
      .then((r) => { if (!cancelled) setData(r); })
      .catch((e) => {
        if (cancelled) return;
        if ((e as ApiError).status === 404) setNotFound(true);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id]);

  // ── Loading skeleton — keep the cover/header silhouette to avoid
  // a jarring blank flash on slow networks.
  if (loading) {
    return (
      <BuyerShell>
        <div className="bg-gradient-to-br from-blue-100 to-amber-50 h-44" />
        <div className="max-w-6xl mx-auto px-5 -mt-12">
          <div className="bg-white border border-gray-200 rounded-2xl h-32 animate-pulse" />
        </div>
        <div className="max-w-6xl mx-auto px-5 py-8 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="bg-white border border-gray-200 rounded-xl h-[260px] animate-pulse" />
          ))}
        </div>
      </BuyerShell>
    );
  }

  if (notFound || !data) {
    return (
      <BuyerShell>
        <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-6">
          <div className="w-20 h-20 bg-gray-100 rounded-2xl flex items-center justify-center mb-5">
            <Store size={36} className="text-gray-300" />
          </div>
          <h2 className="text-[18px] font-semibold text-gray-900 mb-2">Дэлгүүр олдсонгүй</h2>
          <p className="text-[14px] text-gray-500 mb-6">Энэ дэлгүүр одоогоор идэвхгүй байж болзошгүй.</p>
          <Link href="/shop" className="inline-flex items-center gap-2 bg-blue-700 hover:bg-blue-800 text-white rounded-xl px-5 py-2.5 text-[14px] font-semibold transition-colors">
            <ArrowLeft size={14} /> Дэлгүүр рүү буцах
          </Link>
        </div>
      </BuyerShell>
    );
  }

  const { shop, products, stats } = data;
  const trust   = trustTone(shop.trustScore);
  const filtered = cat === "all" ? products : products.filter((p) => p.category === cat);
  const breakdownEntries = Object.entries(stats.categoryBreakdown).sort((a, b) => b[1] - a[1]);

  return (
    <BuyerShell>

      {/* ── Cover banner — seller's custom upload OR brand gradient.
          When a custom cover is set we render it with object-cover
          (matches the 16:5 recommended ratio without letterboxing)
          plus a slight bottom-fade overlay so the white identity
          card has enough contrast where it overlaps. */}
      <div className="relative h-44 sm:h-56 bg-gradient-to-br from-blue-700 via-blue-600 to-amber-500 overflow-hidden">
        {shop.coverImage ? (
          <>
            <Image
              src={shop.coverImage}
              alt=""
              fill
              sizes="100vw"
              className="object-cover"
              priority
              unoptimized
            />
            {/* Bottom fade — ensures the overlap card's shadow lifts off
                cleanly even when the cover photo happens to be light at
                the bottom edge. */}
            <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/15 to-transparent" />
          </>
        ) : (
          <div
            className="absolute inset-0 opacity-30"
            style={{
              backgroundImage: "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.4) 1px, transparent 0)",
              backgroundSize: "20px 20px",
            }}
          />
        )}
      </div>

      {/* ── Overlap identity card — logo + shop name + headline trust. */}
      <div className="max-w-6xl mx-auto px-5 -mt-16 relative z-10">
        {/* Phase W.1: breadcrumbs sit above the overlap card. Uses
            white text because the section sits on the cover image
            gradient. Pulls double duty as SEO BreadcrumbList. */}
        <Breadcrumbs
          className="mb-2 text-white/90 [&_span[aria-current=page]]:text-white [&_a]:hover:text-amber-300"
          items={[
            { label: "Нүүр", href: "/" },
            { label: "Дэлгүүр", href: "/shop" },
            { label: shop.shopName },
          ]}
        />
        <div className="bg-white border border-gray-200 rounded-2xl shadow-xl shadow-blue-900/5 p-5 sm:p-6">
          <div className="flex flex-col sm:flex-row gap-5 items-start">
            {/* Logo — fills with the shop image if uploaded, falls back
                to a tone-coloured initial monogram. */}
            <div className="shrink-0 w-20 h-20 sm:w-24 sm:h-24 rounded-2xl bg-gradient-to-br from-blue-100 to-amber-100 ring-4 ring-white shadow-lg flex items-center justify-center overflow-hidden">
              {shop.logo ? (
                <Image src={shop.logo} alt={shop.shopName} width={96} height={96} className="object-cover w-full h-full" unoptimized />
              ) : (
                <span className="text-blue-700 text-3xl font-bold">{shop.shopName[0]?.toUpperCase() ?? "?"}</span>
              )}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <h1 className="text-[22px] sm:text-[26px] font-semibold text-gray-900 tracking-tight">{shop.shopName}</h1>
                {/* Verified-style chip — every seller on this page IS
                    an approved seller, so this badge is always shown. */}
                <span className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 border border-blue-200 text-[11px] font-semibold px-2 py-0.5 rounded-full">
                  <Shield size={10} /> Баталгаажсан
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-[12px] text-gray-500">
                {shop.rating > 0 && (
                  <span className="inline-flex items-center gap-1">
                    <Star size={12} className="fill-amber-400 text-amber-400" />
                    <span className="font-semibold text-gray-700">{shop.rating.toFixed(1)}</span>
                    <span>({shop.ratingCount} үнэлгээ)</span>
                  </span>
                )}
                <span className="inline-flex items-center gap-1">
                  <Calendar size={11} /> {fmtJoinDate(shop.joinedAt)}-аас
                </span>
                <span className={`inline-flex items-center gap-1 ${trust.bg} ${trust.text} border px-2 py-0.5 rounded-full font-medium`}>
                  <Award size={10} /> {trust.label} · {shop.trustScore}
                </span>
              </div>
            </div>

            {/* CTA column — Back to shop on small screens, prominent on desktop. */}
            <div className="hidden sm:block shrink-0">
              <Link href="/shop" className="inline-flex items-center gap-1.5 text-[12px] text-gray-500 hover:text-blue-700 transition-colors">
                <ArrowLeft size={12} /> Бүх дэлгүүр
              </Link>
            </div>
          </div>

          {/* ── KPI strip — 4 trust signals at a glance. */}
          <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Kpi icon={Package}   label="Бараа"          value={stats.totalProducts.toString()} tone="blue"    />
            <Kpi icon={ShoppingBag} label="Зарагдсан"   value={shop.totalSales.toLocaleString()} tone="emerald" />
            <Kpi icon={Star}      label="Үнэлгээ"        value={shop.rating > 0 ? `${shop.rating.toFixed(1)}/5` : "—"} tone="amber" />
            <Kpi icon={TrendingUp} label="Итгэлийн оноо" value={`${shop.trustScore}/100`} tone="indigo" />
          </div>
        </div>
      </div>

      {/* ── Tabs */}
      <div className="max-w-6xl mx-auto px-5 mt-6 border-b border-gray-200 flex gap-1">
        {([
          { id: "products",   label: "Бараа",         count: stats.totalProducts },
          { id: "about",      label: "Бидний тухай",  count: null },
          { id: "categories", label: "Ангилал",       count: breakdownEntries.length },
        ] as const).map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-[13px] font-medium cursor-pointer bg-transparent border-none border-b-2 transition-colors font-sans ${
              tab === t.id ? "border-blue-700 text-blue-700" : "border-transparent text-gray-500 hover:text-gray-700"
            }`}>
            {t.label}
            {t.count !== null && (
              <span className="ml-1.5 text-[11px] text-gray-400">({t.count})</span>
            )}
          </button>
        ))}
      </div>

      <div className="max-w-6xl mx-auto px-5 py-6">
        {tab === "products" && (
          <>
            {/* Category filter chips — only render if seller has ≥2 categories. */}
            {breakdownEntries.length >= 2 && (
              <div className="flex flex-wrap gap-2 mb-5">
                <CatChip active={cat === "all"} label="Бүгд" count={products.length} onClick={() => setCat("all")} />
                {breakdownEntries.map(([catId, n]) => (
                  <CatChip key={catId}
                    active={cat === catId}
                    label={catId.replace(/_/g, " ")}
                    count={n}
                    tone={visualFor(catId)?.tone}
                    onClick={() => setCat(catId)} />
                ))}
              </div>
            )}

            {filtered.length === 0 ? (
              <div className="bg-white border border-gray-200 rounded-2xl p-10 text-center">
                <Package className="w-12 h-12 text-gray-300 mx-auto mb-3" strokeWidth={1.5} />
                <p className="text-[14px] font-medium text-gray-700">Энэ ангилалд бараа алга</p>
                <p className="text-[12px] text-gray-400 mt-1">Өөр ангилал сонгож үзнэ үү</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {filtered.map((p) => <ProductCard key={p._id ?? p.id} p={p} />)}
              </div>
            )}
          </>
        )}

        {tab === "about" && (
          <div className="max-w-2xl bg-white border border-gray-200 rounded-2xl p-6">
            <h2 className="text-[16px] font-semibold text-gray-900 mb-3 flex items-center gap-2">
              <Store size={16} className="text-blue-700" /> Дэлгүүрийн танилцуулга
            </h2>
            {shop.description ? (
              <p className="text-[14px] text-gray-700 leading-relaxed whitespace-pre-line">
                {shop.description}
              </p>
            ) : (
              <p className="text-[13px] text-gray-400 italic">
                Энэ дэлгүүр одоогоор танилцуулгаа нэмээгүй байна.
              </p>
            )}

            <div className="mt-6 pt-5 border-t border-gray-100 grid grid-cols-2 gap-4 text-[13px]">
              <div>
                <div className="text-[11px] text-gray-400 uppercase tracking-wider mb-1">Нэгдсэн</div>
                <div className="font-medium text-gray-900">{fmtJoinDate(shop.joinedAt)}</div>
              </div>
              <div>
                <div className="text-[11px] text-gray-400 uppercase tracking-wider mb-1">Идэвхтэй бараа</div>
                <div className="font-medium text-gray-900">{stats.totalProducts.toLocaleString()}</div>
              </div>
              <div>
                <div className="text-[11px] text-gray-400 uppercase tracking-wider mb-1">Итгэлийн оноо</div>
                <div className={`inline-flex items-center gap-1 ${trust.bg} ${trust.text} border px-2 py-0.5 rounded-full font-semibold`}>
                  <Award size={10} /> {shop.trustScore}/100
                </div>
              </div>
              <div>
                <div className="text-[11px] text-gray-400 uppercase tracking-wider mb-1">Платформ</div>
                <div className="font-medium text-gray-900 inline-flex items-center gap-1">
                  <em className="text-blue-700 not-italic">Hi</em>car баталгаа
                </div>
              </div>
            </div>
          </div>
        )}

        {tab === "categories" && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {breakdownEntries.length === 0 ? (
              <div className="col-span-full text-center py-10 text-gray-400 text-[13px]">
                Ангилал алга
              </div>
            ) : breakdownEntries.map(([catId, n]) => {
              const visual = visualFor(catId);
              const tone   = visual ? toneStyles(visual.tone) : null;
              const Icon   = visual?.Icon;
              return (
                <button key={catId}
                  onClick={() => { setCat(catId); setTab("products"); }}
                  className="group bg-white border border-gray-200 rounded-2xl p-4 text-left cursor-pointer hover:border-blue-400 hover:shadow-lg hover:shadow-blue-100/50 hover:-translate-y-0.5 transition-all font-sans">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center ring-1 ring-inset mb-3 ${
                    tone ? `${tone.bg} ${tone.ring}` : "bg-gray-50 ring-gray-200"
                  }`}>
                    {Icon ? <Icon size={22} strokeWidth={1.75} className={tone?.icon ?? "text-gray-500"} /> : null}
                  </div>
                  <div className="text-[13px] font-semibold text-gray-900 mb-0.5 capitalize">
                    {catId.replace(/_/g, " ")}
                  </div>
                  <div className="text-[11px] text-gray-500">{n} бараа</div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </BuyerShell>
  );
}

// ────────────────────────────────────────────────────────────────────
// Sub-components
// ────────────────────────────────────────────────────────────────────

interface KpiProps {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  value: string;
  tone: "blue" | "emerald" | "amber" | "indigo";
}
function Kpi({ icon: Icon, label, value, tone }: KpiProps) {
  const tones: Record<KpiProps["tone"], { bg: string; icon: string }> = {
    blue:    { bg: "bg-blue-50",    icon: "text-blue-700" },
    emerald: { bg: "bg-emerald-50", icon: "text-emerald-700" },
    amber:   { bg: "bg-amber-50",   icon: "text-amber-700" },
    indigo:  { bg: "bg-indigo-50",  icon: "text-indigo-700" },
  };
  const t = tones[tone];
  return (
    <div className="flex items-center gap-2.5 bg-gray-50 border border-gray-100 rounded-xl p-3">
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${t.bg}`}>
        <Icon size={16} className={t.icon} />
      </div>
      <div className="min-w-0">
        <div className="text-[11px] text-gray-500 leading-tight">{label}</div>
        <div className="text-[15px] font-bold text-gray-900 truncate">{value}</div>
      </div>
    </div>
  );
}

interface CatChipProps {
  active: boolean;
  label:  string;
  count:  number;
  tone?:  CategoryTone;
  onClick: () => void;
}
function CatChip({ active, label, count, tone, onClick }: CatChipProps) {
  const toneClasses = tone ? toneStyles(tone) : null;
  return (
    <button onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium cursor-pointer border transition-all font-sans capitalize ${
        active
          ? `${toneClasses?.bg ?? "bg-blue-50"} ${toneClasses?.icon ?? "text-blue-700"} border-current/30 ring-1 ring-current/10`
          : "bg-white border-gray-200 text-gray-600 hover:border-blue-400 hover:text-blue-700"
      }`}>
      {label}
      <span className={`text-[10px] ${active ? "opacity-70" : "text-gray-400"}`}>{count}</span>
    </button>
  );
}
