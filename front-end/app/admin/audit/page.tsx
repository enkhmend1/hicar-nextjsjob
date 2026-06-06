"use client";

/**
 * Admin financial audit log — surfaces the hash-chained ledger
 * (back-end /api/admin/audit) and lets an admin replay-verify its
 * integrity. Read-only; the ledger is append-only by design.
 */

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { ShieldCheck, ShieldAlert, RefreshCw, Loader2 } from "lucide-react";

interface AuditRow {
  _id: string;
  type: string;
  orderId?: string | null;
  sellerId?: string | null;
  buyerId?: string | null;
  disputeId?: string | null;
  actor: string;
  amount: number;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  createdAt: string;
}
interface VerifyResult {
  ok: boolean;
  scanned: number;
  brokenAt?: { _id: string; reason: string; expected: string; actual: string };
}

const TYPE_LABEL: Record<string, string> = {
  payment_settled: "Төлбөр баталгаажсан",
  refund_issued: "Буцаалт олгосон",
  escrow_released: "Escrow шилжсэн",
  trust_score_changed: "Trust өөрчлөлт",
  dispute_resolved: "Маргаан шийдсэн",
  return_penalty_applied: "Буцаалтын торгууль",
};
const TYPE_COLOR: Record<string, string> = {
  payment_settled: "bg-blue-50 text-blue-700 border-blue-200",
  refund_issued: "bg-orange-50 text-orange-700 border-orange-200",
  escrow_released: "bg-emerald-50 text-emerald-700 border-emerald-200",
  trust_score_changed: "bg-gray-50 text-gray-600 border-gray-200",
  dispute_resolved: "bg-indigo-50 text-indigo-700 border-indigo-200",
  return_penalty_applied: "bg-red-50 text-red-700 border-red-200",
};
const TYPES = Object.keys(TYPE_LABEL);

const short = (id?: string | null) => (id ? `#${String(id).slice(-8).toUpperCase()}` : "—");

export default function AdminAuditPage() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [type, setType] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [verify, setVerify] = useState<VerifyResult | null>(null);

  const reload = () => {
    setLoading(true);
    const q = type === "all" ? "?limit=200" : `?limit=200&type=${type}`;
    api.get<{ rows: AuditRow[]; total: number }>(`/admin/audit${q}`)
      .then((d) => { setRows(d.rows); setTotal(d.total); })
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect
  useEffect(() => { queueMicrotask(reload); }, [type]);

  const runVerify = async () => {
    setVerifying(true);
    setVerify(null);
    try {
      const r = await api.get<VerifyResult>("/admin/audit/verify");
      setVerify(r);
    } catch (e) {
      setVerify({ ok: false, scanned: 0, brokenAt: { _id: "", reason: (e as Error).message, expected: "", actual: "" } });
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-[22px] font-semibold text-gray-900">Санхүүгийн лог</h1>
          <p className="text-[13px] text-gray-500">{total} бичлэг · hash-chained, өөрчлөгдөшгүй дэвтэр</p>
        </div>
        <button onClick={runVerify} disabled={verifying}
          className="inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl px-4 py-2 text-[13px] font-medium cursor-pointer border-none disabled:opacity-50 transition-colors">
          {verifying ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          Бүрэн бүтэн байдлыг шалгах
        </button>
      </div>

      {/* Verify result banner */}
      {verify && (
        <div className={`flex items-center gap-2 rounded-xl border p-3 text-[13px] ${
          verify.ok ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                    : "bg-red-50 border-red-200 text-red-800"}`}>
          {verify.ok ? <ShieldCheck size={16} /> : <ShieldAlert size={16} />}
          {verify.ok
            ? `Гинж бүрэн бүтэн — ${verify.scanned} бичлэг шалгагдсан, эвдрэл алга.`
            : `Гинж эвдэрсэн! ${verify.brokenAt?._id ? `Бичлэг ${short(verify.brokenAt._id)} дээр` : ""} (${verify.brokenAt?.reason})`}
        </div>
      )}

      {/* Type filter */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {(["all", ...TYPES]).map((t) => (
          <button key={t} onClick={() => setType(t)}
            className={`shrink-0 px-3 py-1.5 rounded-full text-[12px] font-medium cursor-pointer border transition-all font-sans ${
              type === t ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 border-gray-200 hover:border-blue-400"
            }`}>
            {t === "all" ? "Бүгд" : TYPE_LABEL[t]}
          </button>
        ))}
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-400 text-[13px]">Уншиж байна...</div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-[13px]">Бичлэг алга</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {rows.map((r) => (
              <div key={r._id} className="p-4 flex flex-wrap items-center gap-3">
                <span className={`px-2 py-0.5 rounded-full border text-[11px] font-medium shrink-0 ${TYPE_COLOR[r.type] ?? "bg-gray-50 text-gray-600 border-gray-200"}`}>
                  {TYPE_LABEL[r.type] ?? r.type}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] text-gray-700">
                    Захиалга <span className="font-mono">{short(r.orderId)}</span>
                    {r.sellerId && <> · Худалдагч <span className="font-mono">{short(r.sellerId)}</span></>}
                  </div>
                  <div className="text-[11px] text-gray-400 mt-0.5">
                    {new Date(r.createdAt).toLocaleString("mn-MN")} · {r.actor}
                    {r.before?.paymentStatus != null && r.after?.paymentStatus != null && (
                      <> · {String(r.before.paymentStatus)} → {String(r.after.paymentStatus)}</>
                    )}
                  </div>
                </div>
                {r.amount > 0 && (
                  <div className="text-[14px] font-bold text-gray-900 shrink-0">₮{r.amount.toLocaleString()}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
