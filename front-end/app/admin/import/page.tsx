"use client";

/**
 * Admin — Data Platform: bulk import wizard (M1 raw ingestion).
 *
 * Uploads a CSV/Excel file to the data platform, which streams every row into
 * the immutable raw_products store and enqueues normalization. The page then
 * polls the import job and shows live progress + per-row errors.
 *
 * Upload is multipart/form-data → posted straight to the /api/dp proxy (which
 * now forwards multipart bodies); progress polling uses the JSON dpApi client.
 */

import { useEffect, useRef, useState } from "react";
import { useAuthStore } from "@/store";
import { dpApi } from "@/app/lib/dpApi";
import {
  UploadCloud, FileSpreadsheet, Loader2, CheckCircle2, AlertTriangle,
  RotateCcw, Database, Sparkles, Copy, MinusCircle, X,
} from "lucide-react";

interface ImportJob {
  _id: string;
  filename: string;
  source: "csv" | "excel";
  totalRows: number;
  processed: number;
  failed: number;
  /** Rows whose content already existed (idempotent re-import). */
  duplicateCount: number;
  /** Rows skipped because their title was empty. */
  skippedCount: number;
  /** True when AI remapped at least one unrecognized column header. */
  aiHeadersApplied: boolean;
  status: "queued" | "parsing" | "ingesting" | "done" | "failed";
  errors: { row: number; reason: string }[];
  finishedAt?: string;
}

const STATUS_LABEL: Record<ImportJob["status"], string> = {
  queued: "Дараалалд",
  parsing: "Уншиж байна",
  ingesting: "Хадгалж байна",
  done: "Дууссан",
  failed: "Амжилтгүй",
};
const STATUS_BADGE: Record<ImportJob["status"], string> = {
  queued: "bg-gray-100 text-gray-600 border-gray-200",
  parsing: "bg-blue-50 text-blue-700 border-blue-200",
  ingesting: "bg-blue-50 text-blue-700 border-blue-200",
  done: "bg-emerald-50 text-emerald-700 border-emerald-200",
  failed: "bg-red-50 text-red-600 border-red-200",
};
const OBJECT_ID_RE = /^[a-f\d]{24}$/i;

export default function ImportWizardPage() {
  const { user } = useAuthStore();
  const adminId = (user?._id ?? user?.id ?? "") as string;

  const [file, setFile] = useState<File | null>(null);
  const [sellerId, setSellerId] = useState("");
  const [uploading, setUploading] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<ImportJob | null>(null);
  const [err, setErr] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // Prefill sellerId with the admin's own id as a convenience (editable).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (adminId && !sellerId) setSellerId(adminId);
  }, [adminId, sellerId]);

  // Poll the job until it finishes.
  useEffect(() => {
    if (!jobId) return;
    if (job && (job.status === "done" || job.status === "failed")) return;
    const t = setInterval(async () => {
      try {
        const r = await dpApi.get<{ job: ImportJob }>(`ingest/import/${jobId}`);
        setJob(r.job);
      } catch (e) {
        setErr((e as Error).message);
      }
    }, 1500);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, job?.status]);

  const pickFile = (f: File | null) => {
    setErr("");
    if (!f) return;
    if (!/\.(csv|xlsx|xls)$/i.test(f.name)) { setErr("Зөвхөн .csv / .xlsx / .xls файл"); return; }
    if (f.size > 25 * 1024 * 1024) { setErr("Файл 25MB-аас хэтэрсэн"); return; }
    setFile(f);
  };

  const upload = async () => {
    if (!file) { setErr("Файл сонгоно уу"); return; }
    if (!OBJECT_ID_RE.test(sellerId)) { setErr("sellerId буруу (24 тэмдэгт ObjectId)"); return; }
    setUploading(true); setErr(""); setJob(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("sellerId", sellerId);
      const token = useAuthStore.getState().token;
      // multipart — let the browser set content-type (boundary); proxy forwards it.
      const res = await fetch("/api/dp/ingest/import", {
        method: "POST",
        body: fd,
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || `Импорт амжилтгүй (${res.status})`);
      setJobId(data.jobId as string);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const reset = () => { setFile(null); setJobId(null); setJob(null); setErr(""); if (fileRef.current) fileRef.current.value = ""; };

  const pct = job && job.totalRows > 0
    ? Math.min(100, Math.round(((job.processed + job.failed) / job.totalRows) * 100))
    : 0;
  const active = Boolean(jobId) && job?.status !== "done" && job?.status !== "failed";

  return (
    <div className="space-y-5 max-w-3xl">
      <header>
        <h1 className="text-[22px] font-semibold text-gray-900 flex items-center gap-2">
          <UploadCloud size={20} className="text-blue-700" /> Импорт (CSV / Excel)
        </h1>
        <p className="text-[13px] text-gray-500 mt-0.5">
          Бөөнөөр бараа оруулах. Мөр бүр өөрчлөгдөшгүй <span className="font-mono">raw_products</span>-д хадгалагдаж,
          нормчлолд автоматаар орно. Толгой мөрийг (англи/кирилл/латин) уян хатан таниулна.
        </p>
      </header>

      {err && (
        <div className="bg-red-50 border border-red-200 text-red-600 text-[12px] rounded-xl px-3 py-2 flex items-center gap-2">
          <AlertTriangle size={14} /> {err}
        </div>
      )}

      {/* ── UPLOAD FORM (hidden once a job is running) ─────────────── */}
      {!jobId && (
        <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-4">
          {/* Drop / pick */}
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); pickFile(e.dataTransfer.files?.[0] ?? null); }}
            onClick={() => fileRef.current?.click()}
            className="border-2 border-dashed border-gray-200 hover:border-blue-400 rounded-xl p-8 text-center cursor-pointer transition-colors"
          >
            {file ? (
              <div className="relative flex flex-col items-center gap-1.5">
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); reset(); }}
                  aria-label="Файл хасах"
                  className="absolute -top-3 -right-3 inline-flex items-center justify-center w-7 h-7 rounded-full bg-white border border-gray-200 text-gray-500 hover:text-red-600 hover:border-red-300 cursor-pointer transition-colors"
                >
                  <X size={15} />
                </button>
                <FileSpreadsheet size={32} className="text-emerald-600" />
                <div className="text-[14px] font-semibold text-gray-900">{file.name}</div>
                <div className="text-[11px] text-gray-400">{(file.size / 1024).toFixed(0)} KB · дарж солих эсвэл ✕-ээр хасах</div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-1.5 text-gray-500">
                <UploadCloud size={32} strokeWidth={1.5} />
                <div className="text-[14px] font-medium">Файлаа энд чирэх эсвэл дарж сонгоно уу</div>
                <div className="text-[11px] text-gray-400">.csv · .xlsx · .xls · max 25MB</div>
              </div>
            )}
            <input ref={fileRef} type="file" hidden
              accept=".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)} />
          </div>

          <div>
            <label className="block text-[12px] font-medium text-gray-700 mb-1.5">
              Зарагчийн ID (sellerId)
            </label>
            <input value={sellerId} onChange={(e) => setSellerId(e.target.value.trim())}
              placeholder="24 тэмдэгт ObjectId"
              className={`w-full bg-gray-50 border rounded-xl px-4 py-2.5 text-[13px] font-mono outline-none transition-colors ${
                sellerId && !OBJECT_ID_RE.test(sellerId) ? "border-red-400" : "border-gray-200 focus:border-blue-500 focus:bg-white"
              }`} />
            <p className="text-[10px] text-gray-400 mt-1">Импортолж буй бараа аль зарагчид хамаарахыг заана. (Туршихад өөрийн ID-г ашиглаж болно.)</p>
          </div>

          <button onClick={upload} disabled={uploading || !file}
            className="w-full sm:w-auto sm:px-8 inline-flex items-center justify-center gap-2 bg-blue-700 hover:bg-blue-800 disabled:bg-blue-300 text-white rounded-xl py-3 text-[14px] font-semibold cursor-pointer border-none transition-colors font-sans">
            {uploading ? <Loader2 size={15} className="animate-spin" /> : <UploadCloud size={15} />}
            {uploading ? "Илгээж байна..." : "Импортлох"}
          </button>
        </div>
      )}

      {/* ── JOB PROGRESS ──────────────────────────────────────────── */}
      {jobId && (
        <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              {active ? <Loader2 size={18} className="animate-spin text-blue-600 shrink-0" />
                : job?.status === "failed" ? <AlertTriangle size={18} className="text-red-500 shrink-0" />
                : <CheckCircle2 size={18} className="text-emerald-600 shrink-0" />}
              <div className="min-w-0">
                <div className="text-[14px] font-semibold text-gray-900 truncate">{job?.filename ?? "Импорт"}</div>
                <div className="text-[11px] text-gray-400 font-mono truncate">job {jobId}</div>
              </div>
            </div>
            {job && (
              <span className={`text-[11px] px-2.5 py-0.5 rounded-full border font-medium shrink-0 ${STATUS_BADGE[job.status]}`}>
                {STATUS_LABEL[job.status]}
              </span>
            )}
          </div>

          {/* Progress bar */}
          <div>
            <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all ${job?.status === "failed" ? "bg-red-400" : "bg-blue-600"} ${active && pct === 0 ? "animate-pulse w-1/3" : ""}`}
                style={pct > 0 ? { width: `${pct}%` } : undefined} />
            </div>
            <div className="flex justify-between text-[11px] text-gray-500 mt-1.5">
              <span>{job ? `${job.processed + job.failed} / ${job.totalRows || "?"} мөр` : "..."}</span>
              <span>{pct > 0 ? `${pct}%` : ""}</span>
            </div>
          </div>

          {/* AI header remap notice */}
          {job?.aiHeadersApplied && (
            <div className="bg-blue-50 border border-blue-200 text-blue-700 text-[12px] rounded-xl px-3 py-2 flex items-center gap-2">
              <Sparkles size={14} className="shrink-0" />
              Танигдаагүй баганын толгойг AI автоматаар тааруулсан. Үр дүнг нормчлолын хэсэгт шалгана уу.
            </div>
          )}

          {/* Counters */}
          <div className="grid grid-cols-3 gap-3">
            <Counter icon={Database} label="Нийт мөр" value={job?.totalRows} />
            <Counter icon={CheckCircle2} label="Амжилттай" value={job?.processed} accent="emerald" />
            <Counter icon={AlertTriangle} label="Алдаатай" value={job?.failed} accent={job && job.failed > 0 ? "red" : undefined} />
          </div>

          {/* Secondary summary — duplicates / skipped (idempotent re-import + empty rows) */}
          {job && (job.duplicateCount > 0 || job.skippedCount > 0) && (
            <div className="flex flex-wrap gap-4 text-[12px] text-gray-500 px-0.5">
              {job.duplicateCount > 0 && (
                <span className="inline-flex items-center gap-1.5">
                  <Copy size={13} className="text-gray-400" />
                  Давхардсан: <span className="font-semibold text-gray-700">{job.duplicateCount}</span>
                </span>
              )}
              {job.skippedCount > 0 && (
                <span className="inline-flex items-center gap-1.5">
                  <MinusCircle size={13} className="text-gray-400" />
                  Алгассан (хоосон гарчиг): <span className="font-semibold text-gray-700">{job.skippedCount}</span>
                </span>
              )}
            </div>
          )}

          {/* Errors */}
          {job && job.errors.length > 0 && (
            <div>
              <div className="text-[12px] font-semibold text-gray-700 mb-1.5">Алдаанууд ({job.errors.length})</div>
              <div className="max-h-48 overflow-y-auto rounded-xl border border-gray-100 divide-y divide-gray-50">
                {job.errors.slice(0, 100).map((e, i) => (
                  <div key={i} className="flex gap-3 px-3 py-1.5 text-[12px]">
                    <span className="text-gray-400 font-mono shrink-0">мөр {e.row}</span>
                    <span className="text-gray-700">{e.reason}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!active && (
            <button onClick={reset}
              className="inline-flex items-center gap-1.5 bg-white border border-gray-200 hover:border-blue-400 rounded-xl px-4 py-2 text-[13px] font-medium text-gray-700 cursor-pointer transition-colors">
              <RotateCcw size={14} /> Шинээр импортлох
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Counter({ icon: Icon, label, value, accent }: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string; value?: number; accent?: "emerald" | "red";
}) {
  const color = accent === "emerald" ? "text-emerald-600" : accent === "red" ? "text-red-500" : "text-gray-400";
  return (
    <div className="bg-gray-50 rounded-xl p-3">
      <div className={`flex items-center gap-1.5 text-[10px] uppercase tracking-wider ${color}`}>
        <Icon size={12} /> {label}
      </div>
      <div className="text-[20px] font-bold text-gray-900 mt-1 leading-none">{value ?? "—"}</div>
    </div>
  );
}
