"use client";

import { useState } from "react";
import { Search, Upload } from "lucide-react";

const CAR_DB: Record<string, { name: string; detail: string }> = {
  "УБ 1234 АА": { name: "Toyota Prius 2018", detail: "1.8L Hybrid · ZVW50" },
  "УБ 5678 БА": { name: "Nissan X-Trail 2020", detail: "2.0L · T32" },
  "ДА 4321 ВА": { name: "Toyota Land Cruiser 200", detail: "4.5L Diesel · URJ202" },
};

type TabId = 0 | 1 | 2;

export default function SearchCard() {
  const [activeTab, setActiveTab] = useState<TabId>(0);
  const [plate, setPlate] = useState("");
  const [result, setResult] = useState<{ name: string; detail: string } | null>(null);

  const handleSearch = () => {
    const key = plate.trim().toUpperCase();
    const found = CAR_DB[key] ?? { name: "Toyota Camry 2019", detail: "2.5L · AXVH70" };
    setResult(found);
  };

  const tabs = ["Улсын дугаараар", "Загвараар", "Зургаар"];

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 mb-4">
        {tabs.map((tab, i) => (
          <button
            key={tab}
            onClick={() => { setActiveTab(i as TabId); setResult(null); }}
            className={`flex-1 text-center py-2 text-[13px] rounded-[9px] cursor-pointer border-none transition-all font-sans ${
              activeTab === i
                ? "bg-white text-violet-600 font-medium shadow-sm"
                : "text-gray-400 bg-transparent"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab 0 — Plate */}
      {activeTab === 0 && (
        <div>
          <div className="flex gap-2">
            <input
              value={plate}
              onChange={(e) => setPlate(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-3.5 py-2.5 text-sm text-gray-900 font-sans tracking-wide focus:border-violet-600 focus:bg-white transition-colors"
              placeholder="УБ 1234 АА — дугаар оруулна уу"
            />
            <button
              onClick={handleSearch}
              className="bg-violet-600 hover:bg-violet-700 text-white rounded-lg px-5 py-2.5 text-sm font-medium shrink-0 cursor-pointer font-sans transition-colors flex items-center gap-1.5"
            >
              <Search size={14} />
              Хайх
            </button>
          </div>
          <p className="text-[11px] text-gray-400 mt-2">Жишээ: УБ 1234 АА · ДА 5678 БА</p>

          {result && (
            <div className="mt-2.5 bg-violet-50 border border-violet-200 rounded-xl px-3.5 py-2.5 flex items-center gap-2.5">
              <span className="w-2 h-2 rounded-full bg-violet-600 shrink-0" />
              <div>
                <div className="text-[13px] font-medium text-gray-900">{result.name}</div>
                <div className="text-[11px] text-gray-400 mt-0.5">{result.detail}</div>
              </div>
              <span className="ml-auto bg-violet-600 text-white text-[10px] px-2 py-0.5 rounded shrink-0">
                Олдлоо
              </span>
            </div>
          )}
        </div>
      )}

      {/* Tab 1 — Model */}
      {activeTab === 1 && (
        <div>
          <div className="flex flex-wrap gap-2 mb-2.5">
            {[
              { placeholder: "Үйлдвэр", options: ["Toyota", "Nissan", "Honda", "Mitsubishi", "Mazda"] },
              { placeholder: "Загвар", options: ["Prius", "Camry", "Land Cruiser", "RAV4"] },
              { placeholder: "Он", options: ["2024", "2022", "2020", "2018", "2016"] },
            ].map(({ placeholder, options }) => (
              <select
                key={placeholder}
                className="flex-1 min-w-[90px] bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-700 font-sans cursor-pointer focus:border-violet-600"
              >
                <option>{placeholder}</option>
                {options.map((o) => <option key={o}>{o}</option>)}
              </select>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-3.5 py-2.5 text-sm font-sans focus:border-violet-600"
              placeholder="Сэлбэгийн нэр эсвэл OEM дугаар..."
            />
            <button className="bg-violet-600 hover:bg-violet-700 text-white rounded-lg px-5 py-2.5 text-sm font-medium shrink-0 cursor-pointer font-sans transition-colors">
              Хайх
            </button>
          </div>
        </div>
      )}

      {/* Tab 2 — Image */}
      {activeTab === 2 && (
        <div className="border-2 border-dashed border-violet-200 rounded-xl p-7 text-center cursor-pointer bg-violet-50 hover:bg-violet-100 transition-colors">
          <div className="w-10 h-10 bg-white border border-violet-200 rounded-full flex items-center justify-center mx-auto mb-2.5">
            <Upload size={16} className="text-violet-600" />
          </div>
          <p className="text-[13px] font-medium text-gray-900 mb-1">Сэлбэгийн зураг оруулна уу</p>
          <p className="text-[11px] text-gray-400">
            AI таны сэлбэгийн OEM дугаарыг тодорхойлно · JPG, PNG
          </p>
        </div>
      )}
    </div>
  );
}
