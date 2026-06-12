"use client";
/**
 * SmartPartSearch — vehicle-scoped intelligent parts search.
 *
 * Given a vehicle (either Mongo id or plate), exposes a search box that
 * routes the query through /api/search/smart:
 *
 *   "урд наклад" → AI translates to "front brake pads"
 *                 → external API returns canonical OEM codes for THIS car
 *                 → DB matched products ranked by compatibility
 *
 * The component surfaces *both* the matched products AND the diagnostics
 * (AI plan, OEM bag) so power users and admins can verify the chain.
 */

import { useCallback, useState } from "react";
import Link from "next/link";
import ProductCard from "./ProductCard";
import { api, ApiError } from "@/lib/api";
import { Product } from "@/app/types";
import {
  Search, Loader2, Sparkles, AlertTriangle, ChevronDown, ChevronUp,
  Database, Brain, Cpu,
} from "lucide-react";

// ── Types (mirror smartSearch.service.js return shape) ─────────────────
interface AiPlan {
  standard_category: string;
  api_english_name:  string;
  search_keywords:   string[];
  possible_oem_codes:   string[];
  possible_cross_codes: string[];
}

interface SmartResponse {
  query: string;
  vehicle: { manuname: string; modelname: string; generation?: string; motorcode?: string };
  ai:       { plan: AiPlan; source: "cache" | "llm" | "fallback"; tookMs: number; model?: string };
  external: { provider: string; hit: "cache" | "network" | "none"; oems: string[]; itemsPreview?: unknown[]; tookMs: number };
  oemBag:   string[];
  items:    (Product & { _matchScore?: number; _matchReason?: string })[];
  fallbackSearch: { used: boolean; keywords: string[] };
  meta:     { totalMs: number; itemCount: number; warnings: string[] };
}

const TIER_BADGE: Record<number, { label: string; color: string }> = {
  100: { label: "OEM",     color: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  80:  { label: "Engine",  color: "bg-blue-100 text-blue-700 border-blue-200" },
  60:  { label: "Model",   color: "bg-blue-100 text-blue-700 border-blue-200" },
  40:  { label: "Mfr",     color: "bg-amber-100 text-amber-700 border-amber-200" },
};

const SOURCE_BADGE: Record<string, { label: string; color: string; icon: typeof Cpu }> = {
  llm:      { label: "GPT-аар",      color: "bg-emerald-100 text-emerald-700", icon: Brain },
  cache:    { label: "Cache",         color: "bg-blue-100 text-blue-700",      icon: Database },
  fallback: { label: "Fallback",     color: "bg-amber-100 text-amber-700",    icon: Cpu },
};

const SUGGESTIONS = ["урд наклад", "ард наклад", "амортизатор", "урд фар", "тосны шүүр"];

interface Props {
  /** Either prop is enough; vehicleId is preferred (avoids re-lookup). */
  vehicleId?: string;
  plate?: string;
  /** Optional initial query (e.g. deep-linked from chat). */
  initialQuery?: string;
}

export default function SmartPartSearch({ vehicleId, plate, initialQuery = "" }: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<SmartResponse | null>(null);
  const [err, setErr] = useState<{ message: string; code?: string } | null>(null);
  const [showDiag, setShowDiag] = useState(false);

  const run = useCallback(async (override?: string) => {
    const q = (override ?? query).trim();
    if (!q || busy) return;
    setBusy(true); setErr(null);
    try {
      const body: Record<string, unknown> = { query: q, limit: 24 };
      if (vehicleId) body.vehicleId = vehicleId;
      else if (plate) body.plate = plate;
      const r = await api.post<SmartResponse>("/search/smart", body);
      setData(r);
    } catch (e) {
      const ae = e as ApiError;
      setErr({ message: ae.message, code: ae.data?.code as string | undefined });
      setData(null);
    } finally {
      setBusy(false);
    }
  }, [query, busy, vehicleId, plate]);

  return (
    <section className="bg-white border border-gray-200 rounded-2xl p-5 mb-4">
      <header className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h2 className="text-[15px] font-semibold text-gray-900 flex items-center gap-2">
          <Sparkles size={15} className="text-blue-500" /> Тодорхой сэлбэг хайх
        </h2>
        <span className="text-[11px] text-gray-400">
          Жнь: <em>«урд наклад»</em>, <em>«2GR-FSE свеч»</em>
        </span>
      </header>

      <form onSubmit={(e) => { e.preventDefault(); run(); }}
        className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl pl-3 focus-within:border-blue-500 focus-within:bg-white transition-colors">
        <Search size={14} className="text-gray-400 shrink-0" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={busy}
          placeholder="Сэлбэгийн нэр Монголоор бичнэ үү…"
          className="flex-1 bg-transparent text-[16px] md:text-[13px] outline-none py-2.5 font-sans" />
        <button type="submit" disabled={busy || !query.trim()}
          className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-lg px-3.5 py-1.5 m-1 text-[12px] font-semibold cursor-pointer border-none flex items-center gap-1.5 transition-colors shrink-0">
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
          {busy ? "..." : "Хайх"}
        </button>
      </form>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {SUGGESTIONS.map((s) => (
          <button key={s} onClick={() => { setQuery(s); run(s); }} disabled={busy}
            className="text-[11px] border border-gray-200 rounded-full px-2.5 py-0.5 text-gray-600 hover:border-blue-400 hover:text-blue-600 cursor-pointer bg-white transition-colors disabled:opacity-50 font-sans">
            {s}
          </button>
        ))}
      </div>

      {err && (
        <div className="mt-3 bg-red-50 border border-red-200 text-red-700 text-[12px] rounded-xl px-3 py-2 flex items-start gap-2">
          <AlertTriangle size={13} className="shrink-0 mt-0.5" />
          <div>{err.message}{err.code && <div className="text-[10px] text-red-500 mt-0.5 font-mono">code: {err.code}</div>}</div>
        </div>
      )}

      {data && (
        <>
          {/* AI plan summary chip-bar */}
          <PlanSummary data={data} expanded={showDiag} onToggle={() => setShowDiag((v) => !v)} />

          {/* Diagnostics drawer */}
          {showDiag && <DiagnosticsPanel data={data} />}

          {/* Results */}
          {data.items.length === 0 ? (
            <div className="mt-4 bg-gray-50 border border-gray-200 rounded-xl p-6 text-center">
              <p className="text-[13px] font-medium text-gray-700">Тохирох бараа олдсонгүй</p>
              <p className="text-[11px] text-gray-500 mt-1">
                AI-аас илгээсэн OEM кодуудаар манай дэлгүүрт бараа алга байна.
              </p>
              {data.fallbackSearch.used && (
                <p className="text-[11px] text-gray-400 mt-1">
                  Текст хайлтаар ч олдсонгүй: {data.fallbackSearch.keywords.join(", ")}
                </p>
              )}
              <Link href="/shop" className="inline-block mt-3 text-[12px] text-blue-600 underline" style={{ textDecoration: "underline" }}>
                Бүх дэлгүүрийг үзэх →
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mt-4">
              {data.items.map((p) => (
                <div key={p._id ?? p.id} className="relative">
                  {p._matchScore !== undefined && TIER_BADGE[p._matchScore] && (
                    <span className={`absolute z-10 top-1.5 left-1.5 text-[9px] font-semibold px-1.5 py-0.5 rounded-full border ${TIER_BADGE[p._matchScore].color}`}
                      title={p._matchReason}>
                      {TIER_BADGE[p._matchScore].label}
                    </span>
                  )}
                  <ProductCard p={p} />
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────
function PlanSummary({ data, expanded, onToggle }: { data: SmartResponse; expanded: boolean; onToggle: () => void }) {
  const aiBadge = SOURCE_BADGE[data.ai.source] ?? SOURCE_BADGE.fallback;
  const AiIcon = aiBadge.icon;
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px]">
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium ${aiBadge.color}`}>
        <AiIcon size={10} /> {aiBadge.label} ({data.ai.tookMs}ms)
      </span>
      {data.ai.plan.api_english_name && (
        <span className="bg-blue-50 text-blue-700 border border-blue-100 px-2 py-0.5 rounded-full font-medium">
          → {data.ai.plan.api_english_name}
        </span>
      )}
      {data.external.hit !== "none" && (
        <span className="bg-blue-50 text-blue-700 border border-blue-100 px-2 py-0.5 rounded-full">
          {data.external.provider}: {data.external.oems.length} OEM
        </span>
      )}
      <span className="bg-emerald-50 text-emerald-700 border border-emerald-100 px-2 py-0.5 rounded-full font-semibold">
        OEM bag: {data.oemBag.length}
      </span>
      <span className="bg-gray-50 text-gray-700 border border-gray-200 px-2 py-0.5 rounded-full">
        {data.items.length} бараа
      </span>
      <button onClick={onToggle}
        className="ml-auto inline-flex items-center gap-0.5 text-gray-500 hover:text-blue-600 cursor-pointer bg-transparent border-none font-sans">
        Дэлгэрэнгүй {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
      </button>
    </div>
  );
}

function DiagnosticsPanel({ data }: { data: SmartResponse }) {
  return (
    <div className="mt-2 bg-gray-50 border border-gray-200 rounded-xl p-3 space-y-2 text-[11px]">
      <Row label="Standard category" value={data.ai.plan.standard_category || "—"} />
      <Row label="Search keywords"  value={data.ai.plan.search_keywords.join(" · ") || "—"} />
      {data.ai.plan.possible_oem_codes.length > 0 && (
        <Row label="AI OEM" mono value={data.ai.plan.possible_oem_codes.join(" · ")} />
      )}
      {data.ai.plan.possible_cross_codes.length > 0 && (
        <Row label="AI cross-refs" mono value={data.ai.plan.possible_cross_codes.join(" · ")} />
      )}
      {data.external.oems.length > 0 && (
        <Row label={`${data.external.provider} OEM`} mono value={data.external.oems.join(" · ")} />
      )}
      <Row label="Merged OEM bag" mono value={data.oemBag.join(" · ") || "—"} />
      <Row label="Total time" value={`${data.meta.totalMs} ms (ai ${data.ai.tookMs}ms + external ${data.external.tookMs}ms)`} />
      {data.meta.warnings.length > 0 && (
        <Row label="Warnings" value={data.meta.warnings.join(" · ")} className="text-amber-700" />
      )}
    </div>
  );
}

function Row({ label, value, mono = false, className = "" }: { label: string; value: string; mono?: boolean; className?: string }) {
  return (
    <div className="flex flex-col sm:flex-row sm:gap-3">
      <span className="text-gray-400 sm:w-32 shrink-0">{label}</span>
      <span className={`text-gray-700 ${mono ? "font-mono text-[10px]" : ""} ${className}`}>{value}</span>
    </div>
  );
}
