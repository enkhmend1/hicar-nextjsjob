"use client";

/**
 * Admin — Data Platform: Normalization review queue + overview.
 *
 * Surfaces the self-improving loop (data-platform M2–M5):
 *   • Overview strip: counts across raw → normalized + catalog/corrections.
 *   • Review queue: lowest-confidence interpretations with the seller's RAW
 *     text, so an admin can correct them inline. A correction with a rawToken
 *     teaches the alias dictionary — the next occurrence resolves automatically.
 *
 * Talks to the data platform through the same-origin /api/dp proxy.
 */

import { useEffect, useState, useCallback } from "react";
import { useAuthStore } from "@/store";
import { dpApi } from "@/app/lib/dpApi";
import {
  Sparkles, RefreshCw, Check, AlertTriangle, Database, ListChecks,
  Gauge, BookMarked, Wrench, Loader2,
} from "lucide-react";
import {
  PageHeader, Card, StatCard, FilterTabs, ErrorBanner, btn,
} from "@/app/admin/_components/ui";

// ── DP response shapes ────────────────────────────────────────────
interface FieldRes { value: string | null; confidence: number; source: string; evidence?: string }
interface RawCtx { rawTitle?: string; rawOem?: string; rawBrand?: string }
interface ReviewItem {
  _id: string;
  rawProductId: string;
  partType: FieldRes;
  canonicalBrand: FieldRes;
  canonicalModel: FieldRes;
  generation: FieldRes;
  oem: FieldRes;
  overallConfidence: number;
  status: string;
  raw: RawCtx | null;
}
interface QueueResp { ok: boolean; total: number; items: ReviewItem[] }
interface Stats {
  raw: { total: number; byStatus: Record<string, number> };
  normalized: { total: number; byStatus: Record<string, number>; avgConfidence: number; reviewable: number };
  catalog: { parts: number; aliases: number };
  corrections: { total: number };
}
interface StatsResp { ok: boolean; stats: Stats }

type StatusFilter = "needs_review" | "rejected" | "all";
type CorrectableField = "partType" | "canonicalBrand" | "canonicalModel" | "generation" | "oem";

const FIELD_LABELS: Record<CorrectableField, string> = {
  partType: "Эд анги",
  canonicalBrand: "Брэнд",
  canonicalModel: "Загвар",
  generation: "Үе (chassis)",
  oem: "OEM",
};

const confColor = (c: number) =>
  c >= 0.9 ? "text-emerald-700 bg-emerald-50 border-emerald-200"
  : c >= 0.6 ? "text-amber-700 bg-amber-50 border-amber-200"
  : "text-red-600 bg-red-50 border-red-200";

const STATUS_BADGE: Record<string, string> = {
  auto_approved: "bg-emerald-50 text-emerald-700 border-emerald-200",
  needs_review: "bg-amber-50 text-amber-700 border-amber-200",
  rejected: "bg-red-50 text-red-600 border-red-200",
  superseded: "bg-gray-100 text-gray-500 border-gray-200",
};

export default function NormalizationAdminPage() {
  const { user } = useAuthStore();
  const adminId = (user?._id ?? user?.id) as string | undefined;

  const [stats, setStats] = useState<Stats | null>(null);
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [filter, setFilter] = useState<StatusFilter>("needs_review");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  const reload = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const qs = filter === "all" ? "limit=50" : `status=${filter}&limit=50`;
      const [s, q] = await Promise.all([
        dpApi.get<StatsResp>("stats"),
        dpApi.get<QueueResp>(`review/queue?${qs}`),
      ]);
      setStats(s.stats);
      setItems(q.items);
    } catch (e) {
      setErr((e as Error).message || "Алдаа гарлаа");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { reload(); }, [reload]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Нормчлол ба шалгалт"
        icon={Sparkles}
        subtitle="Түүхий зарын текстийг бүтэцлэх — бага итгэлтэй тайлбаруудыг засаж, толь бичгийг өсгөнө."
        actions={
          <button onClick={reload} className={btn.secondary}>
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Шинэчлэх
          </button>
        }
      />

      {err && (
        <ErrorBanner>
          {err} — Data platform ажиллаж байгаа эсэхийг шалгана уу (npm run dp:server).
        </ErrorBanner>
      )}
      {msg && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 text-[12px] rounded-xl px-3 py-2 flex items-center gap-2">
          <Check size={14} /> {msg}
        </div>
      )}

      {/* ── OVERVIEW STRIP ─────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard icon={Database} label="Түүхий" value={stats?.raw.total ?? "—"} hint="raw_products" />
        <StatCard icon={ListChecks} label="Нормчилсон" value={stats?.normalized.total ?? "—"} hint="normalized" />
        <StatCard icon={AlertTriangle} label="Шалгах" value={stats?.normalized.reviewable ?? "—"} tone="amber" />
        <StatCard icon={Gauge} label="Дундаж итгэл"
          value={stats ? `${Math.round(stats.normalized.avgConfidence * 100)}%` : "—"} />
        <StatCard icon={BookMarked} label="Alias толь" value={stats?.catalog.aliases ?? "—"} hint={`${stats?.catalog.parts ?? "—"} эд анги`} />
        <StatCard icon={Wrench} label="Засвар" value={stats?.corrections.total ?? "—"} hint="нийт" />
      </div>

      {/* ── FILTER TABS ────────────────────────────────────────── */}
      <FilterTabs<StatusFilter>
        value={filter}
        onSelect={setFilter}
        options={[
          { id: "needs_review", label: "Шалгах" },
          { id: "rejected", label: "Татгалзсан" },
          { id: "all", label: "Бүгд" },
        ]}
      />

      {/* ── QUEUE ──────────────────────────────────────────────── */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((n) => <div key={n} className="h-28 bg-gray-100 rounded-2xl animate-pulse" />)}
        </div>
      ) : items.length === 0 ? (
        <Card className="p-10 text-center text-gray-400 text-[14px]">
          {err ? "Өгөгдөл ачаалж чадсангүй." : "🎉 Шалгах зүйл алга — бүх тайлбар хангалттай итгэлтэй байна."}
        </Card>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <ReviewRow
              key={item._id}
              item={item}
              adminId={adminId}
              onDone={(text) => { setMsg(text); setTimeout(() => setMsg(""), 2500); reload(); }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────
function ReviewRow({ item, adminId, onDone }: {
  item: ReviewItem;
  adminId?: string;
  onDone: (msg: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [field, setField] = useState<CorrectableField>("partType");
  const [newValue, setNewValue] = useState("");
  const [rawToken, setRawToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [rowErr, setRowErr] = useState("");

  const submit = async () => {
    if (!adminId) { setRowErr("Админ ID олдсонгүй"); return; }
    if (!newValue.trim()) { setRowErr("Шинэ утга оруулна уу"); return; }
    setBusy(true); setRowErr("");
    try {
      const res = await dpApi.post<{ aliasLearned: boolean; reprocessQueued: number }>(
        "feedback/corrections",
        { normalizedProductId: item._id, field, newValue: newValue.trim(), rawToken: rawToken.trim() || undefined, correctedBy: adminId, role: "admin" },
      );
      const learned = res.aliasLearned
        ? ` · "${rawToken.trim()}" толь бичигт нэмэгдэв (${res.reprocessQueued} бараа дахин боловсруулагдана)`
        : "";
      onDone(`Засвар хадгалагдлаа${learned}`);
    } catch (e) {
      setRowErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const fields: { key: CorrectableField; fr: FieldRes }[] = [
    { key: "partType", fr: item.partType },
    { key: "canonicalBrand", fr: item.canonicalBrand },
    { key: "canonicalModel", fr: item.canonicalModel },
    { key: "generation", fr: item.generation },
    { key: "oem", fr: item.oem },
  ];

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {/* Raw context — what the seller actually typed */}
          <div className="text-[11px] text-gray-400 uppercase tracking-wider mb-0.5">Түүхий текст</div>
          <div className="text-[14px] font-semibold text-gray-900 truncate">
            {item.raw?.rawTitle || <span className="text-gray-400 italic">— гарчиггүй —</span>}
          </div>
          {item.raw?.rawOem && <div className="text-[11px] text-gray-400 font-mono mt-0.5">{item.raw.rawOem}</div>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`text-[11px] px-2 py-0.5 rounded-full border font-medium ${confColor(item.overallConfidence)}`}>
            {Math.round(item.overallConfidence * 100)}%
          </span>
          <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${STATUS_BADGE[item.status] ?? "bg-gray-100 text-gray-500 border-gray-200"}`}>
            {item.status}
          </span>
        </div>
      </div>

      {/* Interpreted fields */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mt-3">
        {fields.map(({ key, fr }) => (
          <div key={key} className="bg-gray-50 rounded-lg px-2.5 py-1.5">
            <div className="text-[10px] text-gray-400">{FIELD_LABELS[key]}</div>
            <div className="text-[12px] font-medium text-gray-800 truncate">
              {fr?.value ?? <span className="text-gray-300">—</span>}
            </div>
            {fr?.value != null && (
              <div className="text-[9px] text-gray-400">{fr.source} · {Math.round((fr.confidence ?? 0) * 100)}%</div>
            )}
          </div>
        ))}
      </div>

      {/* Correction toggle + form */}
      {!open ? (
        <button onClick={() => setOpen(true)}
          className="mt-3 inline-flex items-center gap-1.5 text-[12px] text-blue-700 hover:text-blue-800 font-semibold cursor-pointer bg-transparent border-none font-sans">
          <Wrench size={12} /> Засах
        </button>
      ) : (
        <div className="mt-3 pt-3 border-t border-gray-100">
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] text-gray-400 uppercase tracking-wider">Талбар</span>
              <select value={field} onChange={(e) => setField(e.target.value as CorrectableField)}
                className="bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-2 text-[16px] md:text-[13px] focus:border-blue-500 focus:bg-white outline-none font-sans cursor-pointer">
                {(Object.keys(FIELD_LABELS) as CorrectableField[]).map((f) => (
                  <option key={f} value={f}>{FIELD_LABELS[f]}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 flex-1 min-w-[140px]">
              <span className="text-[10px] text-gray-400 uppercase tracking-wider">Зөв утга</span>
              <input value={newValue} onChange={(e) => setNewValue(e.target.value)}
                placeholder={field === "partType" ? "жнь: Headlight" : "зөв утга"}
                className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-[16px] md:text-[13px] focus:border-blue-500 focus:bg-white outline-none" />
            </label>
            <label className="flex flex-col gap-1 flex-1 min-w-[140px]">
              <span className="text-[10px] text-gray-400 uppercase tracking-wider">
                Толь бичигт зааx үг {field !== "partType" && "(зөвхөн эд ангид)"}
              </span>
              <input value={rawToken} onChange={(e) => setRawToken(e.target.value)}
                placeholder="жнь: gerel"
                disabled={field !== "partType"}
                className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-[16px] md:text-[13px] focus:border-blue-500 focus:bg-white outline-none disabled:opacity-50" />
            </label>
            <button onClick={submit} disabled={busy}
              className="inline-flex items-center justify-center gap-1.5 bg-blue-700 hover:bg-blue-800 disabled:bg-blue-300 text-white rounded-lg px-4 py-2 text-[13px] font-semibold cursor-pointer border-none transition-colors font-sans">
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Хадгалах
            </button>
            <button onClick={() => { setOpen(false); setRowErr(""); }}
              className="text-[12px] text-gray-400 hover:text-gray-600 cursor-pointer bg-transparent border-none font-sans px-2 py-2">
              Болих
            </button>
          </div>
          {rowErr && <div className="text-[11px] text-red-500 mt-1.5">{rowErr}</div>}
          {field === "partType" && (
            <p className="text-[10px] text-gray-400 mt-1.5">
              Зөв утга нь каталогийн эд ангитай яг таарвал холбоно. &ldquo;Толь бичигт заах үг&rdquo;-ийг бөглөвөл цаашид
              ижил үг автоматаар танигдана.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
