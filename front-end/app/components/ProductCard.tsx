"use client";
import Link from "next/link";
import { Product } from "@/app/types";
import { useCartStore } from "@/store";
import { ShoppingCart, CheckCircle, Package } from "lucide-react";
import { useState } from "react";

const SRC_BADGE: Record<string,{label:string,color:string}> = {
  amayama:  { label:"Amayama JP",       color:"text-blue-600 bg-blue-50 border-blue-100" },
  partsouq: { label:"Partsouq UAE",     color:"text-emerald-600 bg-emerald-50 border-emerald-100" },
  local:    { label:"Монгол дэлгүүр",  color:"text-orange-600 bg-orange-50 border-orange-100" },
};

export default function ProductCard({ p }: { p: Product }) {
  const addItem = useCartStore(s => s.addItem);
  const [added, setAdded] = useState(false);
  const handleAdd = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!p.inStock) return;
    addItem(p);
    setAdded(true);
    setTimeout(() => setAdded(false), 2000);
  };
  const src = SRC_BADGE[p.source];

  return (
    <Link href={`/shop/${p.id}`} style={{textDecoration:"none"}}
      className="group block bg-white border border-gray-200 rounded-xl overflow-hidden hover:border-violet-400 hover:shadow-lg hover:shadow-violet-100/50 transition-all duration-200">
      {/* Image area */}
      <div className="relative h-[96px] bg-gradient-to-br from-violet-50 to-purple-50 flex items-center justify-center group-hover:from-violet-100 group-hover:to-purple-100 transition-colors">
        {p.badge && (
          <span className="absolute top-2 left-2 bg-violet-600 text-white text-[10px] font-semibold px-2 py-0.5 rounded-md">{p.badge}</span>
        )}
        {!p.inStock && (
          <div className="absolute inset-0 bg-white/70 flex items-center justify-center">
            <span className="text-[11px] font-medium text-gray-400 border border-gray-300 bg-white px-2.5 py-1 rounded-full">Дууссан</span>
          </div>
        )}
        <svg className="w-10 h-10 fill-violet-400 group-hover:fill-violet-500 transition-colors" viewBox="0 0 24 24"><path d={p.iconPath}/></svg>
      </div>
      {/* Body */}
      <div className="p-3">
        <div className="text-[12px] font-semibold text-gray-900 mb-1 leading-snug line-clamp-2">{p.name}</div>
        <div className="text-[10px] text-gray-400 font-mono mb-2">{p.oem}</div>
        <span className={`inline-flex text-[10px] font-medium px-1.5 py-0.5 rounded border mb-2 ${src.color}`}>{src.label}</span>
        <div className="flex items-end justify-between mt-1">
          <div>
            <div className="text-[15px] font-bold text-violet-600">₮{p.price.toLocaleString()}</div>
            {p.originalPrice && <div className="text-[11px] text-gray-400 line-through">₮{p.originalPrice.toLocaleString()}</div>}
          </div>
          <button onClick={handleAdd}
            className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold cursor-pointer border-none transition-all ${
              added ? "bg-emerald-500 text-white" :
              p.inStock ? "bg-violet-600 hover:bg-violet-700 text-white" :
              "bg-gray-100 text-gray-400 cursor-not-allowed"
            }`}>
            {added ? <><CheckCircle size={11}/>Нэмсэн</> : p.inStock ? <><ShoppingCart size={11}/>Сагс</> : <><Package size={11}/>Дууссан</>}
          </button>
        </div>
      </div>
    </Link>
  );
}
