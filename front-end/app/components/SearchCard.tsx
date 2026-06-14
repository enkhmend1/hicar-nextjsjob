"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { openAIChatWithImage } from "@/app/lib/aiChat";
import CameraSheet from "@/app/components/media/CameraSheet";
import { Search, Upload, Loader2, AlertTriangle, Car, ChevronRight, Camera, ScanLine } from "lucide-react";

type Tab = 0 | 1 | 2;

interface IdentifiedVehicle {
  id: string;
  plate: string;
  manufacturer: string;
  model: string;
  generation?: string;
  engineCode?: string;
  engineType?: string;
  carname?: string;
  displacement?: string;
}

const ERROR_HINT: Record<string, string> = {
  PLATE_INVALID: "Дугаарын формат буруу. Жнь: 8083СЭН",
  NOT_FOUND:    "Дугаар бүртгэлгүй байна. Загвараар хайж үзнэ үү.",
  RATE_LIMITED: "Хэт олон хүсэлт. Хэдхэн секундийн дараа дахин оролдоно уу.",
  CIRCUIT_OPEN: "Гадаад үйлчилгээ түр ажиллахгүй байна. Дараа дахин оролдоно уу.",
  TIMEOUT:      "Хүсэлт удаашрав. Дахин оролдоно уу.",
};

export default function SearchCard() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(0);
  const [plate, setPlate] = useState("");
  const [partQ, setPartQ] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState("");
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<IdentifiedVehicle | null>(null);
  const [err, setErr] = useState<{ message: string; code?: string } | null>(null);

  // Camera / scanner sheet — null = closed.
  const [sheet, setSheet] = useState<"photo" | "scan" | null>(null);

  const resetState = () => { setFound(null); setErr(null); };

  /** Image search: hand the captured/picked photo to the AI chat (vision). */
  const imageSearch = (file: File) => { setSheet(null); openAIChatWithImage(file); };

  const searchByPlate = async () => {
    const trimmed = plate.trim();
    if (!trimmed || busy) return;
    setBusy(true); setErr(null); setFound(null);
    try {
      const { vehicle } = await api.post<{ vehicle: IdentifiedVehicle }>("/vehicle/lookup", { plate: trimmed });
      setFound(vehicle);
    } catch (e) {
      const ae = e as ApiError;
      setErr({ message: ae.message, code: ae.data?.code as string | undefined });
    } finally {
      setBusy(false);
    }
  };

  const openCompatible = () => {
    if (!found) return;
    router.push(`/lookup?plate=${encodeURIComponent(found.plate)}`);
  };

  const goShopSearch = (q: string) => {
    if (q.trim()) router.push(`/shop?q=${encodeURIComponent(q.trim())}`);
  };

  const tabs = ["Улсын дугаараар", "Загвараар", "Зургаар"];

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-md shadow-blue-100/40">
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 mb-4">
        {tabs.map((t, i) => (
          <button key={t} onClick={() => { setTab(i as Tab); resetState(); }}
            className={`flex-1 py-2 text-[13px] rounded-[9px] border-none cursor-pointer font-sans transition-all ${
              tab === i ? "bg-white text-blue-600 font-semibold shadow" : "text-gray-400 bg-transparent hover:text-gray-600"
            }`}>{t}</button>
        ))}
      </div>

      {tab === 0 && (
        <div>
          <div className="flex gap-2">
            <input value={plate}
              onChange={(e) => { setPlate(e.target.value); resetState(); }}
              onKeyDown={(e) => e.key === "Enter" && searchByPlate()}
              disabled={busy}
              className="flex-1 min-w-0 bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-[16px] md:text-[14px] tracking-wider focus:border-blue-500 focus:bg-white transition-colors outline-none"
              placeholder="Жнь: 8083СЭН" />
            <button onClick={searchByPlate} disabled={busy || !plate.trim()}
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-xl px-5 py-2.5 text-[13px] font-semibold cursor-pointer border-none flex items-center gap-1.5 transition-colors shrink-0">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
              {busy ? "Хайж байна..." : "Хайх"}
            </button>
          </div>
          <p className="text-[11px] text-gray-400 mt-2">Улсын дугаараа оруулаад машиныхаа бүх мэдээллийг хараарай</p>

          {found && (
            <div className="mt-3 bg-blue-50 border border-blue-200 rounded-xl p-3 flex items-center gap-3">
              <div className="w-9 h-9 bg-gradient-to-br from-blue-500 to-amber-500 rounded-lg flex items-center justify-center shrink-0 text-white">
                <Car size={16} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold text-gray-900 truncate">
                  {found.manufacturer} {found.model}
                  {found.generation && <span className="text-gray-500 font-normal"> · {found.generation}</span>}
                </div>
                <div className="text-[11px] text-gray-500 truncate">
                  {[found.engineCode, found.engineType, found.displacement && `${found.displacement}L`, found.plate].filter(Boolean).join(" · ")}
                </div>
              </div>
              <button onClick={openCompatible}
                className="flex items-center gap-1 bg-blue-600 hover:bg-blue-700 text-white text-[12px] font-medium rounded-lg px-3 py-1.5 cursor-pointer border-none transition-colors shrink-0">
                Сэлбэг <ChevronRight size={12} />
              </button>
            </div>
          )}

          {err && (
            <div className="mt-3 bg-amber-50 border border-amber-200 rounded-xl p-3 text-[12px] text-amber-800 flex items-start gap-2">
              <AlertTriangle size={13} className="shrink-0 mt-0.5" />
              <div>
                <div className="font-medium">{err.message}</div>
                {err.code && ERROR_HINT[err.code] && (
                  <div className="text-[11px] text-amber-700 mt-0.5">{ERROR_HINT[err.code]}</div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 1 && (
        <div>
          <div className="grid grid-cols-3 gap-2 mb-3">
            {[
              { v: make,  sv: setMake,  p: "Үйлдвэр", o: ["Toyota", "Nissan", "Honda", "Mitsubishi", "Mazda", "Hyundai"] },
              { v: model, sv: setModel, p: "Загвар",   o: ["Prius", "Camry", "Land Cruiser", "RAV4", "X-Trail", "Fit", "Outlander"] },
              { v: year,  sv: setYear,  p: "Он",       o: ["2024", "2023", "2022", "2021", "2020", "2019", "2018", "2017", "2016"] },
            ].map(({ v, sv, p, o }) => (
              <select key={p} value={v} onChange={(e) => sv(e.target.value)}
                className="w-full min-w-0 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-[16px] md:text-[13px] text-gray-700 cursor-pointer focus:border-blue-500 font-sans">
                <option value="">{p}</option>
                {o.map((x) => <option key={x}>{x}</option>)}
              </select>
            ))}
          </div>
          <div className="flex gap-2">
            <input value={partQ} onChange={(e) => setPartQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && goShopSearch(partQ)}
              className="flex-1 min-w-0 bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-[16px] md:text-[13px] focus:border-blue-500 focus:bg-white transition-colors"
              placeholder="Сэлбэгийн нэр эсвэл OEM дугаар..." />
            <button onClick={() => goShopSearch(partQ)}
              className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl px-5 py-2.5 text-[13px] font-semibold cursor-pointer border-none transition-colors shrink-0">
              Хайх
            </button>
          </div>
        </div>
      )}

      {tab === 2 && (
        <div className="space-y-2.5">
          <div className="grid grid-cols-2 gap-2.5">
            {/* Live device camera → AI vision search */}
            <button onClick={() => setSheet("photo")}
              className="flex flex-col items-center justify-center gap-2 border-2 border-blue-200 rounded-xl p-5 bg-blue-50 hover:bg-blue-100 cursor-pointer transition-colors border-none">
              <span className="w-11 h-11 bg-white border border-blue-200 rounded-full flex items-center justify-center">
                <Camera size={18} className="text-blue-600" />
              </span>
              <span className="text-[13px] font-semibold text-gray-800">Камераар авах</span>
            </button>
            {/* Gallery upload → AI vision search */}
            <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-blue-200 rounded-xl p-5 bg-blue-50 hover:bg-blue-100 cursor-pointer transition-colors">
              <input type="file" accept="image/*" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) imageSearch(f); }} />
              <span className="w-11 h-11 bg-white border border-blue-200 rounded-full flex items-center justify-center">
                <Upload size={18} className="text-blue-500" />
              </span>
              <span className="text-[13px] font-semibold text-gray-800">Зураг сонгох</span>
            </label>
          </div>
          {/* QR / barcode scan → part search by the decoded code */}
          <button onClick={() => setSheet("scan")}
            className="w-full flex items-center justify-center gap-2 border border-gray-200 rounded-xl py-2.5 text-[13px] font-medium text-gray-700 hover:border-blue-400 hover:text-blue-600 cursor-pointer bg-white transition-colors">
            <ScanLine size={15} /> QR / баркод уншуулах
          </button>
          <p className="text-[11px] text-gray-400 text-center">AI зургаас OEM дугаарыг таних, эсвэл баркодоор шууд хайна</p>
        </div>
      )}

      {sheet === "photo" && (
        <CameraSheet mode="photo" title="Сэлбэгийн зураг авах"
          onCapture={imageSearch} onClose={() => setSheet(null)} />
      )}
      {sheet === "scan" && (
        <CameraSheet mode="scan" title="QR / баркод уншуулах"
          onResult={(text) => { setSheet(null); goShopSearch(text); }}
          onClose={() => setSheet(null)} />
      )}
    </div>
  );
}
