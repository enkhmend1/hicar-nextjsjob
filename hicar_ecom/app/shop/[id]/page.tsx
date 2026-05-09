"use client";
import { use, useState } from "react";
import { useRouter } from "next/navigation";
import Navbar from "@/app/components/Navbar";
import { PRODUCTS, DELIVERY_PRICE } from "@/lib/data";
import { useCartStore } from "@/store";
import { ShoppingCart, ArrowLeft, Truck, CheckCircle, Shield, Clock } from "lucide-react";

const SRC_INFO: Record<string, { label: string; flag: string; color: string }> = {
  amayama:  { label: "Amayama Japan",    flag: "🇯🇵", color: "text-blue-600 bg-blue-50 border-blue-100" },
  partsouq: { label: "Partsouq UAE",     flag: "🇦🇪", color: "text-emerald-600 bg-emerald-50 border-emerald-100" },
  local:    { label: "Монгол дэлгүүр",  flag: "🇲🇳", color: "text-orange-600 bg-orange-50 border-orange-100" },
};
const DEL_INFO = {
  fast:   { label: "Яаралтай",  desc: "Онгоцоор", color: "border-orange-200 bg-orange-50", active: "border-orange-400 bg-orange-50" },
  normal: { label: "Энгийн",    desc: "Тэнгисээр", color: "border-gray-200 bg-white", active: "border-violet-500 bg-violet-50" },
  cheap:  { label: "Хямд",      desc: "Удаан", color: "border-gray-200 bg-white", active: "border-gray-400 bg-gray-50" },
};

export default function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const p = PRODUCTS.find(x => x.id === id);
  const [delivery, setDelivery] = useState<"fast" | "normal" | "cheap">("normal");
  const [added, setAdded] = useState(false);
  const addItem = useCartStore(s => s.addItem);
  const router = useRouter();

  if (!p) return (
    <div className="min-h-screen flex items-center justify-center text-gray-400">
      <div className="text-center"><div className="text-5xl mb-3">🔍</div><p>Бараа олдсонгүй</p></div>
    </div>
  );

  const handleAdd = () => {
    addItem(p, delivery);
    setAdded(true);
    setTimeout(() => setAdded(false), 2500);
  };
  const src = SRC_INFO[p.source];
  const totalPrice = p.price + DELIVERY_PRICE[delivery];

  return (
    <>
      <Navbar />
      <div className="max-w-2xl mx-auto px-5 py-5">
        <button onClick={() => router.back()}
          className="flex items-center gap-1.5 text-[13px] text-gray-500 hover:text-violet-600 mb-5 cursor-pointer bg-transparent border-none transition-colors">
          <ArrowLeft size={14} /> Буцах
        </button>

        <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
          {/* Product image */}
          <div className="h-56 bg-gradient-to-br from-violet-50 to-purple-100 flex items-center justify-center relative">
            <svg className="w-24 h-24 fill-violet-300" viewBox="0 0 24 24"><path d={p.iconPath} /></svg>
            {p.badge && (
              <span className="absolute top-4 left-4 bg-violet-600 text-white text-[11px] font-semibold px-2.5 py-1 rounded-full">{p.badge}</span>
            )}
          </div>

          <div className="p-5">
            {/* Badges */}
            <div className="flex flex-wrap gap-2 mb-3">
              <span className={`text-[11px] font-medium px-2.5 py-1 rounded-full border ${src.color}`}>
                {src.flag} {src.label}
              </span>
              <span className="text-[11px] bg-violet-50 text-violet-700 border border-violet-100 px-2.5 py-1 rounded-full font-mono font-medium">
                {p.oem}
              </span>
              <span className={`text-[11px] font-medium px-2.5 py-1 rounded-full border ${p.inStock ? "bg-emerald-50 text-emerald-600 border-emerald-100" : "bg-red-50 text-red-500 border-red-100"}`}>
                {p.inStock ? "✓ Нөөцөд байна" : "✗ Дууссан"}
              </span>
            </div>

            <h1 className="text-[20px] font-semibold text-gray-900 mb-1">{p.name}</h1>
            <p className="text-[13px] text-gray-500 mb-1">{p.brand}</p>
            <p className="text-[14px] text-gray-600 mt-3 mb-5 leading-relaxed">{p.description}</p>

            {/* Compatible */}
            <div className="bg-gray-50 rounded-xl p-4 mb-5">
              <div className="text-[13px] font-semibold text-gray-700 mb-2.5 flex items-center gap-1.5">
                <Shield size={13} className="text-violet-500" /> Тохирох загварууд
              </div>
              {p.compatible.map(c => (
                <div key={c} className="flex items-center gap-2 text-[13px] text-gray-600 py-1">
                  <CheckCircle size={12} className="text-emerald-500 shrink-0" />{c}
                </div>
              ))}
            </div>

            {/* Delivery options */}
            <div className="mb-5">
              <div className="text-[13px] font-semibold text-gray-700 mb-3 flex items-center gap-1.5">
                <Truck size={13} className="text-violet-500" /> Хүргэлтийн хугацаа сонгох
              </div>
              <div className="grid grid-cols-3 gap-2">
                {(["fast", "normal", "cheap"] as const).map(d => {
                  const di = DEL_INFO[d];
                  const isActive = delivery === d;
                  return (
                    <button key={d} onClick={() => setDelivery(d)}
                      className={`border-2 rounded-xl p-3 text-left cursor-pointer transition-all font-sans ${isActive ? di.active + " shadow-md" : di.color + " hover:border-violet-300"}`}>
                      <div className={`text-[12px] font-semibold mb-0.5 ${isActive ? "text-violet-700" : "text-gray-800"}`}>{di.label}</div>
                      <div className="text-[11px] text-gray-400 flex items-center gap-1"><Clock size={9} />{p.deliveryDays[d]} хоног</div>
                      <div className={`text-[12px] font-bold mt-1.5 ${isActive ? "text-violet-600" : "text-gray-600"}`}>
                        {DELIVERY_PRICE[d] === 0 ? "Үнэгүй" : `+₮${DELIVERY_PRICE[d].toLocaleString()}`}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Price + CTA */}
            <div className="flex items-end justify-between pt-4 border-t border-gray-100">
              <div>
                <div className="text-[11px] text-gray-400 mb-0.5">Нийт үнэ (хүргэлттэй)</div>
                <div className="text-[26px] font-bold text-violet-600">₮{totalPrice.toLocaleString()}</div>
                {p.originalPrice && (
                  <div className="text-[13px] text-gray-400 line-through">₮{(p.originalPrice + DELIVERY_PRICE[delivery]).toLocaleString()}</div>
                )}
              </div>
              <button onClick={handleAdd} disabled={!p.inStock}
                className={`flex items-center gap-2 rounded-xl px-5 py-3.5 text-[14px] font-semibold cursor-pointer border-none transition-all ${
                  added ? "bg-emerald-500 text-white" :
                  p.inStock ? "bg-violet-600 hover:bg-violet-700 text-white shadow-lg shadow-violet-200" :
                  "bg-gray-100 text-gray-400 cursor-not-allowed"
                }`}>
                {added ? <><CheckCircle size={17} />Нэмэгдлээ!</> : <><ShoppingCart size={17} />Сагсанд нэмэх</>}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
