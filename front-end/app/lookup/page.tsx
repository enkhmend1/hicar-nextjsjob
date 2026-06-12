"use client";
/**
 * /lookup — plate-based vehicle identification + compatible parts.
 *
 * Flow (server-side handles all external API access):
 *   1. User enters Mongolian plate (e.g. "8083СЭН")  OR  arrives with ?plate=
 *   2. POST /api/vehicle/lookup       → identified vehicle (cached or fresh)
 *   3. POST /api/vehicle/compatible   → ranked compatible products
 */

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import BuyerShell from "@/app/components/BuyerShell";
import ProductCard from "@/app/components/ProductCard";
import SmartPartSearch from "@/app/components/SmartPartSearch";
import { useCarStore } from "@/store";
import { api, ApiError } from "@/lib/api";
import { Product } from "@/app/types";
import { Car, Search, Sparkles, Loader2, AlertTriangle, RefreshCw, Cog, Wrench } from "lucide-react";

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

interface CompatibleResponse {
  vehicle: IdentifiedVehicle;
  items: (Product & { _matchScore?: number; _matchReason?: string })[];
  counts: { oem?: number; engine?: number; model?: number; manufacturer?: number };
  oemBagSize: number;
}

const TIER_BADGE: Record<number, { label: string; color: string }> = {
  100: { label: "Яг таарсан OEM",      color: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  80:  { label: "Хөдөлгүүрийн код",   color: "bg-blue-100 text-blue-700 border-blue-200" },
  60:  { label: "Загвар таарсан",     color: "bg-blue-100 text-blue-700 border-blue-200" },
  40:  { label: "Үйлдвэр таарсан",   color: "bg-amber-100 text-amber-700 border-amber-200" },
};

function LookupInner() {
  const params = useSearchParams();
  const setActiveVehicle = useCarStore((s) => s.setActiveVehicle);
  const [plate, setPlate] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<{ message: string; code?: string } | null>(null);
  const [data, setData] = useState<CompatibleResponse | null>(null);
  const autoRanForRef = useRef<string | null>(null);

  const runLookup = async (rawPlate: string, opts: { fresh?: boolean } = {}) => {
    const trimmed = rawPlate.trim();
    if (!trimmed) return;
    opts.fresh ? setRefreshing(true) : setBusy(true);
    setErr(null);
    try {
      const { vehicle } = await api.post<{ vehicle: IdentifiedVehicle }>(
        "/vehicle/lookup", { plate: trimmed, fresh: opts.fresh },
      );
      const result = await api.post<CompatibleResponse>(
        "/vehicle/compatible", { vehicleId: vehicle.id, limit: 24 },
      );
      setData(result);
      // Persist the active vehicle so AIChatWidget can do vehicle-scoped search
      setActiveVehicle({
        id:           vehicle.id,
        plate:        vehicle.plate,
        manufacturer: vehicle.manufacturer,
        model:        vehicle.model,
        generation:   vehicle.generation,
        engineCode:   vehicle.engineCode,
        engineType:   vehicle.engineType,
      });
    } catch (e) {
      const ae = e as ApiError;
      setErr({ message: ae.message, code: ae.data?.code as string | undefined });
      setData(null);
    } finally {
      setBusy(false); setRefreshing(false);
    }
  };

  const submit = (e?: React.FormEvent, opts: { fresh?: boolean } = {}) => {
    e?.preventDefault();
    return runLookup(plate, opts);
  };

  // Auto-run when navigated with ?plate=… (e.g. from SearchCard)
  useEffect(() => {
    const incoming = params.get("plate");
    if (!incoming) return;
    if (autoRanForRef.current === incoming) return;
    autoRanForRef.current = incoming;
    setPlate(incoming);
    runLookup(incoming);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  return (
    <BuyerShell>
      <div className="max-w-6xl mx-auto px-5 py-6">
        <section className="bg-gradient-to-br from-blue-600 via-blue-500 to-amber-500 rounded-3xl p-6 md:p-8 text-white shadow-xl shadow-blue-200 mb-6">
          <div className="inline-flex items-center gap-1.5 bg-white/15 backdrop-blur text-white text-[11px] font-semibold px-3 py-1.5 rounded-full mb-4 tracking-wide">
            <Sparkles size={11} /> AI VEHICLE LOOKUP
          </div>
          <h1 className="text-[clamp(22px,4vw,32px)] font-semibold leading-tight mb-2">
            Улсын дугаараа оруулаад<br />
            <span className="opacity-80">машиндаа тохирох</span> сэлбэг олоорой
          </h1>
          <p className="text-[14px] opacity-80 mb-5">
            OEM код шаардахгүй — хөдөлгүүрийн код, загвар, үйлдвэрээр нь автоматаар тааруулна.
          </p>

          <form onSubmit={submit} className="flex flex-wrap gap-2 items-center bg-white/12 backdrop-blur rounded-2xl p-2">
            <Car size={18} className="ml-2 text-white/80" />
            <input
              value={plate}
              onChange={(e) => setPlate(e.target.value)}
              placeholder="Жнь: 8083СЭН"
              className="flex-1 min-w-[160px] bg-transparent text-white placeholder-white/60 text-[16px] md:text-[15px] outline-none px-2 py-2"
              autoFocus
              disabled={busy}
            />
            <button type="submit" disabled={busy || !plate.trim()}
              className="bg-white text-blue-700 hover:bg-blue-50 disabled:bg-white/40 rounded-xl px-5 py-2 text-[14px] font-semibold cursor-pointer border-none transition-colors font-sans flex items-center gap-2">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
              {busy ? "Хайж байна..." : "Хайх"}
            </button>
          </form>
          {data && (
            <button onClick={(e) => submit(e, { fresh: true })} disabled={refreshing}
              className="mt-2 inline-flex items-center gap-1 text-[11px] text-white/70 hover:text-white cursor-pointer bg-transparent border-none font-sans">
              {refreshing ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
              Шинэчлэх (cache алгасах)
            </button>
          )}
        </section>

        {err && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-[13px] rounded-xl px-4 py-3 mb-6 flex items-start gap-2">
            <AlertTriangle size={15} className="shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold">{err.message}</div>
              {err.code && <div className="text-[11px] text-red-500 mt-0.5 font-mono">code: {err.code}</div>}
              {err.code === "NOT_FOUND" && (
                <div className="text-[11px] text-red-500 mt-1">Дугаараа дахин шалгана уу. Шинэ машин эсвэл бүртгэгдээгүй байж магадгүй.</div>
              )}
              {err.code === "RATE_LIMITED" && (
                <div className="text-[11px] text-red-500 mt-1">Хэт олон хүсэлт. Хэдэн секундийн дараа дахин оролдоно уу.</div>
              )}
              {err.code === "CIRCUIT_OPEN" && (
                <div className="text-[11px] text-red-500 mt-1">Гадаад API түр ажиллахгүй байна. Cache-аас үзэх боломжтой.</div>
              )}
            </div>
          </div>
        )}

        {data && (
          <>
            <VehicleCard vehicle={data.vehicle} oemBagSize={data.oemBagSize} />

            {/* Vehicle-scoped intelligent search — Mongolian query → AI → external OEM → matched products */}
            <SmartPartSearch vehicleId={data.vehicle.id} />

            <h3 className="text-[14px] font-semibold text-gray-900 mt-2 mb-2">
              Энэ машинд тохирох бүх бараа
            </h3>
            <CountsBar counts={data.counts} total={data.items.length} />

            {data.items.length === 0 ? (
              <div className="bg-white border border-gray-200 rounded-2xl py-16 text-center mt-4">
                <Wrench size={40} className="mx-auto text-gray-200 mb-3" />
                <p className="text-[15px] font-medium text-gray-700">Тохиромжтой бараа олдсонгүй</p>
                <p className="text-[12px] text-gray-400 mt-1">
                  Танай машинд тохирох бараа админуудын каталогт хараахан бүртгэгдээгүй байна.
                </p>
                <Link href="/shop" className="inline-block mt-4 text-[12px] text-blue-600 underline" style={{ textDecoration: "underline" }}>
                  Бүх дэлгүүрийг үзэх →
                </Link>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mt-4">
                {data.items.map((p) => (
                  <div key={p._id ?? p.id} className="relative">
                    {p._matchScore !== undefined && (
                      <span className={`absolute z-10 top-1.5 left-1.5 text-[9px] font-semibold px-1.5 py-0.5 rounded-full border ${TIER_BADGE[p._matchScore]?.color ?? "bg-gray-50 text-gray-600 border-gray-200"}`}
                        title={p._matchReason}>
                        {TIER_BADGE[p._matchScore]?.label ?? "match"}
                      </span>
                    )}
                    <ProductCard p={p} />
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </BuyerShell>
  );
}

function VehicleCard({ vehicle, oemBagSize }: { vehicle: IdentifiedVehicle; oemBagSize: number }) {
  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-5 mb-4 flex flex-wrap items-center gap-5">
      <div className="w-14 h-14 bg-gradient-to-br from-blue-500 to-amber-500 rounded-2xl flex items-center justify-center text-white shrink-0">
        <Car size={24} />
      </div>
      <div className="flex-1 min-w-[200px]">
        <div className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">{vehicle.plate}</div>
        <h2 className="text-[18px] font-semibold text-gray-900">
          {vehicle.manufacturer} {vehicle.model}
          {vehicle.generation && <span className="text-gray-500 font-normal"> · {vehicle.generation}</span>}
        </h2>
        <div className="text-[12px] text-gray-500 mt-1 flex flex-wrap gap-3">
          {vehicle.engineCode && <span className="flex items-center gap-1"><Cog size={11} /> {vehicle.engineCode}</span>}
          {vehicle.engineType && <span>{vehicle.engineType}</span>}
          {vehicle.displacement && <span>{vehicle.displacement} L</span>}
          {vehicle.carname && <span className="text-gray-400">({vehicle.carname})</span>}
        </div>
      </div>
      {oemBagSize > 0 && (
        <div className="text-right">
          <div className="text-[11px] text-gray-400">OEM equivalence cloud</div>
          <div className="text-[18px] font-bold text-blue-600 tabular-nums">{oemBagSize}</div>
        </div>
      )}
    </div>
  );
}

export default function LookupPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50" />}>
      <LookupInner />
    </Suspense>
  );
}

function CountsBar({ counts, total }: { counts: CompatibleResponse["counts"]; total: number }) {
  const tiers = [
    { id: "oem",          label: "OEM",       v: counts.oem ?? 0,          color: "bg-emerald-500" },
    { id: "engine",       label: "Engine",    v: counts.engine ?? 0,       color: "bg-blue-500" },
    { id: "model",        label: "Model",     v: counts.model ?? 0,        color: "bg-blue-500" },
    { id: "manufacturer", label: "Mfr",       v: counts.manufacturer ?? 0, color: "bg-amber-500" },
  ];
  if (total === 0) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-3 flex items-center gap-3 flex-wrap text-[11px]">
      <span className="font-semibold text-gray-700">{total} тохиромжтой бараа:</span>
      {tiers.map((t) => (
        t.v > 0 && (
          <span key={t.id} className="inline-flex items-center gap-1">
            <span className={`w-2 h-2 rounded-full ${t.color}`} />
            <span className="text-gray-600">{t.label}</span>
            <span className="font-semibold text-gray-900 tabular-nums">{t.v}</span>
          </span>
        )
      ))}
    </div>
  );
}
