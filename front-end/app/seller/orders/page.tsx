/**
 * Seller orders page — Phase AQ.4 upgrade.
 *
 * Adds the missing operational primitives a real seller needs:
 *   • Status filter chips (Бүгд / Төлсөн / Бэлдэж буй / Илгээсэн / ...)
 *   • Per-order status update buttons that respect the state machine
 *     (paid → processing → shipped). Delivered is set by the BUYER on
 *     /orders so the escrow release flows from buyer confirmation.
 *   • Tracking number input shown when seller is transitioning to shipped
 *   • OrderTimeline so the seller sees what the buyer sees
 *
 * Wire shape: PATCH /api/seller/orders/:id/status — body
 *   { status: "processing" | "shipped", trackingNumber?: string }
 */
"use client";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { Order } from "@/app/types";
import { ChevronDown, ChevronUp, Truck, PackageCheck, Loader2 } from "lucide-react";
import OrderTimeline from "@/app/components/OrderTimeline";

const STATUS_LABEL: Record<string, string> = {
  pending: "Хүлээгдэж буй", paid: "Төлсөн", processing: "Бэлдэж буй",
  shipped: "Илгээсэн", delivered: "Хүргэгдсэн", cancelled: "Цуцалсан",
};
const STATUS_COLOR: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700",
  paid: "bg-blue-50 text-blue-700",
  processing: "bg-blue-50 text-blue-700",
  shipped: "bg-indigo-50 text-indigo-700",
  delivered: "bg-emerald-50 text-emerald-700",
  cancelled: "bg-red-50 text-red-700",
};

// Escrow/payout state badge — tells the seller whether their money is
// being held, has been released, or is locked by a dispute.
const PAYOUT_BADGE: Record<string, { label: string; cls: string }> = {
  PAID:           { label: "Escrow-д хадгалагдсан", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  PARTIAL_REFUND: { label: "Хэсэгчилсэн буцаалт",   cls: "bg-orange-50 text-orange-700 border-orange-200" },
  PAID_OUT:       { label: "Төлбөр шилжсэн",         cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  DISPUTED:       { label: "Маргаантай",             cls: "bg-red-50 text-red-700 border-red-200" },
  REFUNDED:       { label: "Буцаагдсан",             cls: "bg-gray-100 text-gray-600 border-gray-300" },
};

const FILTERS: Array<{ key: "all" | Order["status"]; label: string }> = [
  { key: "all",        label: "Бүгд" },
  { key: "paid",       label: "Шинэ" },
  { key: "processing", label: "Бэлдэж буй" },
  { key: "shipped",    label: "Илгээсэн" },
  { key: "delivered",  label: "Дууссан" },
];

export default function SellerOrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | Order["status"]>("all");
  /** Tracking-number draft per orderId, only used while shipping. */
  const [trackingDraft, setTrackingDraft] = useState<Record<string, string>>({});
  /** Per-order action busy flag — disables buttons during PATCH. */
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const load = async () => {
    setLoading(true);
    try {
      const { orders } = await api.get<{ orders: Order[] }>("/seller/orders");
      setOrders(orders);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const visible = useMemo(() => {
    if (filter === "all") return orders;
    return orders.filter((o) => o.status === filter);
  }, [orders, filter]);

  /** Per-status counts so chip labels can show how many are waiting. */
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: orders.length };
    for (const o of orders) c[o.status] = (c[o.status] || 0) + 1;
    return c;
  }, [orders]);

  const updateStatus = async (orderId: string, status: "processing" | "shipped") => {
    setBusy((b) => ({ ...b, [orderId]: true }));
    try {
      const body: Record<string, unknown> = { status };
      if (status === "shipped") {
        const trk = (trackingDraft[orderId] || "").trim();
        if (trk) body.trackingNumber = trk;
      }
      await api.patch(`/seller/orders/${orderId}/status`, body);
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Алдаа гарлаа";
      alert(msg);
    } finally {
      setBusy((b) => ({ ...b, [orderId]: false }));
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[22px] font-semibold text-gray-900">Захиалга</h1>
        <p className="text-[13px] text-gray-500">{orders.length} захиалга</p>
      </div>

      {/* Status filter chips */}
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const n = counts[f.key] || 0;
          const active = filter === f.key;
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-3 py-1.5 rounded-full text-[12px] font-medium border transition-colors cursor-pointer ${
                active
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white text-gray-600 border-gray-200 hover:border-blue-400 hover:text-blue-600"
              }`}
            >
              {f.label}
              {n > 0 && (
                <span className={`ml-1.5 text-[10px] ${active ? "text-blue-100" : "text-gray-400"}`}>
                  {n}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-400 text-[13px]">Уншиж байна...</div>
        ) : visible.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-[13px]">
            {filter === "all" ? "Захиалга байхгүй" : "Энэ ангилалд захиалга алга"}
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {visible.map((o) => {
              const id = (o._id ?? o.id) as string;
              const isOpen = expanded === id;
              const userObj = (o.user && typeof o.user === "object") ? o.user : null;
              const canStart = o.status === "paid";
              const canShip  = o.status === "processing";
              const isBusy   = !!busy[id];

              return (
                <div key={id} className="p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <button onClick={() => setExpanded(isOpen ? null : id)}
                      className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 cursor-pointer bg-transparent border-none shrink-0">
                      {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[12px] text-gray-400 font-mono">#{id.slice(-8).toUpperCase()}</span>
                        <span className="text-[13px] font-medium text-gray-900 truncate">{userObj?.name ?? "(устгагдсан)"}</span>
                      </div>
                      <div className="text-[11px] text-gray-400 mt-0.5">
                        {new Date(o.createdAt).toLocaleString("mn-MN")} · {o.paymentMethod.toUpperCase()} · {o.items.length} бараа
                      </div>
                    </div>
                    <div className="text-[14px] font-bold text-amber-600 shrink-0">₮{o.total.toLocaleString()}</div>
                    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${STATUS_COLOR[o.status]}`}>
                      {STATUS_LABEL[o.status]}
                    </span>
                    {o.paymentStatus && PAYOUT_BADGE[o.paymentStatus] && (
                      <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${PAYOUT_BADGE[o.paymentStatus].cls}`}>
                        🛡 {PAYOUT_BADGE[o.paymentStatus].label}
                      </span>
                    )}
                  </div>

                  {/* Inline action buttons (visible without expanding) */}
                  {(canStart || canShip) && (
                    <div className="mt-3 ml-10 flex items-center gap-2 flex-wrap">
                      {canStart && (
                        <button
                          onClick={() => updateStatus(id, "processing")}
                          disabled={isBusy}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer border-none"
                        >
                          {isBusy ? <Loader2 size={12} className="animate-spin" /> : <PackageCheck size={12} />}
                          Бэлдэж эхлэх
                        </button>
                      )}
                      {canShip && (
                        <>
                          <input
                            type="text"
                            placeholder="Хяналтын код (заавал биш)"
                            value={trackingDraft[id] || ""}
                            onChange={(e) => setTrackingDraft((d) => ({ ...d, [id]: e.target.value }))}
                            className="px-3 py-1.5 rounded-lg border border-gray-200 text-[12px] focus:outline-none focus:border-blue-400 w-48"
                          />
                          <button
                            onClick={() => updateStatus(id, "shipped")}
                            disabled={isBusy}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer border-none"
                          >
                            {isBusy ? <Loader2 size={12} className="animate-spin" /> : <Truck size={12} />}
                            Илгээх
                          </button>
                        </>
                      )}
                    </div>
                  )}

                  {isOpen && (
                    <div className="mt-3 ml-10 pt-3 border-t border-gray-100 space-y-3">
                      {/* Visual timeline */}
                      <OrderTimeline status={o.status} compact />

                      <div className="text-[12px] text-gray-500"><span className="text-gray-400">Хаяг:</span> {o.address}</div>
                      <div className="text-[12px] text-gray-500"><span className="text-gray-400">Утас:</span> {o.phone}</div>
                      {o.trackingNumber && (
                        <div className="text-[12px] text-gray-500">
                          <span className="text-gray-400">Хяналтын код:</span>{" "}
                          <span className="font-mono text-gray-700">{o.trackingNumber}</span>
                        </div>
                      )}
                      <div className="bg-gray-50 rounded-lg p-3 space-y-1.5">
                        {(o.items as { name: string; oem: string; quantity: number; price: number; deliveryType: string }[]).map((i, idx) => (
                          <div key={idx} className="flex justify-between text-[12px]">
                            <div className="min-w-0 flex-1 mr-3">
                              <div className="text-gray-700 truncate">{i.name}</div>
                              <div className="text-gray-400 text-[10px] font-mono">{i.oem} · {i.deliveryType}</div>
                            </div>
                            <div className="text-gray-600 shrink-0">×{i.quantity} = ₮{(i.price * i.quantity).toLocaleString()}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
