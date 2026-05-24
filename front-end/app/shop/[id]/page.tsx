"use client";
import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Navbar from "@/app/components/Navbar";
import ReviewSection from "@/app/components/ReviewSection";
import { DELIVERY_PRICE } from "@/lib/data";
import { useCartStore } from "@/store";
import { api } from "@/lib/api";
import { Product } from "@/app/types";
import { ShoppingCart, ArrowLeft, Truck, CheckCircle, Shield, Clock, Package } from "lucide-react";

const KNOWN_SOURCES: Record<string, { label: string; flag: string; color: string }> = {
  amayama:  { label: "Amayama Japan",    flag: "🇯🇵", color: "text-blue-600 bg-blue-50 border-blue-100" },
  partsouq: { label: "Partsouq UAE",     flag: "🇦🇪", color: "text-emerald-600 bg-emerald-50 border-emerald-100" },
  local:    { label: "Монгол дэлгүүр",  flag: "🇲🇳", color: "text-orange-600 bg-orange-50 border-orange-100" },
};
const FALLBACK_SOURCE = { flag: "🌐", color: "text-gray-600 bg-gray-50 border-gray-200" };
const srcMeta = (s: string) => {
  const known = KNOWN_SOURCES[s?.toLowerCase?.()];
  if (known) return known;
  return { label: s || "—", ...FALLBACK_SOURCE };
};
const DEL_INFO = {
  fast:   { label: "Яаралтай",  desc: "Онгоцоор", color: "border-orange-200 bg-orange-50", active: "border-orange-400 bg-orange-50" },
  normal: { label: "Энгийн",    desc: "Тэнгисээр", color: "border-gray-200 bg-white", active: "border-blue-500 bg-blue-50" },
  cheap:  { label: "Хямд",      desc: "Удаан", color: "border-gray-200 bg-white", active: "border-gray-400 bg-gray-50" },
};

export default function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [p, setP] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [delivery, setDelivery] = useState<"fast" | "normal" | "cheap">("normal");
  const [added, setAdded] = useState(false);
  const [activeImg, setActiveImg] = useState(0);
  const addItem = useCartStore(s => s.addItem);
  const router = useRouter();

  useEffect(() => {
    api.get<{ item: Product }>(`/products/${id}`)
      .then(d => setP(d.item))
      .catch(() => setP(null))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return (
    <>
      <Navbar />
      <div className="min-h-[70vh] flex items-center justify-center text-gray-400">Уншиж байна...</div>
    </>
  );

  if (!p) return (
    <>
      <Navbar />
      <div className="min-h-[70vh] flex items-center justify-center text-gray-400">
        <div className="text-center"><div className="text-5xl mb-3">🔍</div><p>Бараа олдсонгүй</p></div>
      </div>
    </>
  );

  const handleAdd = () => {
    addItem(p, delivery);
    setAdded(true);
    setTimeout(() => setAdded(false), 2500);
  };
  const src = srcMeta(p.source);
  const totalPrice = p.price + DELIVERY_PRICE[delivery];

  return (
    <>
      <Navbar />
      <div className="max-w-2xl mx-auto px-5 py-5">
        <button onClick={() => router.back()}
          className="flex items-center gap-1.5 text-[13px] text-gray-500 hover:text-blue-600 mb-5 cursor-pointer bg-transparent border-none transition-colors">
          <ArrowLeft size={14} /> Буцах
        </button>

        <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
          <div className="h-72 bg-gradient-to-br from-blue-50 to-amber-50 flex items-center justify-center relative overflow-hidden">
            {p.images && p.images.length > 0 ? (
              <Image src={p.images[activeImg] || p.images[0]} alt={p.name} fill sizes="(max-width: 640px) 100vw, 600px" className="object-contain p-4" priority />
            ) : p.iconPath ? (
              <svg className="w-24 h-24 fill-blue-300" viewBox="0 0 24 24"><path d={p.iconPath} /></svg>
            ) : (
              <Package className="w-20 h-20 text-blue-200" />
            )}
            {p.badge && (
              <span className="absolute top-4 left-4 bg-blue-600 text-white text-[11px] font-semibold px-2.5 py-1 rounded-full">{p.badge}</span>
            )}
          </div>
          {p.images && p.images.length > 1 && (
            <div className="px-5 pt-3 flex gap-2 overflow-x-auto">
              {p.images.map((url, i) => (
                <button key={url} onClick={() => setActiveImg(i)} type="button"
                  className={`relative w-14 h-14 rounded-lg overflow-hidden shrink-0 cursor-pointer border-2 transition-all bg-white ${i === activeImg ? "border-blue-500" : "border-gray-200 hover:border-blue-300"}`}>
                  <Image src={url} alt={`thumb-${i}`} fill sizes="56px" className="object-cover" />
                </button>
              ))}
            </div>
          )}

          <div className="p-5">
            <div className="flex flex-wrap gap-2 mb-3">
              <span className={`text-[11px] font-medium px-2.5 py-1 rounded-full border ${src.color}`}>
                {src.flag} {src.label}
              </span>
              {p.oem && (
                <span className="text-[11px] bg-blue-50 text-blue-700 border border-blue-100 px-2.5 py-1 rounded-full font-mono font-medium">
                  {p.oem}
                </span>
              )}
              {p.tags && p.tags.slice(0, 3).map((t) => (
                <span key={t} className="text-[11px] bg-gray-50 text-gray-600 border border-gray-200 px-2 py-1 rounded-full">
                  #{t}
                </span>
              ))}
              <span className={`text-[11px] font-medium px-2.5 py-1 rounded-full border ${p.inStock ? "bg-emerald-50 text-emerald-600 border-emerald-100" : "bg-red-50 text-red-500 border-red-100"}`}>
                {p.inStock ? "✓ Нөөцөд байна" : "✗ Дууссан"}
              </span>
            </div>

            <h1 className="text-[20px] font-semibold text-gray-900 mb-1">{p.name}</h1>
            <p className="text-[13px] text-gray-500 mb-1">{p.brand}</p>
            <p className="text-[14px] text-gray-600 mt-3 mb-5 leading-relaxed">{p.description}</p>

            {p.compatible.length > 0 && (
              <div className="bg-gray-50 rounded-xl p-4 mb-5">
                <div className="text-[13px] font-semibold text-gray-700 mb-2.5 flex items-center gap-1.5">
                  <Shield size={13} className="text-blue-500" /> Тохирох загварууд
                </div>
                {p.compatible.map(c => (
                  <div key={c} className="flex items-center gap-2 text-[13px] text-gray-600 py-1">
                    <CheckCircle size={12} className="text-emerald-500 shrink-0" />{c}
                  </div>
                ))}
              </div>
            )}

            <div className="mb-5">
              <div className="text-[13px] font-semibold text-gray-700 mb-3 flex items-center gap-1.5">
                <Truck size={13} className="text-blue-500" /> Хүргэлтийн хугацаа сонгох
              </div>
              <div className="grid grid-cols-3 gap-2">
                {(["fast", "normal", "cheap"] as const).map(d => {
                  const di = DEL_INFO[d];
                  const isActive = delivery === d;
                  return (
                    <button key={d} onClick={() => setDelivery(d)}
                      className={`border-2 rounded-xl p-3 text-left cursor-pointer transition-all font-sans ${isActive ? di.active + " shadow-md" : di.color + " hover:border-blue-300"}`}>
                      <div className={`text-[12px] font-semibold mb-0.5 ${isActive ? "text-blue-700" : "text-gray-800"}`}>{di.label}</div>
                      <div className="text-[11px] text-gray-400 flex items-center gap-1"><Clock size={9} />{p.deliveryDays[d]} хоног</div>
                      <div className={`text-[12px] font-bold mt-1.5 ${isActive ? "text-blue-600" : "text-gray-600"}`}>
                        {DELIVERY_PRICE[d] === 0 ? "Үнэгүй" : `+₮${DELIVERY_PRICE[d].toLocaleString()}`}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex items-end justify-between pt-4 border-t border-gray-100">
              <div>
                <div className="text-[11px] text-gray-400 mb-0.5">Нийт үнэ (хүргэлттэй)</div>
                <div className="text-[26px] font-bold text-blue-600">₮{totalPrice.toLocaleString()}</div>
                {p.originalPrice && (
                  <div className="text-[13px] text-gray-400 line-through">₮{(p.originalPrice + DELIVERY_PRICE[delivery]).toLocaleString()}</div>
                )}
              </div>
              <button onClick={handleAdd} disabled={!p.inStock}
                className={`flex items-center gap-2 rounded-xl px-5 py-3.5 text-[14px] font-semibold cursor-pointer border-none transition-all ${
                  added ? "bg-emerald-500 text-white" :
                  p.inStock ? "bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-200" :
                  "bg-gray-100 text-gray-400 cursor-not-allowed"
                }`}>
                {added ? <><CheckCircle size={17} />Нэмэгдлээ!</> : <><ShoppingCart size={17} />Сагсанд нэмэх</>}
              </button>
            </div>

            <ReviewSection
              productId={(p._id ?? p.id) as string}
              rating={p.rating}
              ratingCount={p.ratingCount}
            />
          </div>
        </div>
      </div>
    </>
  );
}
