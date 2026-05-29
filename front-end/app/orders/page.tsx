"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import BuyerShell from "@/app/components/BuyerShell";
import DisputeModal from "@/app/components/DisputeModal";
import OrderTimeline from "@/app/components/OrderTimeline";
import { useAuthStore } from "@/store";
import { api } from "@/lib/api";
import { Order } from "@/app/types";
import { Package, Scale, ShieldCheck, PackageCheck, Loader2, Truck } from "lucide-react";

const STATUS_LABEL: Record<string, string> = {
  pending: "Хүлээгдэж буй",
  paid: "Төлбөр төлсөн",
  processing: "Бэлдэж буй",
  shipped: "Илгээсэн",
  delivered: "Хүргэгдсэн",
  cancelled: "Цуцалсан",
};
const STATUS_COLOR: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700 border-amber-200",
  paid: "bg-blue-50 text-blue-700 border-blue-200",
  processing: "bg-blue-50 text-blue-700 border-blue-200",
  shipped: "bg-indigo-50 text-indigo-700 border-indigo-200",
  delivered: "bg-emerald-50 text-emerald-700 border-emerald-200",
  cancelled: "bg-red-50 text-red-700 border-red-200",
};
const PAYMENT_LABEL: Record<string, { label: string; cls: string }> = {
  PAID:           { label: "Escrow",        cls: "bg-blue-50 text-blue-700 border-blue-200" },
  DISPUTED:       { label: "Escrow LOCKED", cls: "bg-rose-50 text-rose-700 border-rose-200" },
  PARTIAL_REFUND: { label: "Хэсэг буцаалт", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  REFUNDED:       { label: "Бүрэн буцаалт", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  PAID_OUT:       { label: "Төлбөр явсан",  cls: "bg-gray-100 text-gray-600 border-gray-200" },
};

/**
 * An order is disputable when:
 *   • money is in escrow (PAID or PARTIAL_REFUND — there's still something to refund)
 *   • goods have been promised (status != pending / cancelled)
 *   • there isn't already a live dispute on the order
 *
 * Mirrors the server-side guard in dispute.service.createDispute, so the
 * button only appears when the action would succeed.
 */
const isDisputable = (o: Order) =>
  (o.paymentStatus === "PAID" || o.paymentStatus === "PARTIAL_REFUND") &&
  ["paid", "processing", "shipped", "delivered"].includes(o.status) &&
  !o.hasOpenDispute;

export default function OrdersPage() {
  const router = useRouter();
  const { user, _hasHydrated } = useAuthStore();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [disputeFor, setDisputeFor] = useState<Order | null>(null);
  /** Phase AQ.5 — per-order busy flag while confirm-delivery is in flight. */
  const [confirming, setConfirming] = useState<Record<string, boolean>>({});

  const reload = () => {
    setLoading(true);
    api.get<{ orders: Order[] }>("/orders/mine")
      .then((d) => setOrders(d.orders))
      .catch(() => setOrders([]))
      .finally(() => setLoading(false));
  };

  /**
   * Buyer's "Got it!" button. Server transitions the order to delivered,
   * sets buyerConfirmedDeliveryAt, and schedules the escrow release worker.
   * Idempotent — clicking twice returns alreadyConfirmed=true.
   */
  const confirmDelivery = async (orderId: string) => {
    setConfirming((c) => ({ ...c, [orderId]: true }));
    try {
      await api.post(`/orders/${orderId}/confirm-delivery`, {});
      await reload();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Алдаа гарлаа";
      alert(msg);
    } finally {
      setConfirming((c) => ({ ...c, [orderId]: false }));
    }
  };

  useEffect(() => {
    if (!_hasHydrated) return;
    if (!user) { router.push("/auth/login"); return; }
    // queueMicrotask — defer reload()'s setLoading(true) past the effect
    // commit so React 19 doesn't warn about cascading renders.
    queueMicrotask(reload);
  }, [user, router, _hasHydrated]);

  if (!_hasHydrated || !user) return null;

  return (
    <BuyerShell>
      <div className="max-w-2xl mx-auto px-5 py-5">
        <h1 className="text-[20px] font-semibold text-gray-900 mb-5">Миний захиалгууд</h1>

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="bg-white border border-gray-200 rounded-2xl h-[120px] animate-pulse" />
            ))}
          </div>
        ) : orders.length === 0 ? (
          <div className="text-center py-20">
            <div className="w-20 h-20 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Package size={36} className="text-gray-300" />
            </div>
            <p className="text-[15px] font-medium text-gray-700 mb-2">Захиалга байхгүй</p>
            <Link href="/shop" className="inline-block bg-blue-600 text-white rounded-xl px-5 py-2.5 text-[13px] font-semibold">Дэлгүүр</Link>
          </div>
        ) : (
          <div className="space-y-3">
            {orders.map((o) => {
              const pay = o.paymentStatus ? PAYMENT_LABEL[o.paymentStatus] : null;
              return (
                <div key={o._id ?? o.id} className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
                  <div className="flex items-center justify-between mb-2 flex-wrap gap-1">
                    <div className="text-[12px] text-gray-400 font-mono">#{(o._id ?? o.id ?? "").toString().slice(-8).toUpperCase()}</div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${STATUS_COLOR[o.status]}`}>
                        {STATUS_LABEL[o.status]}
                      </span>
                      {pay && (
                        <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${pay.cls}`}>
                          {pay.label}
                        </span>
                      )}
                      {o.hasOpenDispute && (
                        <span className="text-[11px] font-medium px-2 py-0.5 rounded-full border bg-rose-50 text-rose-700 border-rose-200 inline-flex items-center gap-1">
                          <Scale size={10} /> Маргаан
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-[12px] text-gray-500 mb-3">
                    {new Date(o.createdAt).toLocaleString("mn-MN")} · {o.paymentMethod.toUpperCase()}
                  </div>

                  {/* Phase AQ.3 — visual timeline at the top of every card */}
                  <div className="mb-3 px-1">
                    <OrderTimeline status={o.status} />
                  </div>

                  {/* Tracking number — only shown once shipped, with copy hint */}
                  {o.trackingNumber && (
                    <div className="mb-3 flex items-center gap-2 text-[12px] text-gray-600 bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2">
                      <Truck size={13} className="text-indigo-500 shrink-0" />
                      <span className="text-gray-400 shrink-0">Хяналтын код:</span>
                      <span className="font-mono text-gray-700 truncate flex-1">{o.trackingNumber}</span>
                    </div>
                  )}

                  <div className="space-y-1 mb-3">
                    {(Array.isArray(o.items) ? o.items as { name: string; quantity: number; price: number }[] : []).map((i, idx) => (
                      <div key={idx} className="flex justify-between text-[13px]">
                        <span className="text-gray-600 truncate flex-1 mr-3">{i.name} ×{i.quantity}</span>
                        <span className="text-gray-500 shrink-0">₮{((i.price ?? 0) * i.quantity).toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-between items-center pt-3 border-t border-gray-100">
                    <div className="flex items-center gap-1.5 text-[11px] text-gray-400">
                      <ShieldCheck size={12} className="text-emerald-500" /> Escrow хамгаалалт
                    </div>
                    <span className="text-[15px] font-bold text-blue-600">₮{o.total.toLocaleString()}</span>
                  </div>

                  {/* Phase AQ.5 — "Got it" button on shipped orders. Mutually exclusive
                      with dispute (buyer chooses one path). Confirms delivery → triggers
                      escrow release on backend. */}
                  {o.status === "shipped" && (
                    <div className="mt-3 pt-3 border-t border-gray-100 flex flex-wrap justify-end gap-2">
                      <button onClick={() => setDisputeFor(o)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] text-rose-600 hover:bg-rose-50 bg-transparent border border-rose-200 cursor-pointer font-semibold font-sans">
                        <Scale size={12} /> Асуудалтай
                      </button>
                      <button
                        onClick={() => confirmDelivery((o._id ?? o.id) as string)}
                        disabled={confirming[(o._id ?? o.id) as string]}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer border-none">
                        {confirming[(o._id ?? o.id) as string]
                          ? <Loader2 size={12} className="animate-spin" />
                          : <PackageCheck size={12} />}
                        Бараа хүлээн авлаа
                      </button>
                    </div>
                  )}

                  {/* Dispute button (kept for delivered+escrow path too) */}
                  {isDisputable(o) && o.status !== "shipped" && (
                    <div className="mt-2 pt-2 border-t border-gray-100 flex justify-end">
                      <button onClick={() => setDisputeFor(o)}
                        className="inline-flex items-center gap-1.5 text-[12px] text-rose-600 hover:text-rose-700 bg-transparent border-none cursor-pointer font-semibold font-sans">
                        <Scale size={12} /> Маргаан гаргах
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {disputeFor && (
        <DisputeModal
          order={disputeFor}
          onClose={() => setDisputeFor(null)}
          onCreated={() => { setDisputeFor(null); reload(); }}
        />
      )}
    </BuyerShell>
  );
}
