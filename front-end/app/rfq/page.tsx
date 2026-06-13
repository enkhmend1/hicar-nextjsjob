"use client";

/**
 * Buyer RFQ page — "Миний үнийн саналууд".
 *
 * Lists the buyer's own quote requests (GET /rfq/mine, newest first,
 * product populated to {name,images,price}). Per status:
 *   • pending   — waiting; can cancel
 *   • quoted    — seller answered: shows unit price / note / valid-until;
 *                 buyer can accept (PATCH /:id/accept) or cancel
 *   • accepted  — locked in: "Худалдан авах" → /checkout?rfq=<id>
 *   • declined  — seller refused (read-only)
 *   • cancelled — buyer withdrew (read-only)
 *
 * Money shown always comes from quote.unitPrice — the negotiated price is
 * applied SERVER-SIDE at order create; the client never supplies it.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import BuyerShell from "@/app/components/BuyerShell";
import { useAuthStore } from "@/store";
import { api, ApiError } from "@/lib/api";
import { toast } from "@/app/lib/toast";
import { Rfq, RfqStatus } from "@/app/types";
import {
  MessageSquareQuote, Package, Check, X, ShoppingCart, Loader2, Clock,
} from "lucide-react";

const STATUS_META: Record<RfqStatus, { label: string; cls: string }> = {
  pending:   { label: "Хүлээгдэж буй", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  quoted:    { label: "Үнэ ирсэн",     cls: "bg-blue-50 text-blue-700 border-blue-200" },
  accepted:  { label: "Зөвшөөрсөн",    cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  declined:  { label: "Татгалзсан",    cls: "bg-red-50 text-red-700 border-red-200" },
  cancelled: { label: "Цуцалсан",      cls: "bg-gray-100 text-gray-600 border-gray-200" },
};

const fmtDate = (iso?: string) =>
  iso ? new Date(iso).toLocaleDateString("mn-MN", { year: "numeric", month: "2-digit", day: "2-digit" }) : "—";

const isExpired = (rfq: Rfq) =>
  !!rfq.quote?.validUntil && new Date(rfq.quote.validUntil).getTime() <= Date.now();

export default function BuyerRfqPage() {
  const router = useRouter();
  const { user, _hasHydrated } = useAuthStore();
  const [rfqs, setRfqs] = useState<Rfq[]>([]);
  const [loading, setLoading] = useState(true);
  /** Per-RFQ busy flag while accept/cancel is in flight. */
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const reload = () => {
    setLoading(true);
    api.get<{ rfqs: Rfq[] }>("/rfq/mine")
      .then((d) => setRfqs(d.rfqs))
      .catch(() => setRfqs([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!_hasHydrated) return;
    if (!user) { router.push("/auth/login"); return; }
    queueMicrotask(reload);
  }, [user, router, _hasHydrated]);

  const accept = async (id: string) => {
    setBusy((b) => ({ ...b, [id]: true }));
    try {
      await api.patch(`/rfq/${id}/accept`, {});
      toast.success("Үнийн саналыг зөвшөөрлөө. Одоо худалдан авах боломжтой.");
      reload();
    } catch (e) {
      toast.error((e as ApiError).message || "Алдаа гарлаа");
    } finally {
      setBusy((b) => ({ ...b, [id]: false }));
    }
  };

  const cancel = async (id: string) => {
    if (!confirm("Энэ үнийн саналыг цуцлах уу?")) return;
    setBusy((b) => ({ ...b, [id]: true }));
    try {
      await api.patch(`/rfq/${id}/cancel`, {});
      toast.info("Үнийн санал цуцлагдлаа.");
      reload();
    } catch (e) {
      toast.error((e as ApiError).message || "Алдаа гарлаа");
    } finally {
      setBusy((b) => ({ ...b, [id]: false }));
    }
  };

  if (!_hasHydrated || !user) return null;

  return (
    <BuyerShell>
      <div className="max-w-2xl mx-auto px-5 py-5">
        <div className="flex items-center gap-2 mb-5">
          <MessageSquareQuote size={20} className="text-blue-600" />
          <h1 className="text-[20px] font-semibold text-gray-900">Миний үнийн саналууд</h1>
        </div>

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="bg-white border border-gray-200 rounded-2xl h-[140px] animate-pulse" />
            ))}
          </div>
        ) : rfqs.length === 0 ? (
          <div className="text-center py-20">
            <div className="w-20 h-20 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <MessageSquareQuote size={36} className="text-gray-300" />
            </div>
            <p className="text-[15px] font-medium text-gray-700 mb-2">Үнийн санал алга.</p>
            <p className="text-[13px] text-gray-500 mb-4">Барааны хуудаснаас үнийн санал илгээгээрэй.</p>
            <Link href="/shop" className="inline-block bg-blue-600 text-white rounded-xl px-5 py-2.5 text-[13px] font-semibold">
              Дэлгүүр
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {rfqs.map((rfq) => {
              const id = rfq._id as string;
              const meta = STATUS_META[rfq.status];
              const snap = rfq.productSnapshot;
              // Prefer the populated product image; fall back to the snapshot.
              const prodImg =
                typeof rfq.product === "object" && rfq.product.images?.length
                  ? rfq.product.images[0]
                  : snap.image || null;
              const prodName =
                (typeof rfq.product === "object" ? rfq.product.name : "") || snap.name;
              const expired = isExpired(rfq);
              const rowBusy = !!busy[id];

              return (
                <div key={id} className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
                  {/* Header: product + status chip */}
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
                        {snap.oem && <span className="font-mono">{snap.oem}</span>}
                        <span>Захиалсан: {rfq.qty} ширхэг</span>
                        <span>Жагсаалтын үнэ: ₮{snap.basePrice.toLocaleString()}</span>
                      </div>
                    </div>
                  </div>

                  {/* Buyer's message */}
                  {rfq.message && (
                    <div className="mt-3 text-[12px] text-gray-600 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">
                      <span className="text-gray-400">Таны зурвас: </span>{rfq.message}
                    </div>
                  )}

                  {/* Quote details — shown once the seller answered */}
                  {(rfq.status === "quoted" || rfq.status === "accepted") && rfq.quote && (
                    <div className="mt-3 bg-blue-50 border border-blue-100 rounded-xl p-3">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-[12px] text-blue-700 font-semibold">Санал болгосон нэгж үнэ</span>
                        <span className="text-[18px] font-bold text-blue-700">₮{rfq.quote.unitPrice.toLocaleString()}</span>
                      </div>
                      <div className="flex items-baseline justify-between gap-2 mt-1 pt-1 border-t border-blue-100">
                        <span className="text-[11px] text-gray-500">Нийт ({rfq.qty} ширхэг)</span>
                        <span className="text-[13px] font-semibold text-gray-700">
                          ₮{(rfq.quote.unitPrice * rfq.qty).toLocaleString()}
                        </span>
                      </div>
                      {rfq.quote.note && (
                        <div className="text-[12px] text-gray-600 mt-2">
                          <span className="text-gray-400">Тэмдэглэл: </span>{rfq.quote.note}
                        </div>
                      )}
                      <div className={`text-[11px] mt-2 inline-flex items-center gap-1 ${expired ? "text-red-500" : "text-gray-500"}`}>
                        <Clock size={11} /> Хүчинтэй: {fmtDate(rfq.quote.validUntil)}
                        {expired && <span className="font-semibold">· Хугацаа дууссан</span>}
                      </div>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="mt-3 pt-3 border-t border-gray-100 flex flex-wrap items-center justify-end gap-2">
                    {rfq.status === "quoted" && (
                      <button onClick={() => accept(id)} disabled={rowBusy || expired}
                        title={expired ? "Үнийн саналын хугацаа дууссан" : undefined}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer border-none">
                        {rowBusy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                        Зөвшөөрөх
                      </button>
                    )}
                    {rfq.status === "accepted" && (
                      <button onClick={() => router.push(`/checkout?rfq=${id}`)}
                        className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[12px] font-semibold bg-blue-600 text-white hover:bg-blue-700 cursor-pointer border-none shadow-sm shadow-blue-200">
                        <ShoppingCart size={12} /> Худалдан авах
                      </button>
                    )}
                    {(rfq.status === "pending" || rfq.status === "quoted") && (
                      <button onClick={() => cancel(id)} disabled={rowBusy}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold text-gray-600 hover:bg-gray-50 bg-transparent border border-gray-200 cursor-pointer disabled:opacity-50 font-sans">
                        <X size={12} /> Цуцлах
                      </button>
                    )}
                    {(rfq.status === "declined" || rfq.status === "cancelled") && (
                      <span className="text-[11px] text-gray-400">
                        {fmtDate(rfq.respondedAt || rfq.createdAt)}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </BuyerShell>
  );
}
