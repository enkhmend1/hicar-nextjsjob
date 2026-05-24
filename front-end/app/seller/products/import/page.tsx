"use client";
/**
 * Seller bulk-import wizard.
 *
 * 3 steps:
 *   1. SOURCE       — upload .csv/.xlsx OR paste rows OR OCR a label image
 *   2. PREVIEW      — review AI-enriched rows in an editable table
 *   3. COMMIT       — confirm + write to DB; show result summary
 *
 * Data flow:
 *   parsed rows  →  /api/seller/import/enrich-bulk  →  enriched preview
 *                                                       │
 *                                          edit in-place│
 *                                                       ▼
 *                  /api/seller/import/commit  →  Product docs (status=pending)
 */

import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import {
  Upload, FileSpreadsheet, ScanLine, ArrowLeft, ArrowRight, Loader2,
  CheckCircle2, AlertTriangle, Pencil, Trash2, Plus, X, Sparkles, ImagePlus,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────
interface RawRow {
  raw_name:   string;
  input_code: string;
  brand:      string;
  price:      number;
  stock:      number;
  location:   string;
}

interface CompatVehicle { make: string; model: string; chassis?: string; engine?: string; years?: string }

/** Per-row action verb sent to /commit-v2 (Phase D). */
type RowAction = "create" | "merge_stock" | "overwrite_all" | "skip" | "review";

interface OcrFix {
  original:       string;
  corrected:      string;
  confidence:     number;
  brand:          string | null;
  edits:          number;
  requiresReview: boolean;
  rule:           "exact" | "substituted" | "unmatched";
}

interface RowConflict {
  existingId:       string;
  existingName:     string;
  existingPrice:    number;
  existingStock:    number;
  existingStatus:   string;
  incomingPrice:    number;
  incomingStock:    number;
  priceDelta:       number;
  priceDeltaPct:    number | null;
  stockDelta:       number;
  suggestedAction:  RowAction;
}

interface EnrichedRow {
  cleaned_oem_code:    string;
  cleaned_part_number: string;
  brand:               string;
  raw_input_code?:     string;
  raw_name?:           string;
  price:               number;
  stock:               number;
  location:            string;
  standard_category:   string;
  display_name_mn:     string;
  display_name_en:     string;
  condition_grade:     "OEM" | "Premium Aftermarket" | "Standard Aftermarket";
  compatible_vehicles: CompatVehicle[];
  confidence?:         number;
  _meta?: { enriched_by: string; warnings: string[] };

  // Phase D — preview decorations from /seller/import/preview.
  // Present when the row came through the new pipeline; legacy
  // /enrich-bulk responses leave these undefined and the wizard
  // degrades gracefully.
  ocrFix?:         OcrFix;
  conflict?:       RowConflict | null;
  requiresReview?: boolean;
  action?:         RowAction;
}

interface PreviewSummary {
  total:               number;
  newCount:            number;
  conflictCount:       number;
  reviewCount:         number;
  lowConfidenceCount:  number;
}

const GRADE_COLOR: Record<string, string> = {
  "OEM":                  "bg-emerald-100 text-emerald-700 border-emerald-200",
  "Premium Aftermarket":  "bg-blue-100 text-blue-700 border-blue-200",
  "Standard Aftermarket": "bg-gray-100 text-gray-700 border-gray-200",
};
const SOURCE_COLOR: Record<string, string> = {
  llm:      "bg-emerald-50 text-emerald-700",
  cache:    "bg-blue-50 text-blue-700",
  fallback: "bg-amber-50 text-amber-700",
  error:    "bg-red-50 text-red-700",
};

const EMPTY_ROW: RawRow = { raw_name: "", input_code: "", brand: "", price: 0, stock: 0, location: "" };

type Step = "source" | "preview" | "result";

export default function ImportWizardPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("source");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // ── Source state ──
  const [rawRows, setRawRows] = useState<RawRow[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const ocrInputRef = useRef<HTMLInputElement>(null);
  const [ocrPreview, setOcrPreview] = useState<string | null>(null);

  // ── Preview state ──
  const [enrichedRows, setEnrichedRows] = useState<EnrichedRow[]>([]);
  const [enrichProgress, setEnrichProgress] = useState<{ done: number; total: number } | null>(null);
  const [onDuplicate, setOnDuplicate] = useState<"skip" | "update">("skip");
  /** Phase D — summary of new vs conflict vs low-confidence rows. */
  const [previewSummary, setPreviewSummary] = useState<PreviewSummary | null>(null);

  // ── Result state ──
  const [result, setResult] = useState<null | {
    created: number; updated: number; skipped: number; failed: number;
    total: number; createdIds: string[]; failures: { row: string; error: string }[];
  }>(null);

  // ── Derived stats for preview header ──
  const stats = useMemo(() => {
    const total = enrichedRows.length;
    const withWarn = enrichedRows.filter((r) => (r._meta?.warnings || []).length > 0).length;
    const grades = enrichedRows.reduce((m, r) => {
      m[r.condition_grade] = (m[r.condition_grade] || 0) + 1;
      return m;
    }, {} as Record<string, number>);
    return { total, withWarn, grades };
  }, [enrichedRows]);

  // ── Source step handlers ──────────────────────────────────────────
  const onFile = async (f: File | null) => {
    if (!f) return;
    setBusy(true); setErr("");
    try {
      const fd = new FormData();
      fd.append("file", f);
      const BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5001/api";
      const token = (typeof window !== "undefined" && localStorage.getItem("hicar-token")) || "";
      const res = await fetch(`${BASE}/seller/import/parse`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        credentials: "include",
        body: fd,
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.message || `HTTP ${res.status}`);
      setRawRows(j.rows || []);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onOcr = async (f: File | null) => {
    if (!f) return;
    setBusy(true); setErr("");
    try {
      // 1. upload to Cloudinary/local via existing upload endpoint
      const { url } = await api.uploadImage(f);
      setOcrPreview(url);
      // 2. ask OCR endpoint to extract + enrich
      const r = await api.post<{ ocr: { raw_name: string; input_code: string; brand?: string }; enriched: EnrichedRow }>("/seller/import/ocr", { imageUrl: url });
      // 3. add OCR'd row to raw list (so user can edit before enriching the rest)
      setRawRows((prev) => [
        ...prev,
        {
          raw_name:   r.ocr.raw_name || "",
          input_code: r.ocr.input_code || "",
          brand:      r.ocr.brand || "",
          price:      0,
          stock:      1,
          location:   "",
        },
      ]);
    } catch (e) {
      const ae = e as ApiError;
      setErr(ae.message);
    } finally {
      setBusy(false);
    }
  };

  const addEmptyRow = () => setRawRows((p) => [...p, { ...EMPTY_ROW }]);
  const updateRaw = (i: number, patch: Partial<RawRow>) =>
    setRawRows((p) => p.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const removeRaw = (i: number) => setRawRows((p) => p.filter((_, idx) => idx !== i));

  // ── Preview (Source → Preview) — Phase D conflict-aware pipeline ──
  // Calls /seller/import/preview which: (1) fuzzy-corrects each OEM
  // via ocrFuzzy.service, (2) runs the LLM enricher, (3) detects
  // OEM conflicts with this seller's existing catalogue. Each row
  // arrives back with .ocrFix, .conflict, .confidence and a
  // suggested .action verb that the user can override in Step 2.
  const runEnrich = async () => {
    const valid = rawRows.filter((r) => r.raw_name?.trim() || r.input_code?.trim());
    if (valid.length === 0) { setErr("Дор хаяж нэг мөр оруулна уу"); return; }
    setBusy(true); setErr(""); setEnrichProgress({ done: 0, total: valid.length });
    try {
      const r = await api.post<{ rows: EnrichedRow[]; summary: PreviewSummary }>(
        "/seller/import/preview",
        { rows: valid },
      );
      setEnrichedRows(r.rows || []);
      setPreviewSummary(r.summary || null);
      setStep("preview");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
      setEnrichProgress(null);
    }
  };

  // ── Preview edit ──────────────────────────────────────────────────
  const updateEnriched = (i: number, patch: Partial<EnrichedRow>) =>
    setEnrichedRows((p) => p.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const removeEnriched = (i: number) =>
    setEnrichedRows((p) => p.filter((_, idx) => idx !== i));

  // ── Bulk-action helpers (Phase D) ─────────────────────────────────
  // Apply the same `action` verb to every row that currently has a
  // conflict — saves the seller from clicking each dropdown when they
  // already know "I want to merge everything" or "overwrite all".
  const bulkApplyToConflicts = (action: RowAction) => {
    setEnrichedRows((rows) =>
      rows.map((r) => (r.conflict ? { ...r, action } : r)),
    );
  };

  // ── Commit (Preview → Result) — Phase D commit-v2 with per-row verbs ──
  // Each row carries its own .action ("create" | "merge_stock" |
  // "overwrite_all" | "skip"). The backend dispatches per row and
  // returns a structured outcomes[] array we surface below.
  const runCommit = async () => {
    if (enrichedRows.length === 0) return;
    // Guard: forbid commit while any row is still flagged "review".
    const reviewing = enrichedRows.filter((r) => r.action === "review").length;
    if (reviewing > 0) {
      setErr(`${reviewing} мөр шийдвэр хүлээж байна — action талбарыг өөрчилнө үү.`);
      return;
    }
    setBusy(true); setErr("");
    try {
      const r = await api.post<typeof result>("/seller/import/commit-v2", {
        rows: enrichedRows.map((row) => ({
          ...row,
          // Default to "create" for rows without an explicit action
          // (e.g. legacy enriched rows that bypassed /preview).
          action: row.action || (row.conflict ? "skip" : "create"),
        })),
      });
      setResult(r);
      setStep("result");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-[22px] font-semibold text-gray-900 flex items-center gap-2">
            <Sparkles size={20} className="text-amber-500" /> AI Bulk Import
          </h1>
          <p className="text-[13px] text-gray-500 mt-0.5">
            Excel/CSV эсвэл зургаар оруулж, AI-аар цэвэрлэгдсэн бараагаа dataset-руу нэгтгэнэ
          </p>
        </div>
        <Link href="/seller/products" className="text-[12px] text-blue-600 hover:underline">
          ← Бараа жагсаалт руу буцах
        </Link>
      </header>

      {/* Stepper */}
      <Stepper step={step} />

      {err && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-[13px] rounded-xl p-3 flex items-start gap-2">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" /> {err}
        </div>
      )}

      {/* ── SOURCE ─────────────────────────────────────────────────── */}
      {step === "source" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <SourceCard
              icon={FileSpreadsheet} color="emerald"
              title="Excel / CSV upload"
              body=".xlsx эсвэл .csv файл сонгож олныг нь оруулна. Headers: name, code, brand, price, stock, location."
              onClick={() => fileInputRef.current?.click()}
            />
            <SourceCard
              icon={ScanLine} color="blue"
              title="Зураг / Barcode (OCR)"
              body="Баглааны зургийг авч AI таних. OEM код + нэрийг автоматаар уншина (OpenAI key шаардана)."
              onClick={() => ocrInputRef.current?.click()}
            />
            <SourceCard
              icon={Plus} color="amber"
              title="Гараар оруулах"
              body="Нэг бараа нэмж туршихад тохиромжтой. Доорх хүснэгтэд шууд нэмнэ."
              onClick={addEmptyRow}
            />
          </div>
          <input ref={fileInputRef}  type="file" hidden accept=".csv,.xlsx,.xls" onChange={(e) => onFile(e.target.files?.[0] || null)} />
          <input ref={ocrInputRef}   type="file" hidden accept="image/*"          onChange={(e) => onOcr(e.target.files?.[0] || null)} />

          {ocrPreview && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 flex items-center gap-3">
              <div className="relative w-16 h-16 rounded-lg overflow-hidden bg-white shrink-0">
                <Image src={ocrPreview} alt="OCR" fill sizes="64px" className="object-cover" unoptimized />
              </div>
              <div className="text-[12px] text-blue-700">
                ✓ Зургийг танисан. Доорх жагсаалтад нэмэгдсэн — шалгаад үргэлжлүүлээрэй.
              </div>
            </div>
          )}

          {rawRows.length > 0 && (
            <>
              <header className="flex items-center justify-between mt-3">
                <h2 className="text-[14px] font-semibold text-gray-900">Оруулсан мөрүүд ({rawRows.length})</h2>
                <button onClick={addEmptyRow} disabled={busy}
                  className="inline-flex items-center gap-1 text-[12px] border border-gray-200 hover:border-blue-400 rounded-lg px-3 py-1.5 cursor-pointer bg-white transition-colors disabled:opacity-50 font-sans">
                  <Plus size={12} /> Мөр нэмэх
                </button>
              </header>
              <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200 text-gray-500">
                        <th className="text-left px-3 py-2 font-medium">Нэр</th>
                        <th className="text-left px-3 py-2 font-medium">OEM код</th>
                        <th className="text-left px-3 py-2 font-medium">Брэнд</th>
                        <th className="text-right px-3 py-2 font-medium">Үнэ</th>
                        <th className="text-right px-3 py-2 font-medium">Тоо</th>
                        <th className="text-left px-3 py-2 font-medium">Байршил</th>
                        <th className="px-3 py-2 w-8"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {rawRows.map((r, i) => (
                        <tr key={i} className="border-b border-gray-100 last:border-0">
                          <td className="px-2 py-1"><InputCell value={r.raw_name}   onChange={(v) => updateRaw(i, { raw_name: v })} /></td>
                          <td className="px-2 py-1"><InputCell value={r.input_code} onChange={(v) => updateRaw(i, { input_code: v })} mono /></td>
                          <td className="px-2 py-1"><InputCell value={r.brand}      onChange={(v) => updateRaw(i, { brand: v })} /></td>
                          <td className="px-2 py-1"><InputCell type="number" value={String(r.price)} onChange={(v) => updateRaw(i, { price: Number(v) || 0 })} align="right" /></td>
                          <td className="px-2 py-1"><InputCell type="number" value={String(r.stock)} onChange={(v) => updateRaw(i, { stock: Number(v) || 0 })} align="right" /></td>
                          <td className="px-2 py-1"><InputCell value={r.location} onChange={(v) => updateRaw(i, { location: v })} /></td>
                          <td className="px-1 py-1 text-center">
                            <button onClick={() => removeRaw(i)} className="text-gray-300 hover:text-red-500 cursor-pointer bg-transparent border-none">
                              <Trash2 size={11} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex justify-end">
                <button onClick={runEnrich} disabled={busy || rawRows.length === 0}
                  className="inline-flex items-center gap-2 bg-gradient-to-r from-blue-600 to-amber-600 hover:from-blue-700 hover:to-amber-700 disabled:from-gray-300 disabled:to-gray-400 text-white rounded-xl px-5 py-2.5 text-[13px] font-semibold cursor-pointer border-none transition-all font-sans">
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                  AI-аар цэвэрлэх ({rawRows.length}) <ArrowRight size={13} />
                </button>
              </div>
              {enrichProgress && (
                <p className="text-[11px] text-gray-400 text-right">{enrichProgress.done}/{enrichProgress.total} боловсруулагдсан…</p>
              )}
            </>
          )}
        </div>
      )}

      {/* ── PREVIEW ────────────────────────────────────────────────── */}
      {step === "preview" && (
        <div className="space-y-3">
          <div className="bg-blue-50/40 border border-blue-100 rounded-xl px-4 py-3 flex flex-wrap items-center gap-3 text-[12px]">
            <span className="font-semibold text-gray-700">{stats.total} мөр AI-аар цэвэрлэгдлээ</span>
            {Object.entries(stats.grades).map(([g, c]) => (
              <span key={g} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border ${GRADE_COLOR[g] ?? ""}`}>
                {g}: {c}
              </span>
            ))}
            {stats.withWarn > 0 && (
              <span className="inline-flex items-center gap-1 text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                <AlertTriangle size={10} /> {stats.withWarn} мөрд анхааруулга
              </span>
            )}
          </div>

          {/* Phase D — conflict / confidence summary + bulk-action toolbar.
              Shows when /preview returned its conflict-aware shape. */}
          {previewSummary && previewSummary.conflictCount + previewSummary.lowConfidenceCount > 0 && (
            <div className="bg-amber-50/60 border border-amber-200 rounded-xl px-4 py-3 flex flex-wrap items-center gap-3 text-[12px]">
              <span className="font-semibold text-amber-900 flex items-center gap-1.5">
                <AlertTriangle size={12} /> Анхаарал хандуулах хэрэгтэй
              </span>
              {previewSummary.newCount > 0 && (
                <span className="bg-emerald-100 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full">
                  ✓ {previewSummary.newCount} шинэ
                </span>
              )}
              {previewSummary.conflictCount > 0 && (
                <span className="bg-orange-100 text-orange-700 border border-orange-200 px-2 py-0.5 rounded-full">
                  ⚠ {previewSummary.conflictCount} мөнхийн OEM
                </span>
              )}
              {previewSummary.lowConfidenceCount > 0 && (
                <span className="bg-yellow-100 text-yellow-700 border border-yellow-200 px-2 py-0.5 rounded-full">
                  ◎ {previewSummary.lowConfidenceCount} итгэл бага
                </span>
              )}
              {previewSummary.conflictCount > 0 && (
                <div className="ml-auto flex items-center gap-1.5">
                  <span className="text-amber-800 mr-1">Бүгдэд хийх:</span>
                  <button onClick={() => bulkApplyToConflicts("merge_stock")}
                    className="text-[11px] px-2 py-1 rounded border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 cursor-pointer transition-colors">
                    Нөөц нэгтгэх
                  </button>
                  <button onClick={() => bulkApplyToConflicts("overwrite_all")}
                    className="text-[11px] px-2 py-1 rounded border border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100 cursor-pointer transition-colors">
                    Дарж бичих
                  </button>
                  <button onClick={() => bulkApplyToConflicts("skip")}
                    className="text-[11px] px-2 py-1 rounded border border-gray-300 bg-gray-50 text-gray-700 hover:bg-gray-100 cursor-pointer transition-colors">
                    Алгасах
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-gray-500">
                    <th className="text-left px-3 py-2 font-medium">OEM</th>
                    <th className="text-left px-3 py-2 font-medium">Нэр (MN / EN)</th>
                    <th className="text-left px-3 py-2 font-medium">Ангилал</th>
                    <th className="text-left px-3 py-2 font-medium">Брэнд</th>
                    <th className="text-center px-3 py-2 font-medium">Чанар</th>
                    <th className="text-center px-3 py-2 font-medium">Тохирох</th>
                    <th className="text-right px-3 py-2 font-medium">Үнэ</th>
                    <th className="text-right px-3 py-2 font-medium">Тоо</th>
                    <th className="text-center px-3 py-2 font-medium">AI</th>
                    {/* Phase D — action / conflict column. Hidden when no
                        row has /preview decorations (legacy path). */}
                    <th className="text-center px-3 py-2 font-medium">Үйлдэл</th>
                    <th className="px-3 py-2 w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {enrichedRows.map((r, i) => {
                    const hasWarn = (r._meta?.warnings || []).length > 0;
                    // Phase D — pick the dominant row state for highlighting.
                    // Priority: conflict (orange) > low confidence (yellow) >
                    // legacy warning (amber) > clean (default).
                    const rowClass = r.conflict
                      ? "bg-orange-50/60"
                      : (r.confidence !== undefined && r.confidence < 0.70)
                        ? "bg-yellow-50/60"
                        : hasWarn
                          ? "bg-amber-50/40"
                          : "";
                    return (
                      <tr key={i} className={`border-b border-gray-100 last:border-0 ${rowClass}`}>
                        <td className="px-2 py-1 font-mono text-[11px] text-gray-700">
                          {r.cleaned_oem_code || "—"}
                          {/* OCR self-correction hint when a substitution was applied. */}
                          {r.ocrFix && r.ocrFix.rule === "substituted" && r.ocrFix.original !== r.ocrFix.corrected && (
                            <div className="text-[9px] text-amber-600 font-normal mt-0.5" title={`OCR засвар: ${r.ocrFix.original} → ${r.ocrFix.corrected}`}>
                              OCR: {r.ocrFix.original} → ✓
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-1">
                          <InputCell value={r.display_name_mn} onChange={(v) => updateEnriched(i, { display_name_mn: v })} />
                          <div className="text-[10px] text-gray-400 mt-0.5 italic">{r.display_name_en}</div>
                        </td>
                        <td className="px-2 py-1 text-gray-600 font-mono text-[10px]">{r.standard_category || "—"}</td>
                        <td className="px-2 py-1 text-gray-700">{r.brand}</td>
                        <td className="px-2 py-1 text-center">
                          <select value={r.condition_grade}
                            onChange={(e) => updateEnriched(i, { condition_grade: e.target.value as EnrichedRow["condition_grade"] })}
                            className={`text-[10px] px-1.5 py-0.5 rounded-full border outline-none cursor-pointer font-sans ${GRADE_COLOR[r.condition_grade]}`}>
                            <option value="OEM">OEM</option>
                            <option value="Premium Aftermarket">Premium</option>
                            <option value="Standard Aftermarket">Standard</option>
                          </select>
                        </td>
                        <td className="px-2 py-1 text-center">
                          {r.compatible_vehicles.length > 0 ? (
                            <span className="text-[10px] bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded-full" title={r.compatible_vehicles.map(v => `${v.make} ${v.model} ${v.chassis ?? ""}`).join(", ")}>
                              {r.compatible_vehicles.length} fitments
                            </span>
                          ) : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-2 py-1"><InputCell type="number" value={String(r.price)} onChange={(v) => updateEnriched(i, { price: Number(v) || 0 })} align="right" /></td>
                        <td className="px-2 py-1"><InputCell type="number" value={String(r.stock)} onChange={(v) => updateEnriched(i, { stock: Number(v) || 0 })} align="right" /></td>
                        <td className="px-2 py-1 text-center">
                          <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${SOURCE_COLOR[r._meta?.enriched_by || ""] ?? "bg-gray-100 text-gray-600"}`} title={(r._meta?.warnings || []).join(", ")}>
                            {r._meta?.enriched_by ?? "?"}
                          </span>
                        </td>
                        {/* Phase D — per-row action selector.
                            Conflict rows get the dropdown; new rows just
                            show a green "Үүсгэх" badge. Confidence < 70%
                            puts a tiny yellow ring around the badge. */}
                        <td className="px-2 py-1 text-center">
                          {r.conflict ? (
                            <div className="flex flex-col items-center gap-0.5">
                              <select value={r.action || "merge_stock"}
                                onChange={(e) => updateEnriched(i, { action: e.target.value as RowAction })}
                                className={`text-[10px] px-1.5 py-0.5 rounded border outline-none cursor-pointer font-sans ${
                                  r.action === "overwrite_all" ? "bg-rose-50 text-rose-700 border-rose-200"
                                  : r.action === "merge_stock" ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                  : r.action === "skip"        ? "bg-gray-50 text-gray-600 border-gray-200"
                                  : r.action === "review"      ? "bg-amber-50 text-amber-700 border-amber-300 animate-pulse"
                                  : "bg-blue-50 text-blue-700 border-blue-200"
                                }`}>
                                <option value="merge_stock">Нэгтгэх (+нөөц)</option>
                                <option value="overwrite_all">Дарж бичих</option>
                                <option value="skip">Алгасах</option>
                                <option value="review">Шийдвэр хүлээ</option>
                              </select>
                              <span className="text-[9px] text-gray-500 font-mono" title={`Хуучин: ₮${r.conflict.existingPrice.toLocaleString()} → Шинэ: ₮${r.conflict.incomingPrice.toLocaleString()}`}>
                                Δ {r.conflict.priceDeltaPct !== null ? `${r.conflict.priceDeltaPct > 0 ? "+" : ""}${r.conflict.priceDeltaPct}%` : "—"}
                              </span>
                            </div>
                          ) : (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-emerald-50 text-emerald-700 border ${
                              r.confidence !== undefined && r.confidence < 0.70 ? "border-yellow-400 ring-1 ring-yellow-200" : "border-emerald-200"
                            }`}>
                              ✓ Үүсгэх
                            </span>
                          )}
                        </td>
                        <td className="px-1 py-1 text-center">
                          <button onClick={() => removeEnriched(i)} className="text-gray-300 hover:text-red-500 cursor-pointer bg-transparent border-none">
                            <Trash2 size={11} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-2xl p-4 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3 text-[12px] text-gray-600">
              <span>Давхардсан OEM-той бараа байвал:</span>
              <label className="inline-flex items-center gap-1 cursor-pointer">
                <input type="radio" name="dupe" value="skip" checked={onDuplicate === "skip"} onChange={() => setOnDuplicate("skip")} className="accent-blue-600 w-3 h-3" />
                Алгасах
              </label>
              <label className="inline-flex items-center gap-1 cursor-pointer">
                <input type="radio" name="dupe" value="update" checked={onDuplicate === "update"} onChange={() => setOnDuplicate("update")} className="accent-blue-600 w-3 h-3" />
                Шинэчлэх
              </label>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setStep("source")} disabled={busy}
                className="inline-flex items-center gap-1 border border-gray-200 hover:border-blue-400 rounded-xl px-4 py-2 text-[12px] text-gray-600 cursor-pointer bg-white transition-colors disabled:opacity-50 font-sans">
                <ArrowLeft size={12} /> Буцах
              </button>
              <button onClick={runCommit} disabled={busy || enrichedRows.length === 0}
                className="inline-flex items-center gap-2 bg-gradient-to-r from-blue-600 to-amber-600 hover:from-blue-700 hover:to-amber-700 disabled:from-gray-300 disabled:to-gray-400 text-white rounded-xl px-5 py-2 text-[13px] font-semibold cursor-pointer border-none transition-all font-sans">
                {busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                Хадгалах ({enrichedRows.length})
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── RESULT ─────────────────────────────────────────────────── */}
      {step === "result" && result && (
        <div className="space-y-4">
          <div className="bg-gradient-to-br from-blue-500 to-amber-500 text-white rounded-3xl p-6">
            <div className="text-[14px] opacity-80 mb-1">Импорт амжилттай</div>
            <div className="text-[40px] font-bold tabular-nums">{result.created + result.updated}</div>
            <div className="text-[13px] opacity-80">{result.total} мөрөөс</div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <ResultStat label="Шинээр үүсгэсэн" value={result.created} tone="emerald" />
            <ResultStat label="Шинэчилсэн"      value={result.updated} tone="blue"    />
            <ResultStat label="Алгасасан"        value={result.skipped} tone="gray"   />
            <ResultStat label="Алдаатай"         value={result.failed}  tone="red"    />
          </div>

          {result.failures.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-2xl p-4">
              <h3 className="text-[13px] font-semibold text-gray-900 mb-2">Алдаатай мөрүүд</h3>
              <ul className="text-[11px] text-gray-700 space-y-1">
                {result.failures.map((f, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <X size={11} className="text-red-500 mt-0.5 shrink-0" />
                    <span className="font-mono">{f.row}</span>
                    <span className="text-red-600">— {f.error}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex gap-2">
            <button onClick={() => { setStep("source"); setRawRows([]); setEnrichedRows([]); setResult(null); }}
              className="border border-gray-200 hover:border-blue-400 rounded-xl px-4 py-2 text-[12px] text-gray-600 cursor-pointer bg-white transition-colors font-sans">
              Дахин импортлох
            </button>
            <button onClick={() => router.push("/seller/products")}
              className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl px-5 py-2 text-[13px] font-semibold cursor-pointer border-none transition-colors font-sans">
              Барааны жагсаалт руу очих
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Reusable bits ─────────────────────────────────────────────────────
function Stepper({ step }: { step: Step }) {
  const steps: { id: Step; label: string }[] = [
    { id: "source",  label: "1. Эх сурвалж" },
    { id: "preview", label: "2. Урьдчилан харах" },
    { id: "result",  label: "3. Үр дүн" },
  ];
  const idx = steps.findIndex((s) => s.id === step);
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {steps.map((s, i) => (
        <div key={s.id} className="flex items-center gap-2">
          <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${
            i < idx ? "bg-emerald-500 text-white" : i === idx ? "bg-blue-600 text-white" : "bg-gray-200 text-gray-500"
          }`}>
            {i < idx ? <CheckCircle2 size={13} /> : i + 1}
          </div>
          <span className={`text-[12px] font-medium ${i === idx ? "text-blue-700" : "text-gray-500"}`}>{s.label}</span>
          {i < steps.length - 1 && <div className={`w-8 h-0.5 ${i < idx ? "bg-emerald-400" : "bg-gray-200"}`} />}
        </div>
      ))}
    </div>
  );
}

function SourceCard({ icon: Icon, color, title, body, onClick }: {
  icon: typeof Upload; color: "emerald" | "blue" | "amber"; title: string; body: string; onClick: () => void;
}) {
  const cls = {
    emerald: "bg-emerald-50 text-emerald-600 hover:bg-emerald-100",
    blue:  "bg-blue-50 text-blue-600 hover:bg-blue-100",
    amber: "bg-amber-50 text-amber-600 hover:bg-amber-100",
  }[color];
  return (
    <button onClick={onClick}
      className="text-left bg-white border border-gray-200 hover:border-blue-300 rounded-2xl p-4 cursor-pointer transition-all hover:shadow-md">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${cls}`}>
        <Icon size={18} />
      </div>
      <div className="text-[14px] font-semibold text-gray-900 mb-1">{title}</div>
      <p className="text-[11px] text-gray-500 leading-relaxed">{body}</p>
    </button>
  );
}

function InputCell({ value, onChange, mono, type = "text", align = "left" }: {
  value: string; onChange: (v: string) => void; mono?: boolean; type?: string; align?: "left" | "right";
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full bg-transparent border border-transparent hover:border-gray-200 focus:border-blue-500 focus:bg-white rounded px-1.5 py-1 text-[12px] outline-none transition-colors ${mono ? "font-mono text-[11px]" : ""}`}
      style={{ textAlign: align }}
    />
  );
}

function ResultStat({ label, value, tone }: { label: string; value: number; tone: "emerald" | "blue" | "gray" | "red" }) {
  const cls = {
    emerald: "bg-emerald-50 text-emerald-700",
    blue:    "bg-blue-50 text-blue-700",
    gray:    "bg-gray-50 text-gray-600",
    red:     "bg-red-50 text-red-700",
  }[tone];
  return (
    <div className={`rounded-xl p-3 ${cls}`}>
      <div className="text-[20px] font-bold tabular-nums">{value}</div>
      <div className="text-[10px] opacity-80">{label}</div>
    </div>
  );
}
