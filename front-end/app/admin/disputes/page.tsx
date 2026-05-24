"use client";

/**
 * Admin dispute resolution console.
 *
 * The flow funnels into this page when:
 *   - AI confidence < 60% and refused to recommend
 *   - Seller rejected and AI heuristic disagrees
 *   - Buyer rejected the seller's offer
 *
 * Admin has full transparency: buyer & seller history, AI reasoning,
 * full message thread, all evidence images. Final action is one of:
 *   refund_full   — buyer wins, full requested amount refunded
 *   refund_partial — admin picks an amount ≤ requested
 *   release_seller — buyer loses, escrow released on schedule
 *   reject_claim   — same outcome as release_seller, different audit label
 */

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { api, ApiError } from "@/lib/api";
import { Dispute, DisputeStatus } from "@/app/types";
import {
  Scale, AlertTriangle, Check, Coins, XCircle, ShieldCheck, Loader2, User as UserIcon,
  Store, Bot, MessageSquare, Image as ImageIcon,
} from "lucide-react";

const STATUS_CHIP: Record<DisputeStatus, { label: string; cls: string }> = {
  open:             { label: "Шинэ",          cls: "bg-rose-50 text-rose-700 border-rose-200" },
  awaiting_seller:  { label: "Seller хүлээж буй", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  ai_analyzing:     { label: "AI шинжилж буй",   cls: "bg-blue-50 text-blue-700 border-blue-200" },
  awaiting_buyer:   { label: "Buyer хариу хүлээж", cls: "bg-blue-50 text-blue-700 border-blue-200" },
  escalated_admin:  { label: "Шийдвэрлэх",       cls: "bg-orange-50 text-orange-700 border-orange-200" },
  resolved_refund:  { label: "Бүрэн буцаалт",    cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  resolved_partial: { label: "Хэсэг буцаалт",    cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  resolved_release: { label: "Seller-ийн талд",  cls: "bg-gray-100 text-gray-700 border-gray-200" },
  cancelled:        { label: "Цуцлагдсан",       cls: "bg-gray-100 text-gray-500 border-gray-200" },
};

const REASON_LABEL: Record<string, string> = {
  not_received: "Хүргэгдээгүй", wrong_item: "Буруу бараа", damaged: "Гэмтэлтэй",
  defective: "Ажиллахгүй", not_as_described: "Тайлбартай таарахгүй",
  counterfeit: "Хуурамч", other: "Бусад",
};

const FILTERS = [
  { id: "escalated_admin", label: "Шийдвэрлэх" },
  { id: "ai_analyzing",    label: "AI шинжилж буй" },
  { id: "awaiting_seller", label: "Seller хүлээж буй" },
  { id: "awaiting_buyer",  label: "Buyer хүлээж буй" },
  { id: "resolved_refund", label: "Шийдэгдсэн" },
  { id: "all",             label: "Бүгд" },
];

export default function AdminDisputesPage() {
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [filter, setFilter]     = useState("escalated_admin");
  const [loading, setLoading]   = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const reload = () => {
    setLoading(true);
    api.get<{ disputes: Dispute[] }>(`/disputes/admin?status=${filter}`)
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
          <Scale size={20} className="text-blue-600" /> Маргаан шийдвэрлэх
        </h1>
        <p className="text-[13px] text-gray-500">AI шинжилгээ + хоёр талын түүх + escrow удирдлага</p>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map((f) => (
          <button key={f.id} onClick={() => setFilter(f.id)}
            className={`shrink-0 px-3 py-1.5 rounded-full text-[12px] font-medium cursor-pointer border transition-all font-sans ${
              filter === f.id ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 border-gray-200 hover:border-blue-400"
            }`}>
            {f.label}
          </button>
        ))}
      </div>

      <div className="grid md:grid-cols-[320px_1fr] gap-4">
        <aside className="bg-white border border-gray-200 rounded-2xl overflow-hidden md:max-h-[78vh] md:overflow-y-auto">
          {loading ? (
            <div className="p-6 text-center text-gray-400 text-[12px]">Уншиж байна...</div>
          ) : disputes.length === 0 ? (
            <div className="p-8 text-center">
              <ShieldCheck size={28} className="mx-auto text-emerald-300 mb-2" />
              <p className="text-[12px] text-gray-400">Шийдэх маргаан байхгүй</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {disputes.map((d) => {
                const chip  = STATUS_CHIP[d.status];
                const score = d.aiAnalysis?.fraudScore;
                const active = selectedId === d._id;
                return (
                  <button key={d._id} onClick={() => setSelectedId(d._id!)}
                    className={`w-full text-left p-3 cursor-pointer border-none transition-colors block ${
                      active ? "bg-blue-50" : "bg-transparent hover:bg-gray-50"
                    }`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] font-mono text-gray-400">
                        #{(typeof d.order === "string" ? d.order : d.order?._id ?? "").slice(-8).toUpperCase()}
                      </span>
                      <div className="flex items-center gap-1">
                        {typeof score === "number" && (
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                            score >= 70 ? "bg-emerald-100 text-emerald-700"
                            : score <= 30 ? "bg-rose-100 text-rose-700"
                            : "bg-amber-100 text-amber-700"
                          }`}>AI {score}</span>
                        )}
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${chip.cls}`}>
                          {chip.label}
                        </span>
                      </div>
                    </div>
                    <div className="text-[12px] font-semibold text-gray-900 truncate">
                      {REASON_LABEL[d.reason]} — ₮{d.requestedRefundAmount.toLocaleString()}
                    </div>
                    <div className="text-[10px] text-gray-500 truncate flex items-center gap-2 mt-0.5">
                      <span className="inline-flex items-center gap-0.5"><UserIcon size={9} /> {typeof d.buyer === "object" ? d.buyer?.name : "—"}</span>
                      <span className="inline-flex items-center gap-0.5"><Store size={9} /> {typeof d.seller === "object" ? (d.seller?.sellerProfile?.shopName || d.seller?.name) : "—"}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </aside>

        <section className="bg-white border border-gray-200 rounded-2xl p-5 md:max-h-[78vh] md:overflow-y-auto">
          {selected ? (
            <AdminDetail dispute={selected} onChanged={reload} />
          ) : (
            <div className="p-8 text-center text-gray-400 text-[12px]">Маргаан сонгоно уу</div>
          )}
        </section>
      </div>
    </div>
  );
}

function AdminDetail({ dispute, onChanged }: { dispute: Dispute; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState("");
  const [partial, setPartial] = useState(String(Math.round(dispute.requestedRefundAmount / 2)));
  const [penalty, setPenalty] = useState("");
  const [notes, setNotes]     = useState("");

  const canResolve = ["escalated_admin", "ai_analyzing", "awaiting_buyer", "awaiting_seller"].includes(dispute.status);
  const chip = STATUS_CHIP[dispute.status];

  const resolve = async (action: "refund_full" | "refund_partial" | "release_seller" | "reject_claim") => {
    setBusy(true); setErr("");
    try {
      const body: Record<string, unknown> = { action, notes };
      if (action === "refund_partial") {
        const n = Math.floor(Number(partial));
        if (!Number.isFinite(n) || n <= 0 || n > dispute.requestedRefundAmount) {
          throw new Error("Хэсэгчилсэн дүн 1 – хүсэлтийн дүн хооронд");
        }
        body.amount = n;
      }
      // Optional return-shipping penalty (deducted from seller's payout)
      const p = Math.floor(Number(penalty));
      if (Number.isFinite(p) && p > 0) body.returnShippingPenalty = p;
      await api.post(`/disputes/${dispute._id}/resolve`, body);
      onChanged();
    } catch (e) {
      setErr((e as ApiError).message || "Алдаа гарлаа");
    } finally {
      setBusy(false);
    }
  };

  const buyer  = typeof dispute.buyer  === "object" ? dispute.buyer  : null;
  const seller = typeof dispute.seller === "object" ? dispute.seller : null;
  const bh = dispute.aiAnalysis?.buyerHistory as Record<string, number> | undefined;
  const sh = dispute.aiAnalysis?.sellerHistory as Record<string, number> | undefined;

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

      <div className="grid grid-cols-2 gap-3 text-[12px]">
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-3">
          <div className="text-[10px] text-rose-700 uppercase tracking-wide inline-flex items-center gap-1">
            <UserIcon size={10} /> Худалдан авагч
          </div>
          <div className="font-semibold text-gray-900 truncate">{buyer?.name || "—"}</div>
          {bh && (
            <div className="text-[10px] text-gray-600 mt-1 space-y-0.5">
              <div>Захиалга: {bh.totalOrders ?? 0}</div>
              <div>Маргаан: {bh.totalDisputes ?? 0} (өнгөрсөн 90 хоногт {bh.recentDisputes90d ?? 0})</div>
              <div>Буцаалт ялалт: {Math.round(((bh.refundWinRate ?? 0) as number) * 100)}%</div>
            </div>
          )}
        </div>
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
          <div className="text-[10px] text-blue-700 uppercase tracking-wide inline-flex items-center gap-1">
            <Store size={10} /> Худалдагч
          </div>
          <div className="font-semibold text-gray-900 truncate">
            {seller?.sellerProfile?.shopName || seller?.name || "—"}
          </div>
          {sh && (
            <div className="text-[10px] text-gray-600 mt-1 space-y-0.5">
              <div>Захиалга: {sh.totalOrders ?? 0}</div>
              <div>Маргаан: {sh.totalDisputes ?? 0}</div>
              <div>Буцаалт хувь: {Math.round(((sh.refundedShare ?? 0) as number) * 100)}%</div>
            </div>
          )}
        </div>
      </div>

      {dispute.aiAnalysis?.fraudScore !== undefined && (
        <div className={`border rounded-xl p-3 ${
          dispute.aiAnalysis.fraudScore >= 70 ? "bg-emerald-50 border-emerald-200"
          : dispute.aiAnalysis.fraudScore <= 30 ? "bg-rose-50 border-rose-200"
          : "bg-amber-50 border-amber-200"
        }`}>
          <div className="text-[10px] uppercase tracking-wide opacity-70 inline-flex items-center gap-1">
            <Bot size={10} /> AI үнэлгээ ({dispute.aiAnalysis.model})
          </div>
          <div className="text-[15px] font-bold mt-1">
            Fraud score: {dispute.aiAnalysis.fraudScore}/100 · Confidence: {dispute.aiAnalysis.confidence}%
          </div>
          <div className="text-[12px] mt-1">Санал болгож буй: {dispute.aiAnalysis.recommendedAction}</div>
          {dispute.aiAnalysis.reasoning && (
            <div className="text-[12px] mt-2 italic">{dispute.aiAnalysis.reasoning}</div>
          )}
          {dispute.aiAnalysis.flags && dispute.aiAnalysis.flags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {dispute.aiAnalysis.flags.map((f) => (
                <span key={f} className="text-[10px] bg-white border opacity-90 px-1.5 py-0.5 rounded-full">{f}</span>
              ))}
            </div>
          )}
        </div>
      )}

      <div>
        <div className="text-[11px] text-gray-500 mb-1">Тайлбар</div>
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-[13px] text-gray-800 whitespace-pre-wrap">
          {dispute.description}
        </div>
      </div>

      {dispute.evidenceImages && dispute.evidenceImages.length > 0 && (
        <div>
          <div className="text-[11px] text-gray-500 mb-1 inline-flex items-center gap-1">
            <ImageIcon size={11} /> Нотолгоо
          </div>
          <div className="flex flex-wrap gap-1.5">
            {dispute.evidenceImages.map((url, i) => (
              <a key={i} href={url} target="_blank" rel="noreferrer"
                className="relative w-20 h-20 rounded-lg overflow-hidden border border-gray-200 block">
                <Image src={url} alt="" fill sizes="80px" className="object-cover" unoptimized />
              </a>
            ))}
          </div>
        </div>
      )}

      {dispute.sellerResponse?.respondedAt && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-[12px]">
          <div className="text-[11px] text-blue-700 font-semibold mb-0.5">Худалдагчийн хариу</div>
          <div className="text-blue-900">
            {dispute.sellerResponse.action === "refund_offered" && "Бүрэн буцаалт зөвшөөрсөн"}
            {dispute.sellerResponse.action === "partial_refund_offered" && `Хэсэгчилсэн санал: ₮${(dispute.sellerResponse.offeredAmount || 0).toLocaleString()}`}
            {dispute.sellerResponse.action === "rejected" && "Татгалзсан"}
          </div>
          {dispute.sellerResponse.message && (
            <div className="text-blue-800 italic mt-1">«{dispute.sellerResponse.message}»</div>
          )}
        </div>
      )}

      {dispute.messages?.length > 0 && (
        <div>
          <div className="text-[11px] text-gray-500 mb-1.5 inline-flex items-center gap-1">
            <MessageSquare size={11} /> Яриа
          </div>
          <div className="space-y-1.5 max-h-56 overflow-y-auto">
            {dispute.messages.map((m, i) => (
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
      )}

      {canResolve && (
        <div className="border-t border-gray-100 pt-4 space-y-3">
          <div className="text-[12px] font-semibold text-gray-700">Шийдвэр</div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Шийдвэрийн дотоод тэмдэглэл (audit log)..."
            rows={2} maxLength={2000}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] focus:border-blue-500 outline-none resize-none font-sans"
          />

          <div>
            <label className="block text-[11px] text-gray-500 mb-1">
              Буцаалтын тээврийн зардал (худалдагчийн дансаас хасах ₮, заавал биш)
            </label>
            <div className="flex items-center gap-2">
              <span className="text-[13px] text-gray-500">₮</span>
              <input type="number" value={penalty} onChange={(e) => setPenalty(e.target.value)}
                min={0} step={1000} placeholder="0"
                className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-[13px] focus:border-blue-500 outline-none" />
            </div>
            <p className="text-[10px] text-gray-400 mt-1">
              Худалдагчийн буруу гэж дүгнэсэн үед буцаалтын шуудангийн төлбөрийг
              худалдагчийн escrow-аас хасч платформ авна. Худалдан авагчид нэмж буцаахгүй.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
            <button onClick={() => resolve("refund_full")} disabled={busy}
              className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg py-2 text-[12px] font-semibold cursor-pointer border-none transition-colors font-sans inline-flex items-center justify-center gap-1.5">
              <Check size={12} /> Бүрэн буцаалт
            </button>

            <div className="flex gap-1">
              <input type="number" value={partial} onChange={(e) => setPartial(e.target.value)}
                min={1} max={dispute.requestedRefundAmount}
                className="flex-1 border border-gray-200 rounded-lg px-2 py-2 text-[12px] focus:border-blue-500 outline-none w-0" />
              <button onClick={() => resolve("refund_partial")} disabled={busy}
                className="bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded-lg px-2 py-2 text-[11px] font-semibold cursor-pointer border-none transition-colors font-sans inline-flex items-center gap-1 whitespace-nowrap">
                <Coins size={11} /> Хэсэг
              </button>
            </div>

            <button onClick={() => resolve("release_seller")} disabled={busy}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg py-2 text-[12px] font-semibold cursor-pointer border-none transition-colors font-sans inline-flex items-center justify-center gap-1.5">
              <ShieldCheck size={12} /> Seller-д
            </button>

            <button onClick={() => resolve("reject_claim")} disabled={busy}
              className="bg-white border border-rose-300 text-rose-700 hover:bg-rose-50 disabled:opacity-50 rounded-lg py-2 text-[12px] font-semibold cursor-pointer transition-colors font-sans inline-flex items-center justify-center gap-1.5">
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
