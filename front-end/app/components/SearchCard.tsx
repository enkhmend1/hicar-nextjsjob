"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useCarStore } from "@/store";
import { CAR_DB } from "@/lib/data";
import { Search, Upload, ChevronRight } from "lucide-react";

type Tab = 0|1|2;
export default function SearchCard() {
  const [tab, setTab] = useState<Tab>(0);
  const [plate, setPlate] = useState("");
  const [partQ, setPartQ] = useState("");
  const [make, setMake] = useState(""); const [model, setModel] = useState(""); const [year, setYear] = useState("");
  const [found, setFound] = useState<typeof CAR_DB[string]|null>(null);
  const [notFound, setNotFound] = useState(false);
  const { setCar } = useCarStore();
  const router = useRouter();

  const searchByPlate = () => {
    const k = plate.trim().toUpperCase();
    if (!k) return;
    const car = CAR_DB[k];
    if (car) { setFound(car); setCar(car); setNotFound(false); }
    else { setFound(null); setNotFound(true); setCar({ id:"cx", plate:k, make:"Toyota", model:"Prius", year:2018, engine:"1.8L", chassis:"ZVW50" }); }
  };
  const goSearch = (q: string) => { if (q.trim()) router.push(`/shop?q=${encodeURIComponent(q.trim())}`); };

  const tabs = ["Улсын дугаараар","Загвараар","Зургаар"];

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-md shadow-violet-100/40">
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 mb-4">
        {tabs.map((t,i) => (
          <button key={t} onClick={()=>{setTab(i as Tab);setFound(null);setNotFound(false);}}
            className={`flex-1 py-2 text-[13px] rounded-[9px] border-none cursor-pointer font-sans transition-all ${tab===i?"bg-white text-violet-600 font-semibold shadow":"text-gray-400 bg-transparent hover:text-gray-600"}`}>{t}</button>
        ))}
      </div>

      {tab===0 && (
        <div>
          <div className="flex gap-2">
            <input value={plate} onChange={e=>setPlate(e.target.value)} onKeyDown={e=>e.key==="Enter"&&searchByPlate()}
              className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-[14px] tracking-wider focus:border-violet-500 focus:bg-white transition-colors"
              placeholder="УБ 1234 АА"/>
            <button onClick={searchByPlate}
              className="bg-violet-600 hover:bg-violet-700 text-white rounded-xl px-5 py-2.5 text-[13px] font-semibold cursor-pointer border-none flex items-center gap-1.5 transition-colors shrink-0">
              <Search size={14}/>Хайх
            </button>
          </div>
          <p className="text-[11px] text-gray-400 mt-2">Туршаад үзэх: УБ 1234 АА · УБ 5678 БА · ДА 4321 ВА</p>
          {found && (
            <div className="mt-3 bg-violet-50 border border-violet-200 rounded-xl p-3 flex items-center gap-3">
              <div className="w-8 h-8 bg-violet-100 rounded-lg flex items-center justify-center shrink-0">
                <svg className="w-4 h-4 fill-violet-600" viewBox="0 0 24 24"><path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99z"/></svg>
              </div>
              <div className="flex-1">
                <div className="text-[13px] font-semibold text-gray-900">{found.make} {found.model} {found.year}</div>
                <div className="text-[11px] text-gray-500">{found.engine} · {found.chassis} · {found.plate}</div>
              </div>
              <button onClick={()=>router.push("/shop")}
                className="flex items-center gap-1 bg-violet-600 hover:bg-violet-700 text-white text-[12px] font-medium rounded-lg px-3 py-1.5 cursor-pointer border-none transition-colors shrink-0">
                Сэлбэг <ChevronRight size={12}/>
              </button>
            </div>
          )}
          {notFound && (
            <div className="mt-3 bg-amber-50 border border-amber-200 rounded-xl p-3 text-[13px] text-amber-700">
              ⚠️ Дугаар олдсонгүй. Сэлбэгийг загвараар хайна уу.
            </div>
          )}
        </div>
      )}

      {tab===1 && (
        <div>
          <div className="grid grid-cols-3 gap-2 mb-3">
            {[{v:make,sv:setMake,p:"Үйлдвэр",o:["Toyota","Nissan","Honda","Mitsubishi","Mazda","Hyundai"]},
              {v:model,sv:setModel,p:"Загвар",o:["Prius","Camry","Land Cruiser","RAV4","X-Trail","Fit","Outlander"]},
              {v:year,sv:setYear,p:"Он",o:["2024","2023","2022","2021","2020","2019","2018","2017","2016"]}
            ].map(({v,sv,p,o})=>(
              <select key={p} value={v} onChange={e=>sv(e.target.value)}
                className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-[13px] text-gray-700 cursor-pointer focus:border-violet-500 font-sans">
                <option value="">{p}</option>
                {o.map(x=><option key={x}>{x}</option>)}
              </select>
            ))}
          </div>
          <div className="flex gap-2">
            <input value={partQ} onChange={e=>setPartQ(e.target.value)} onKeyDown={e=>e.key==="Enter"&&goSearch(partQ)}
              className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-[13px] focus:border-violet-500 focus:bg-white transition-colors"
              placeholder="Сэлбэгийн нэр эсвэл OEM дугаар..."/>
            <button onClick={()=>goSearch(partQ)}
              className="bg-violet-600 hover:bg-violet-700 text-white rounded-xl px-5 py-2.5 text-[13px] font-semibold cursor-pointer border-none transition-colors shrink-0">
              Хайх
            </button>
          </div>
        </div>
      )}

      {tab===2 && (
        <label className="block border-2 border-dashed border-violet-200 rounded-xl p-8 text-center cursor-pointer bg-violet-50 hover:bg-violet-100 transition-colors">
          <input type="file" accept="image/*" className="hidden"/>
          <div className="w-12 h-12 bg-white border border-violet-200 rounded-full flex items-center justify-center mx-auto mb-3">
            <Upload size={18} className="text-violet-500"/>
          </div>
          <p className="text-[14px] font-medium text-gray-800 mb-1">Сэлбэгийн зураг оруулна уу</p>
          <p className="text-[12px] text-gray-400">AI OEM дугаарыг автоматаар тодорхойлно</p>
        </label>
      )}
    </div>
  );
}
