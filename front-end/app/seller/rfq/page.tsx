"use client";

/**
 * Seller RFQ dashboard — "Үнийн санал" (incoming quote requests).
 *
 * Renders inside the seller layout shell (sidebar comes from
 * app/seller/layout.tsx). Fetches GET /rfq/seller (newest first, buyer name
 * + product populated) and lets the seller:
 *   • pending  → answer with an inline quote form (PATCH /:id/quote
 *                { unitPrice, note?, validUntil? }) or decline (/:id/decline)
 *   • quoted   → re-quote (the form stays available — price negotiation) and
 *                see the sent quote read-only
 *   • other    → read-only status + sent quote
 *
 * Filter tabs: Бүгд / Шинэ (pending) / Хариулсан (quoted). The list refreshes
 * after every action. unitPrice is integer MNT ≥1; validUntil must be a
 * future date (defaults to +7 days).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { api, ApiError } from "@/lib/api";
import { toast } from "@/app/lib/toast";
import { Rfq, RfqStatus } from "@/app/types";
import {
  MessageSquareQuote, Package, Send, X, Loader2, Clock, User as UserIcon,
} from "lucide-react";
import PageHeader from "@/app/seller/_components/PageHeader";
import { EmptyState, CardListSkeleton } from "@/app/seller/_components/States";

type Filter = "all" | "pending" | "quoted";

const STATUS_META: Record<RfqStatus, { label: string; cls: string }> = {
  pending:   { label: "Шинэ хүсэлт",  cls: "bg-amber-50 text-amber-700 border-amber-200" },
  quoted:    { label: "Хариулсан",    cls: "bg-blue-50 text-blue-700 border-blue-200" },
  accepted:  { label: "Зөвшөөрсөн",   cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  declined:  { label: "Татгалзсан",   cls: "bg-red-50 text-red-700 border-red-200" },
  cancelled: { label: "Цуцалсан",     cls: "bg-gray-100 text-gray-600 border-gray-200" },
};

/** Default quote expiry = today + 7 days, formatted for <input type="date">. */
const defaultValidUntil = () => {
  const d = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
};

const fmtDate = (iso?: string) =>
  iso ? new Date(iso).toLocaleDateString("mn-MN", { year: "numeric", month: "2-digit", day: "2-digit" }) : "—";

interface QuoteDraft { unitPrice: string; note: string; validUntil: string; }

export default function SellerRfqPage() {
  const [rfqs, setRfqs] = useState<Rfq[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  /** Per-RFQ quote-form draft (keyed by rfq id). */
  const [drafts, setDrafts] = useState<Record<string, QuoteDraft>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const { rfqs } = await api.get<{ rfqs: Rfq[] }>("/rfq/seller");
      setRfqs(rfqs);
    } catch {
      setRfqs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // queueMicrotask defers reload()'s setLoading(true) past the effect commit —
  // mirrors the seller products page (React 19 sync-setState-in-effect guard).
  useEffect(() => { queueMicrotask(reload); }, [reload]);

  const draftFor = (id: string): QuoteDraft =>
    drafts[id] ?? { unitPrice: "", note: "", validUntil: defaultValidUntil() };

  const setDraft = (id: string, patch: Partial<QuoteDraft>) =>
    setDrafts((d) => ({ ...d, [id]: { ...draftFor(id), ...patch } }));

  const sendQuote = async (rfq: Rfq) => {
    const id = rfq._id as string;
    const d = draftFor(id);
    const price = Math.floor(Number(d.unitPrice));
    if (!Number.isFinite(price) || price < 1) {
      toast.error("Үнэ дор хаяж ₮1 (бүхэл тоо) байх ёстой.");
      return;
    }
    if (!d.validUntil) {
      toast.error("Хүчинтэй хугацааг сонгоно уу.");
      return;
    }
    setBusy((b) => ({ ...b, [id]: true }));
    try {
      // Send validUntil as end-of-day ISO so "today + N" never lands in the
      // past relative to the server clock.
      const validUntilIso = new Date(`${d.validUntil}T23:59:59`).toISOString();
      await api.patch(`/rfq/${id}/quote`, {
        unitPrice: price,
        note: d.note.trim() || undefined,
        validUntil: validUntilIso,
      });
      toast.success("Үнийн санал илгээгдлээ.");
      reload();
    } catch (e) {
      toast.error((e as ApiError).message || "Алдаа гарлаа");
    } finally {
      setBusy((b) => ({ ...b, [id]: false }));
    }
  };

  const decline = async (id: string) => {
    if (!confirm("Энэ хүсэлтийг татгалзах уу?")) return;
    setBusy((b) => ({ ...b, [id]: true }));
    try {
      await api.patch(`/rfq/${id}/decline`, {});
      toast.info("Хүсэлтийг татгалзлаа.");
      reload();
    } catch (e) {
      toast.error((e as ApiError).message || "Алдаа гарлаа");
    } finally {
      setBusy((b) => ({ ...b, [id]: false }));
    }
  };

  const pendingCount = useMemo(() => rfqs.filter((r) => r.status === "pending").length, [rfqs]);
  const visible = useMemo(
    () => (filter === "all" ? rfqs : rfqs.filter((r) => r.status === filter)),
    [rfqs, filter],
  );

  const TABS: Array<{ id: Filter; label: string }> = [
    { id: "all", label: "Бүгд" },
    { id: "pending", label: "Шинэ" },
    { id: "quoted", label: "Хариулсан" },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Үнийн санал"
        icon={MessageSquareQuote}
        subtitle={
          <>
            {rfqs.length} хүсэлт
            {pendingCount > 0 && <span className="text-amber-600 font-medium"> · {pendingCount} шинэ</span>}
          </>
        }
      />

      {/* Filter tabs */}
      <div className="inline-flex bg-gray-100 rounded-lg p-1">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setFilter(t.id)}
            className={`px-3 py-1.5 rounded-md text-[13px] font-medium cursor-pointer border-none transition-colors font-sans ${
              filter === t.id ? "bg-white text-gray-900 shadow-sm" : "bg-transparent text-gray-500 hover:text-gray-700"
            }`}>
            {t.label}
            {t.id === "pending" && pendingCount > 0 && (
              <span className="ml-1.5 text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">{pendingCount}</span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <CardListSkeleton count={3} height="h-[150px]" />
      ) : visible.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-2xl">
          <EmptyState
            icon={MessageSquareQuote}
            title="Үнийн санал алга."
            hint="Худалдан авагч үнийн санал хүсмэгц энд харагдана."
          />
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((rfq) => {
            const id = rfq._id as string;
            const meta = STATUS_META[rfq.status];
            const snap = rfq.productSnapshot;
            const prodImg =
              typeof rfq.product === "object" && rfq.product.images?.length
                ? rfq.product.images[0]
                : snap.image || null;
            const prodName =
              (typeof rfq.product === "object" ? rfq.product.name : "") || snap.name;
            const buyerName = typeof rfq.buyer === "object" ? rfq.buyer.name : "Худалдан авагч";
            const rowBusy = !!busy[id];
            const d = draftFor(id);
            const canQuote = rfq.status === "pending" || rfq.status === "quoted";

            return (
              <div key={id} className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
                {/* Header: buyer + product + status */}
                <div className="flex items-start gap-3">
                  <div className="relative w-14 h-14 rounded-xl overflow-hidden bg-gray-50 border border-gray-200 shrink-0 flex items-center justify-center">
                    {prodImg
                      ? <Image src={prodImg} alt={prodName} fill sizes="56px" className="object-cover" unoptimized />
                      : <Package size={20} className="text-gray-300" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-[14px] font-semibold text-gray-900 leading-snug line-clamp-2">{prodName}</div>
                      <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border shrink-0 ${meta.cls}`}>
                        {meta.label}
                      </span>
                    </div>
                    <div className="text-[11px] text-gray-500 mt-0.5 flex flex-wrap items-center gap-x-2">
                      <span className="inline-flex items-center gap-1"><UserIcon size={11} /> {buyerName}</span>
                      {snap.oem && <span className="font-mono">{snap.oem}</span>}
                      <span>Захиалсан: {rfq.qty} ширхэг</span>
                      <span>Жагсаалтын үнэ: ₮{snap.basePrice.toLocaleString()}</span>
                    </div>
                  </div>
                </div>

                {/* Buyer's message */}
                {rfq.message && (
                  <div className="mt-3 text-[12px] text-gray-600 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">
                    <span className="text-gray-400">Зурвас: </span>{rfq.message}
                  </div>
                )}

                {/* Sent quote (read-only summary) — shown once a quote exists */}
                {rfq.quote?.unitPrice ? (
                  <div className="mt-3 bg-blue-50 border border-blue-100 rounded-xl p-3 flex flex-wrap items-center gap-x-4 gap-y-1">
                    <div>
                      <span className="text-[11px] text-blue-700 font-semibold">Илгээсэн нэгж үнэ: </span>
                      <span className="text-[14px] font-bold text-blue-700">₮{rfq.quote.unitPrice.toLocaleString()}</span>
                    </div>
                    <div className="text-[11px] text-gray-500 inline-flex items-center gap-1">
                      <Clock size={11} /> Хүчинтэй: {fmtDate(rfq.quote.validUntil)}
                    </div>
                    {rfq.quote.note && (
                      <div className="text-[12px] text-gray-600 w-full">
                        <span className="text-gray-400">Тэмдэглэл: </span>{rfq.quote.note}
                      </div>
                    )}
                  </div>
                ) : null}

                {/* Inline quote form — open for pending & quoted (re-quote). */}
                {canQuote && (
                  <div className="mt-3 pt-3 border-t border-gray-100">
                    {rfq.status === "quoted" && (
                      <div className="text-[11px] text-gray-400 mb-2">Шинэ үнэ илгээж дахин санал болгох боломжтой.</div>
                    )}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                      <div className="sm:col-span-1">
                        <label className="block text-[11px] font-medium text-gray-600 mb-1">Нэгж үнэ (₮)</label>
                        <input type="number" min={1} step={1} value={d.unitPrice}
                          onChange={(e) => setDraft(id, { unitPrice: e.target.value })}
                          placeholder={`${snap.basePrice}`}
                          className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-[16px] md:text-[13px] focus:border-blue-500 focus:bg-white outline-none transition-colors" />
                      </div>
                      <div className="sm:col-span-1">
                        <label className="block text-[11px] font-medium text-gray-600 mb-1">Хүчинтэй хугацаа</label>
                        <input type="date" value={d.validUntil}
                          min={new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)}
                          onChange={(e) => setDraft(id, { validUntil: e.target.value })}
                          className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-[16px] md:text-[13px] focus:border-blue-500 focus:bg-white outline-none transition-colors" />
                      </div>
                      <div className="sm:col-span-1">
                        <label className="block text-[11px] font-medium text-gray-600 mb-1">Тэмдэглэл (заавал биш)</label>
                        <input type="text" value={d.note} maxLength={500}
                          onChange={(e) => setDraft(id, { note: e.target.value })}
                          placeholder="Жнь: 7 хоногт хүргэнэ"
                          className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-[16px] md:text-[13px] focus:border-blue-500 focus:bg-white outline-none transition-colors" />
                      </div>
                    </div>
                    <div className="flex flex-wrap justify-end gap-2 mt-3">
                      <button onClick={() => decline(id)} disabled={rowBusy}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold text-red-600 hover:bg-red-50 bg-transparent border border-red-200 cursor-pointer disabled:opacity-50 font-sans">
                        <X size={13} /> Татгалзах
                      </button>
                      <button onClick={() => sendQuote(rfq)} disabled={rowBusy}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-[12px] font-semibold bg-gradient-to-r from-blue-600 to-amber-600 hover:from-blue-700 hover:to-amber-700 text-white cursor-pointer border-none disabled:opacity-50 shadow-sm shadow-blue-200">
                        {rowBusy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                        Үнэ илгээх
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
