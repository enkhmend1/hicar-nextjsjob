/**
 * Product detail page — Phase AS redesign.
 *
 * Layout changes:
 *   • Desktop ≥lg: 2-column grid (image 5/12 · info 7/12) so the image
 *     gallery and CTA share viewport real estate. The OLD layout was
 *     max-w-2xl single-column which wasted half the screen on desktop.
 *   • Mobile: same content stacked, with a STICKY bottom CTA bar so
 *     the "Add to cart" button stays reachable while scrolling specs.
 *
 * Content additions:
 *   • Quantity stepper (+ / − / number) next to add-to-cart
 *   • Specs grid (Brand / OEM / Condition / Weight) — pulled from
 *     attributes when present, falls back gracefully when missing
 *   • Branded placeholder for missing images — initial letter + part
 *     name watermark, not just an empty blue gradient
 *   • Compatible vehicles as horizontal chip pills (scroll-x) so a long
 *     list doesn't push everything else down
 *
 * Preserved (no churn for proven UI):
 *   Breadcrumbs · seller card · ReviewSection · RelatedSections.
 */
"use client";
import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import BuyerShell from "@/app/components/BuyerShell";
import ReviewSection from "@/app/components/ReviewSection";
import { useCartStore } from "@/store";
import { api } from "@/lib/api";
import { Product } from "@/app/types";
import {
  ShoppingCart, ArrowLeft, Truck, CheckCircle, Shield, Clock, Package,
  Store, ChevronRight, Star as StarIcon, Minus, Plus, Tag, Info,
} from "lucide-react";
import Link from "next/link";
import Breadcrumbs from "@/app/components/Breadcrumbs";
import RelatedSections from "@/app/components/RelatedSections";
import { useCategories } from "@/app/lib/useCategories";
import { resolveDeliveryOptions, enabledTiers, formatEta } from "@/app/lib/delivery";

// ────────────────────────────────────────────────────────────────────
// Source label / colour metadata (unchanged from old page).
// ────────────────────────────────────────────────────────────────────
const KNOWN_SOURCES: Record<string, { label: string; flag: string; color: string }> = {
  amayama:  { label: "Amayama Japan",   flag: "🇯🇵", color: "text-blue-600 bg-blue-50 border-blue-100" },
  partsouq: { label: "Partsouq UAE",    flag: "🇦🇪", color: "text-emerald-600 bg-emerald-50 border-emerald-100" },
  local:    { label: "Монгол дэлгүүр", flag: "🇲🇳", color: "text-orange-600 bg-orange-50 border-orange-100" },
};
const FALLBACK_SOURCE = { flag: "🌐", color: "text-gray-600 bg-gray-50 border-gray-200" };
const srcMeta = (s: string) => {
  const known = KNOWN_SOURCES[s?.toLowerCase?.()];
  if (known) return known;
  return { label: s || "—", ...FALLBACK_SOURCE };
};
const DEL_INFO = {
  fast:   { label: "Яаралтай",  desc: "Онгоцоор", color: "border-gray-200 bg-white",       active: "border-orange-500 bg-orange-50" },
  normal: { label: "Энгийн",    desc: "Тэнгисээр", color: "border-gray-200 bg-white",       active: "border-blue-500 bg-blue-50" },
  cheap:  { label: "Хямд",      desc: "Удаан",    color: "border-gray-200 bg-white",       active: "border-emerald-500 bg-emerald-50" },
};

/**
 * Initial-letter avatar used as a fallback when the seller has no image.
 * Better than a plain blue gradient because the user can still recognise
 * the product card by its first letter while we wait for inventory photos.
 */
function NoImagePlaceholder({ name, brand }: { name: string; brand?: string }) {
  const initial = (name || "?").trim().charAt(0).toUpperCase();
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-blue-50 via-white to-amber-50">
      {/* Dotted background pattern — keeps the area visually interesting
          without competing with the text. */}
      <div
        className="absolute inset-0 opacity-30"
        style={{
          backgroundImage:
            "radial-gradient(circle, rgb(191 219 254) 1px, transparent 1px)",
          backgroundSize: "16px 16px",
        }}
      />
      <div className="relative w-24 h-24 rounded-3xl bg-white shadow-lg border border-blue-100 flex items-center justify-center mb-3">
        <span className="text-5xl font-bold text-blue-300">{initial}</span>
      </div>
      <div className="relative text-center px-6 max-w-[80%]">
        <div className="text-[13px] font-semibold text-gray-700 line-clamp-2">{name}</div>
        {brand && <div className="text-[11px] text-gray-500 mt-0.5">{brand}</div>}
        <div className="mt-3 inline-flex items-center gap-1 text-[10px] text-gray-400 bg-white/80 backdrop-blur border border-gray-200 px-2 py-0.5 rounded-full">
          <Package size={10} /> Зураг хараахан байхгүй
        </div>
      </div>
    </div>
  );
}

export default function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [p, setP] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<"not_found" | "network" | null>(null);
  const [delivery, setDelivery] = useState<"fast" | "normal" | "cheap">("normal");
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  const [activeImg, setActiveImg] = useState(0);
  const addItem = useCartStore(s => s.addItem);
  const router = useRouter();
  // Phase AT: live category list (same source as homepage + shop filter) so
  // we can resolve the Mongolian display name instead of the raw English key.
  const { categories } = useCategories();

  const fetchProduct = () => {
    setLoading(true);
    setFetchError(null);
    api.get<{ item: Product }>(`/products/${id}`)
      .then(d => setP(d.item))
      .catch((e: unknown) => {
        const status = (e as { status?: number })?.status;
        setFetchError(status === 404 ? "not_found" : "network");
        setP(null);
      })
      .finally(() => setLoading(false));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchProduct(); }, [id]);

  // Phase AU: the seller may have disabled some delivery tiers. Once the
  // product (and its seller's delivery config) loads, snap the selected
  // tier to the first ENABLED one so the price/ETA never reflects a tier
  // the buyer can't actually see in the selector.
  useEffect(() => {
    if (!p) return;
    const tiers = enabledTiers(resolveDeliveryOptions(p.seller, p.deliveryDays));
    if (tiers.length > 0 && !tiers.includes(delivery)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDelivery(tiers[0]);
    }
  }, [p, delivery]);

  if (loading) return (
    <BuyerShell>
      <div className="min-h-[70vh] flex items-center justify-center text-gray-400">Уншиж байна...</div>
    </BuyerShell>
  );

  if (!p) return (
    <BuyerShell>
      <div className="min-h-[70vh] flex items-center justify-center text-gray-400">
        <div className="text-center">
          <div className="text-5xl mb-3">{fetchError === "network" ? "⚠️" : "🔍"}</div>
          <p className="text-[16px] font-medium text-gray-700 mb-1">
            {fetchError === "network" ? "Холболт тасарлаа" : "Бараа олдсонгүй"}
          </p>
          <p className="text-[13px] text-gray-500 mb-4">
            {fetchError === "network"
              ? "Интернэт холболтоо шалгаад дахин оролдоно уу."
              : "Бараа устгагдсан эсвэл нийтлэгдээгүй байна."}
          </p>
          {fetchError === "network" && (
            <button onClick={fetchProduct}
              className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl px-5 py-2.5 text-[14px] font-semibold cursor-pointer border-none transition-colors">
              Дахин оролдох
            </button>
          )}
        </div>
      </div>
    </BuyerShell>
  );

  const handleAdd = () => {
    addItem(p, delivery, qty);
    setAdded(true);
    setTimeout(() => setAdded(false), 2500);
  };
  const src = srcMeta(p.source);

  // Phase AU/AV: durations AND prices come from the SELLER's own config
  // (falls back to the product's legacy deliveryDays, then platform
  // defaults). Only the tiers the seller marked enabled are offered.
  const deliveryOpts = resolveDeliveryOptions(p.seller, p.deliveryDays);
  const deliveryTiers = enabledTiers(deliveryOpts);
  const delGridCls =
    deliveryTiers.length === 1 ? "grid-cols-1"
    : deliveryTiers.length === 2 ? "grid-cols-2"
    : "grid-cols-3";

  const lineSubtotal = p.price * qty;
  const totalPrice = lineSubtotal + deliveryOpts[delivery].price;
  const stockCap = typeof p.stockQty === "number" && p.stockQty > 0 ? p.stockQty : 99;
  const bumpQty = (delta: number) => setQty((q) => Math.max(1, Math.min(stockCap, q + delta)));

  // Phase AT: resolve the Mongolian category name from the live category
  // list (matches by stable English key → display name). Falls back to a
  // de-underscored raw value so an unknown/legacy category still renders.
  const catName =
    categories.find((c) => c.id === p.category)?.name ||
    (p.category ? p.category.replace(/_/g, " ") : "");

  // Phase AT: seller identity, lifted so the specs grid ("Дэлгүүр" cell) and
  // the seller card below share ONE resolution. p.seller may be a string id,
  // a populated object, or null (legacy listings without a seller).
  const sellerId =
    typeof p.seller === "string"
      ? p.seller
      : p.seller && typeof p.seller === "object"
        ? p.seller._id
        : undefined;
  const shopName =
    typeof p.seller === "object" && p.seller
      ? p.seller.sellerProfile?.shopName || p.seller.name || ""
      : "";
  const shopRating =
    typeof p.seller === "object" && p.seller ? p.seller.sellerProfile?.rating : undefined;

  // Phase AT: remaining-stock display. Show the actual count with a low-stock
  // amber warning so buyers feel urgency on thin inventory.
  const stockNum = typeof p.stockQty === "number" ? p.stockQty : null;
  const soldOut = !p.inStock || stockNum === 0;
  const lowStock = !soldOut && stockNum !== null && stockNum <= 5;

  // Phase AS: tidy tags. Drop empties + dedupe + cap to 6 (more become a noise wall).
  const tagsClean = Array.from(new Set((p.tags || []).map((t) => t?.trim()).filter(Boolean))).slice(0, 6);

  return (
    <BuyerShell>
      <div className="max-w-6xl mx-auto px-5 py-5 pb-32 lg:pb-10">
        <Breadcrumbs
          className="mb-3"
          items={[
            { label: "Нүүр", href: "/" },
            { label: "Сэлбэгүүд", href: "/shop" },
            ...(p.category && catName
              ? [{ label: catName, href: `/shop?cat=${p.category}` }]
              : []),
            { label: p.name },
          ]}
        />
        <button onClick={() => router.back()}
          className="flex items-center gap-1.5 text-[13px] text-gray-500 hover:text-blue-600 mb-5 cursor-pointer bg-transparent border-none transition-colors">
          <ArrowLeft size={14} /> Буцах
        </button>

        {/* ── Hero: image gallery (5/12) + info+CTA (7/12) on desktop ── */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8">

          {/* === IMAGE GALLERY === */}
          <div className="lg:col-span-5">
            <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
              <div className="aspect-square bg-gradient-to-br from-blue-50 to-amber-50 flex items-center justify-center relative overflow-hidden">
                {p.images && p.images.length > 0 ? (
                  <Image
                    src={p.images[activeImg] || p.images[0]}
                    alt={p.name}
                    fill
                    sizes="(max-width: 1024px) 100vw, 500px"
                    className="object-contain p-6"
                    priority
                  />
                ) : (
                  <NoImagePlaceholder name={p.name} brand={p.brand} />
                )}
                {p.badge && (
                  <span className="absolute top-4 left-4 bg-blue-600 text-white text-[11px] font-semibold px-2.5 py-1 rounded-full shadow-md">
                    {p.badge}
                  </span>
                )}
                {p.originalPrice && p.originalPrice > p.price && (
                  <span className="absolute top-4 right-4 bg-rose-500 text-white text-[11px] font-semibold px-2.5 py-1 rounded-full shadow-md">
                    -{Math.round((1 - p.price / p.originalPrice) * 100)}%
                  </span>
                )}
              </div>
              {p.images && p.images.length > 1 && (
                <div className="px-4 py-3 flex gap-2 overflow-x-auto border-t border-gray-100">
                  {p.images.map((url, i) => (
                    <button key={url} onClick={() => setActiveImg(i)} type="button"
                      className={`relative w-16 h-16 rounded-lg overflow-hidden shrink-0 cursor-pointer border-2 transition-all bg-white ${i === activeImg ? "border-blue-500" : "border-gray-200 hover:border-blue-300"}`}>
                      <Image src={url} alt={`thumb-${i}`} fill sizes="64px" className="object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* === INFO + CTA === */}
          <div className="lg:col-span-7">
            <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-5 lg:p-6">

              {/* Header strip: source badge + stock badge + OEM */}
              <div className="flex flex-wrap gap-2 mb-3">
                <span className={`text-[11px] font-medium px-2.5 py-1 rounded-full border ${src.color}`}>
                  {src.flag} {src.label}
                </span>
                <span className={`text-[11px] font-medium px-2.5 py-1 rounded-full border ${soldOut ? "bg-red-50 text-red-500 border-red-100" : lowStock ? "bg-amber-50 text-amber-600 border-amber-100" : "bg-emerald-50 text-emerald-600 border-emerald-100"}`}>
                  {soldOut
                    ? "✗ Дууссан"
                    : stockNum !== null
                      ? (lowStock ? `⚠ Сүүлийн ${stockNum} ширхэг` : `✓ Нөөцөд ${stockNum} ширхэг`)
                      : "✓ Нөөцөд байна"}
                </span>
                {p.oem && (
                  <span className="text-[11px] bg-blue-50 text-blue-700 border border-blue-100 px-2.5 py-1 rounded-full font-mono font-medium">
                    {p.oem}
                  </span>
                )}
              </div>

              {/* Title + brand */}
              <h1 className="text-[22px] lg:text-[26px] font-semibold text-gray-900 leading-tight mb-1">{p.name}</h1>
              {p.brand && <p className="text-[14px] text-gray-500 mb-3">{p.brand}</p>}

              {/* Rating chip if any reviews */}
              {p.ratingCount && p.ratingCount > 0 && (
                <div className="flex items-center gap-1.5 mb-3">
                  <div className="flex items-center gap-0.5">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <StarIcon key={i} size={13} className={i < Math.round(p.rating || 0) ? "fill-amber-400 text-amber-400" : "fill-gray-200 text-gray-200"} />
                    ))}
                  </div>
                  <span className="text-[12px] text-gray-600 font-medium">{(p.rating ?? 0).toFixed(1)}</span>
                  <span className="text-[12px] text-gray-500">({p.ratingCount})</span>
                </div>
              )}

              {/* Tags */}
              {tagsClean.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-4">
                  {tagsClean.map((t) => (
                    <span key={t} className="inline-flex items-center gap-1 text-[11px] bg-gray-50 text-gray-600 border border-gray-200 px-2 py-0.5 rounded-md">
                      <Tag size={9} className="text-gray-400" /> {t}
                    </span>
                  ))}
                </div>
              )}

              {/* Price block — visually dominant */}
              <div className="flex items-baseline gap-3 mb-5 pb-5 border-b border-gray-100">
                <span className="text-[30px] font-bold text-blue-600">₮{p.price.toLocaleString()}</span>
                {p.originalPrice && p.originalPrice > p.price && (
                  <span className="text-[15px] text-gray-400 line-through">₮{p.originalPrice.toLocaleString()}</span>
                )}
                <span className="text-[12px] text-gray-500 ml-auto">/ ширхэг</span>
              </div>

              {/* Description (collapsible if very long) */}
              {p.description && (
                <p className="text-[14px] text-gray-700 leading-relaxed mb-5 whitespace-pre-line">
                  {p.description}
                </p>
              )}

              {/* Specs grid — keeps key/value pairs scannable */}
              <div className="grid grid-cols-2 gap-3 mb-5">
                {p.brand && (
                  <div className="bg-gray-50 rounded-lg p-3">
                    <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">Брэнд</div>
                    <div className="text-[13px] font-medium text-gray-800">{p.brand}</div>
                  </div>
                )}
                {p.oem && (
                  <div className="bg-gray-50 rounded-lg p-3">
                    <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">OEM код</div>
                    <div className="text-[13px] font-mono text-gray-800">{p.oem}</div>
                  </div>
                )}
                {catName && (
                  <div className="bg-gray-50 rounded-lg p-3">
                    <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">Ангилал</div>
                    <div className="text-[13px] text-gray-800">{catName}</div>
                  </div>
                )}
                {/* Phase AT: show the SELLER's shop name here — far more useful
                    than the raw provenance country. The provenance chip still
                    lives in the header strip above, so nothing is lost. Falls
                    back to "Эх сурвалж" only for legacy listings with no seller. */}
                {shopName ? (
                  <div className="bg-gray-50 rounded-lg p-3">
                    <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">Дэлгүүр</div>
                    <div className="text-[13px] font-medium text-gray-800 truncate">{shopName}</div>
                  </div>
                ) : (
                  <div className="bg-gray-50 rounded-lg p-3">
                    <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">Эх сурвалж</div>
                    <div className="text-[13px] text-gray-800">{src.flag} {src.label}</div>
                  </div>
                )}
                {/* Phase AT: explicit remaining-stock cell so the count is
                    scannable in the spec block, not just the header badge. */}
                {stockNum !== null && (
                  <div className="bg-gray-50 rounded-lg p-3">
                    <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">Үлдэгдэл</div>
                    <div className={`text-[13px] font-semibold ${soldOut ? "text-red-600" : lowStock ? "text-amber-600" : "text-gray-800"}`}>
                      {soldOut ? "Дууссан" : `${stockNum} ширхэг`}
                    </div>
                  </div>
                )}
              </div>

              {/* Compatible vehicles — horizontal scroll-x for long lists */}
              {(p.compatible?.length ?? 0) > 0 && (
                <div className="mb-5">
                  <div className="text-[13px] font-semibold text-gray-700 mb-2 flex items-center gap-1.5">
                    <Shield size={13} className="text-blue-500" /> Тохирох загварууд
                    <span className="text-[11px] text-gray-500 font-normal">({p.compatible.length})</span>
                  </div>
                  <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
                    {(p.compatible ?? []).map((c) => (
                      <span key={c} className="inline-flex items-center gap-1 text-[12px] bg-emerald-50 text-emerald-700 border border-emerald-100 px-2.5 py-1 rounded-full whitespace-nowrap shrink-0">
                        <CheckCircle size={11} /> {c}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Delivery selector */}
              <div className="mb-5">
                <div className="text-[13px] font-semibold text-gray-700 mb-3 flex items-center gap-1.5">
                  <Truck size={13} className="text-blue-500" /> Хүргэлтийн хугацаа
                </div>
                <div className={`grid ${delGridCls} gap-2`}>
                  {deliveryTiers.map(d => {
                    const di = DEL_INFO[d];
                    const isActive = delivery === d;
                    const opt = deliveryOpts[d];
                    return (
                      <button key={d} onClick={() => setDelivery(d)}
                        className={`border-2 rounded-xl p-3 text-left cursor-pointer transition-all font-sans ${isActive ? di.active + " shadow-sm" : di.color + " hover:border-blue-300"}`}>
                        <div className={`text-[12px] font-semibold mb-0.5 ${isActive ? "text-gray-900" : "text-gray-700"}`}>{di.label}</div>
                        <div className="text-[11px] text-gray-500 flex items-center gap-1"><Clock size={10} />{formatEta(opt.value, opt.unit)}</div>
                        <div className={`text-[12px] font-bold mt-1.5 ${isActive ? "text-gray-900" : "text-gray-600"}`}>
                          {opt.price === 0 ? "Үнэгүй" : `+₮${opt.price.toLocaleString()}`}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Quantity + add-to-cart row (DESKTOP — mobile gets sticky bar below) */}
              <div className="hidden lg:flex items-end justify-between pt-5 border-t border-gray-100 gap-4">
                <div>
                  <div className="text-[11px] text-gray-500 mb-1">Тоо ширхэг</div>
                  <div className="inline-flex items-center border-2 border-gray-200 rounded-xl overflow-hidden">
                    <button onClick={() => bumpQty(-1)} disabled={qty <= 1}
                      className="w-10 h-11 flex items-center justify-center text-gray-500 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer bg-transparent border-none">
                      <Minus size={14} />
                    </button>
                    <input
                      type="number"
                      min={1}
                      max={stockCap}
                      value={qty}
                      onChange={(e) => setQty(Math.max(1, Math.min(stockCap, Number(e.target.value) || 1)))}
                      className="w-12 h-11 text-center text-[14px] font-semibold text-gray-900 border-none focus:outline-none bg-transparent"
                    />
                    <button onClick={() => bumpQty(1)} disabled={qty >= stockCap}
                      className="w-10 h-11 flex items-center justify-center text-gray-500 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer bg-transparent border-none">
                      <Plus size={14} />
                    </button>
                  </div>
                </div>
                <div className="flex-1 text-right mr-2">
                  <div className="text-[11px] text-gray-500 mb-0.5">Нийт үнэ (хүргэлттэй)</div>
                  <div className="text-[26px] font-bold text-blue-600 leading-tight">₮{totalPrice.toLocaleString()}</div>
                  {qty > 1 && (
                    <div className="text-[11px] text-gray-500">{qty} × ₮{p.price.toLocaleString()} + хүргэлт</div>
                  )}
                </div>
                <button onClick={handleAdd} disabled={!p.inStock}
                  className={`flex items-center gap-2 rounded-xl px-5 py-3.5 text-[14px] font-semibold cursor-pointer border-none transition-all whitespace-nowrap ${
                    added ? "bg-emerald-500 text-white" :
                    p.inStock ? "bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-200" :
                    "bg-gray-100 text-gray-400 cursor-not-allowed"
                  }`}>
                  {added ? <><CheckCircle size={17} />Нэмэгдлээ!</> : <><ShoppingCart size={17} />Сагсанд нэмэх</>}
                </button>
              </div>

              {/* Seller card — Phase AT: uses the lifted seller identity so
                  it stays in sync with the "Дэлгүүр" spec cell above. */}
              {sellerId && (
                <Link href={`/store/${sellerId}`}
                  className="mt-5 flex items-center gap-3 bg-gradient-to-r from-blue-50 to-amber-50 border border-blue-100 hover:border-blue-300 rounded-2xl p-4 transition-all hover:shadow-md group">
                  <div className="w-11 h-11 rounded-xl bg-white shadow-sm border border-blue-100 flex items-center justify-center shrink-0">
                    <Store size={18} className="text-blue-700" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] text-blue-700 font-semibold uppercase tracking-wider">Зарагч</div>
                    <div className="text-[14px] font-semibold text-gray-900 truncate">{shopName || "Дэлгүүр"}</div>
                    {shopRating !== undefined && shopRating > 0 && (
                      <div className="flex items-center gap-1 text-[11px] text-gray-500 mt-0.5">
                        <StarIcon size={10} className="fill-amber-400 text-amber-400" />
                        {shopRating.toFixed(1)} · Бүх барааг харах
                      </div>
                    )}
                  </div>
                  <ChevronRight size={16} className="text-blue-700 group-hover:translate-x-0.5 transition-transform shrink-0" />
                </Link>
              )}

              {/* Trust strip */}
              <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
                <div className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 border border-emerald-100 px-2 py-0.5 rounded-full">
                  <Shield size={11} /> Escrow хамгаалалт
                </div>
                <div className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 border border-blue-100 px-2 py-0.5 rounded-full">
                  <Info size={11} /> Хүлээн авсны дараа төлбөр зарагчид
                </div>
              </div>
            </div>

            {/* Reviews — separate card so it doesn't crowd the buy box */}
            <div className="mt-6 bg-white border border-gray-200 rounded-2xl shadow-sm p-5 lg:p-6">
              <ReviewSection
                productId={(p._id ?? p.id) as string}
                rating={p.rating}
                ratingCount={p.ratingCount}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Related sections — full-width grid below the hero */}
      <div className="max-w-6xl mx-auto px-5 pb-32 lg:pb-10">
        <RelatedSections
          currentId={(p._id ?? p.id) as string}
          sellerId={sellerId}
          sellerName={shopName || undefined}
          category={p.category}
        />
      </div>

      {/* ─── Phase AS: STICKY MOBILE BOTTOM BAR ───
          On mobile (<lg) the desktop CTA row above is hidden — this bar
          floats at the bottom of the viewport so "Add to cart" stays
          one tap away no matter how far the user has scrolled. Hidden
          on desktop where the inline CTA is always visible above the
          fold of the info column. */}
      <div className="lg:hidden fixed bottom-16 left-0 right-0 z-40 bg-white border-t border-gray-200 shadow-[0_-4px_12px_rgba(0,0,0,0.05)]">
        <div className="px-4 py-3 flex items-center gap-3 max-w-2xl mx-auto">
          <div className="inline-flex items-center border-2 border-gray-200 rounded-lg overflow-hidden shrink-0">
            <button onClick={() => bumpQty(-1)} disabled={qty <= 1}
              className="w-9 h-10 flex items-center justify-center text-gray-600 disabled:opacity-30 cursor-pointer bg-transparent border-none">
              <Minus size={13} />
            </button>
            <span className="w-7 text-center text-[13px] font-semibold text-gray-900">{qty}</span>
            <button onClick={() => bumpQty(1)} disabled={qty >= stockCap}
              className="w-9 h-10 flex items-center justify-center text-gray-600 disabled:opacity-30 cursor-pointer bg-transparent border-none">
              <Plus size={13} />
            </button>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[11px] text-gray-500">Нийт</div>
            <div className="text-[16px] font-bold text-blue-600 leading-tight">₮{totalPrice.toLocaleString()}</div>
          </div>
          <button onClick={handleAdd} disabled={!p.inStock}
            className={`flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-[13px] font-semibold cursor-pointer border-none transition-all whitespace-nowrap ${
              added ? "bg-emerald-500 text-white" :
              p.inStock ? "bg-blue-600 hover:bg-blue-700 text-white" :
              "bg-gray-100 text-gray-400 cursor-not-allowed"
            }`}>
            {added ? <><CheckCircle size={15} />Нэмлээ</> : <><ShoppingCart size={15} />Сагсанд</>}
          </button>
        </div>
      </div>
    </BuyerShell>
  );
}
