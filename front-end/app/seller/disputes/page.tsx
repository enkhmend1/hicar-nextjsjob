"use client";

/**
 * Seller view of disputes filed against me.
 *
 * Layout: master/detail. Left rail shows the dispute list with status
 * filter chips; right panel shows the buyer claim + evidence + a
 * three-button response form (accept full / offer partial / reject).
 *
 * The seller has 48h to respond — we surface a count-down chip so they
 * understand the urgency. Past that window the dispute auto-refunds.
 */

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { api, ApiError } from "@/lib/api";
import { Dispute, DisputeStatus } from "@/app/types";
import {
  Scale, Clock, AlertTriangle, Check, Coins, XCircle, Loader2, Image as ImageIcon, MessageSquare,
} from "lucide-react";

const STATUS_CHIP: Record<DisputeStatus, { label: string; cls: string }> = {
  open:             { label: "Шинэ",       cls: "bg-rose-50 text-rose-700 border-rose-200" },
  awaiting_seller:  { label: "Хариу хүлээж буй", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  ai_analyzing:     { label: "AI шинжилж буй", cls: "bg-blue-50 text-blue-700 border-blue-200" },
  awaiting_buyer:   { label: "Худалдан авагч",  cls: "bg-blue-50 text-blue-700 border-blue-200" },
  escalated_admin:  { label: "Admin шийдэх",    cls: "bg-orange-50 text-orange-700 border-orange-200" },
  resolved_refund:  { label: "Бүрэн буцаалт",   cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  resolved_partial: { label: "Хэсэг буцаалт",   cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  resolved_release: { label: "Худалдагчийн талд",cls: "bg-gray-100 text-gray-700 border-gray-200" },
  cancelled:        { label: "Цуцлагдсан",      cls: "bg-gray-100 text-gray-500 border-gray-200" },
};

const REASON_LABEL: Record<string, string> = {
  not_received: "Хүргэгдээгүй",
  wrong_item: "Буруу бараа",
  damaged: "Гэмтэлтэй",
  defective: "Ажиллахгүй",
  not_as_described: "Тайлбартай таарахгүй",
  counterfeit: "Хуурамч",
  other: "Бусад",
};

const FILTERS: Array<{ id: string; label: string }> = [
  { id: "all",             label: "Бүгд" },
  { id: "awaiting_seller", label: "Хариу хүлээж буй" },
  { id: "awaiting_buyer",  label: "Худалдан авагч" },
  { id: "escalated_admin", label: "Admin шийдэх" },
  { id: "resolved_refund", label: "Шийдэгдсэн" },
];

const fmtDeadline = (iso?: string) => {
  if (!iso) return null;
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return "Хугацаа дууссан";
  const hours = Math.floor(diff / 3_600_000);
  const mins  = Math.floor((diff % 3_600_000) / 60_000);
  return hours > 0 ? `${hours}ц ${mins}м` : `${mins} минут`;
};

export default function SellerDisputesPage() {
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [filter, setFilter]     = useState("awaiting_seller");
  const [loading, setLoading]   = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const reload = () => {
    setLoading(true);
    api.get<{ disputes: Dispute[] }>(`/disputes/seller?status=${filter}`)
      .then((d) => {
        setDisputes(d.disputes);
        if (!selectedId && d.disputes[0]?._id) setSelectedId(d.disputes[0]._id);
      })
      .catch(() => setDisputes([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [filter]);

  const selected = useMemo(
    () => disputes.find((d) => d._id === selectedId) || null,
    [disputes, selectedId],
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[22px] font-semibold text-gray-900 flex items-center gap-2">
          <Scale size={20} className="text-rose-500" /> Маргаан
        </h1>
        <p className="text-[13px] text-gray-500">Захиалгад гарсан гомдол + AI шинжилгээ</p>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map((f) => (
          <button key={f.id} onClick={() => setFilter(f.id)}
            className={`shrink-0 px-3 py-1.5 rounded-full text-[12px] font-medium cursor-pointer border transition-all font-sans ${
              filter === f.id ? "bg-rose-600 text-white border-rose-600" : "bg-white text-gray-600 border-gray-200 hover:border-rose-400"
            }`}>
            {f.label}
          </button>
        ))}
      </div>

      <div className="grid md:grid-cols-[280px_1fr] gap-4">
        {/* ── List ─────────────────────────────────────────────── */}
        <aside className="bg-white border border-gray-200 rounded-2xl overflow-hidden md:max-h-[78vh] md:overflow-y-auto">
          {loading ? (
            <div className="p-6 text-center text-gray-400 text-[12px]">Уншиж байна...</div>
          ) : disputes.length === 0 ? (
            <div className="p-8 text-center">
              <Scale size={28} className="mx-auto text-gray-300 mb-2" />
              <p className="text-[12px] text-gray-400">Маргаан байхгүй</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {disputes.map((d) => {
                const chip = STATUS_CHIP[d.status];
                const isActive = selectedId === d._id;
                return (
                  <button key={d._id} onClick={() => setSelectedId(d._id!)}
                    className={`w-full text-left p-3 cursor-pointer border-none transition-colors block ${
                      isActive ? "bg-rose-50" : "bg-transparent hover:bg-gray-50"
                    }`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] font-mono text-gray-400">
                        #{(typeof d.order === "string" ? d.order : d.order?._id ?? "").slice(-8).toUpperCase()}
                      </span>
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${chip.cls}`}>
                        {chip.label}
                      </span>
                    </div>
                    <div className="text-[12px] font-semibold text-gray-900 truncate">
                      {REASON_LABEL[d.reason] || d.reason}
                    </div>
                    <div className="text-[11px] text-gray-500 truncate">
                      ₮{d.requestedRefundAmount.toLocaleString()}
                    </div>
                    {d.responseDeadline && d.status === "awaiting_seller" && (
                      <div className="text-[10px] text-amber-700 mt-1 inline-flex items-center gap-1">
                        <Clock size={9} /> {fmtDeadline(d.responseDeadline)}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </aside>

        {/* ── Detail ───────────────────────────────────────────── */}
        <section className="bg-white border border-gray-200 rounded-2xl p-5 md:max-h-[78vh] md:overflow-y-auto">
          {selected ? (
            <DisputeDetail dispute={selected} onChanged={reload} />
          ) : (
            <div className="p-8 text-center text-gray-400 text-[12px]">Маргаан сонгоно уу</div>
          )}
        </section>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────── */

function DisputeDetail({ dispute, onChanged }: { dispute: Dispute; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState("");
  const [partial, setPartial] = useState(String(Math.round(dispute.requestedRefundAmount / 2)));
  const [note, setNote]       = useState("");

  const canRespond = dispute.status === "awaiting_seller";
  const chip = STATUS_CHIP[dispute.status];

  const respond = async (action: "refund_offered" | "partial_refund_offered" | "rejected") => {
    setBusy(true); setErr("");
    try {
      const body: Record<string, unknown> = { action, message: note };
      if (action === "partial_refund_offered") {
        const n = Math.floor(Number(partial));
        if (!Number.isFinite(n) || n <= 0 || n >= dispute.requestedRefundAmount) {
          throw new Error("Хэсэгчилсэн дүн зөв оруулна уу");
        }
        body.offeredAmount = n;
      }
      await api.post(`/disputes/${dispute._id}/respond`, body);
      onChanged();
    } catch (e) {
      setErr((e as ApiError).message || "Алдаа гарлаа");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[11px] text-gray-400 font-mono">#{dispute._id?.slice(-8).toUpperCase()}</div>
          <div className="text-[16px] font-semibold text-gray-900">{REASON_LABEL[dispute.reason]}</div>
        </div>
        <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${chip.cls}`}>
          {chip.label}
        </span>
      </div>

      {dispute.responseDeadline && dispute.status === "awaiting_seller" && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-[12px] rounded-xl p-3 flex items-start gap-2">
          <Clock size={13} className="shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold">Хариу өгөх хугацаа: {fmtDeadline(dispute.responseDeadline)}</div>
            <div className="text-[11px]">Хугацаа дуусвал автомат бүрэн буцаалт хийгдэнэ.</div>
          </div>
        </div>
      )}

      <div>
        <div className="text-[11px] text-gray-500 mb-1">Худалдан авагчийн тайлбар</div>
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-[13px] text-gray-800 whitespace-pre-wrap">
          {dispute.description}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 text-[12px]">
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
          <div className="text-[10px] text-blue-700 uppercase tracking-wide">Хүсэлт</div>
          <div className="text-[16px] font-bold text-blue-800">₮{dispute.requestedRefundAmount.toLocaleString()}</div>
        </div>
        {dispute.aiAnalysis?.fraudScore !== undefined && (
          <div className={`border rounded-xl p-3 ${
            dispute.aiAnalysis.fraudScore >= 70 ? "bg-emerald-50 border-emerald-200"
            : dispute.aiAnalysis.fraudScore <= 30 ? "bg-rose-50 border-rose-200"
            : "bg-amber-50 border-amber-200"
          }`}>
            <div className="text-[10px] uppercase tracking-wide opacity-70">AI үнэлгээ</div>
            <div className="text-[16px] font-bold">
              {dispute.aiAnalysis.fraudScore}/100 · {dispute.aiAnalysis.confidence}%
            </div>
            <div className="text-[10px] opacity-80">{dispute.aiAnalysis.recommendedAction}</div>
          </div>
        )}
      </div>

      {dispute.aiAnalysis?.reasoning && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
          <div className="text-[11px] text-blue-700 font-semibold mb-1">AI шинжилгээ</div>
          <div className="text-[12px] text-blue-900">{dispute.aiAnalysis.reasoning}</div>
          {dispute.aiAnalysis.flags && dispute.aiAnalysis.flags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {dispute.aiAnalysis.flags.map((f) => (
                <span key={f} className="text-[10px] bg-white border border-blue-200 text-blue-700 px-1.5 py-0.5 rounded-full">{f}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {dispute.evidenceImages && dispute.evidenceImages.length > 0 && (
        <div>
          <div className="text-[11px] text-gray-500 mb-1 inline-flex items-center gap-1">
            <ImageIcon size={11} /> Нотолгоо
          </div>
          <div className="flex flex-wrap gap-1.5">
            {dispute.evidenceImages.map((url, i) => (
              <a key={i} href={url} target="_blank" rel="noreferrer"
                className="relative w-16 h-16 rounded-lg overflow-hidden border border-gray-200 block">
                <Image src={url} alt="" fill sizes="64px" className="object-cover" unoptimized />
              </a>
            ))}
          </div>
        </div>
      )}

      <MessageThread messages={dispute.messages} />

      {canRespond && (
        <div className="border-t border-gray-100 pt-4 space-y-3">
          <div className="text-[12px] font-semibold text-gray-700">Таны хариу</div>

          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Тайлбар (заавал биш) — буцаалт өгөх / татгалзах шалтгаан..."
            rows={3} maxLength={2000}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] focus:border-blue-500 outline-none resize-none font-sans"
          />

          <div className="grid sm:grid-cols-3 gap-2">
            <button onClick={() => respond("refund_offered")} disabled={busy}
              className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg py-2.5 text-[12px] font-semibold cursor-pointer border-none transition-colors font-sans inline-flex items-center justify-center gap-1.5">
              <Check size={12} /> Бүрэн буцаалт
            </button>

            <div className="flex gap-1">
              <input type="number" value={partial} onChange={(e) => setPartial(e.target.value)}
                min={1} max={dispute.requestedRefundAmount - 1}
                className="flex-1 border border-gray-200 rounded-lg px-2 py-2 text-[12px] focus:border-blue-500 outline-none w-0" />
              <button onClick={() => respond("partial_refund_offered")} disabled={busy}
                className="bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded-lg px-2 py-2 text-[11px] font-semibold cursor-pointer border-none transition-colors font-sans inline-flex items-center gap-1 whitespace-nowrap">
                <Coins size={11} /> Хэсэг
              </button>
            </div>

            <button onClick={() => respond("rejected")} disabled={busy}
              className="bg-white border border-rose-300 text-rose-700 hover:bg-rose-50 disabled:opacity-50 rounded-lg py-2.5 text-[12px] font-semibold cursor-pointer transition-colors font-sans inline-flex items-center justify-center gap-1.5">
              <XCircle size={12} /> Татгалзах
            </button>
          </div>

          {err && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg p-2.5 text-[12px]">
              <AlertTriangle size={13} className="shrink-0 mt-0.5" />
              <span>{err}</span>
            </div>
          )}

          {busy && (
            <div className="flex items-center gap-2 text-[12px] text-gray-500">
              <Loader2 size={12} className="animate-spin" /> Илгээж байна...
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MessageThread({ messages }: { messages: Dispute["messages"] }) {
  if (!messages?.length) return null;
  return (
    <div>
      <div className="text-[11px] text-gray-500 mb-1.5 inline-flex items-center gap-1">
        <MessageSquare size={11} /> Яриа
      </div>
      <div className="space-y-1.5 max-h-56 overflow-y-auto">
        {messages.map((m, i) => (
          <div key={m._id || i} className={`text-[12px] rounded-lg p-2 ${
            m.author === "system" ? "bg-gray-50 text-gray-500 italic"
            : m.author === "ai"     ? "bg-blue-50 text-blue-800"
            : m.author === "admin"  ? "bg-orange-50 text-orange-800"
            : m.author === "seller" ? "bg-blue-50 text-blue-800"
            : "bg-rose-50 text-rose-800"
          }`}>
            <span className="font-semibold text-[10px] uppercase mr-1.5 opacity-70">{m.author}</span>
            {m.text}
          </div>
        ))}
      </div>
    </div>
  );
}
