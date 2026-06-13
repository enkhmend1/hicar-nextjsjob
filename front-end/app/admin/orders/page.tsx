"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Order } from "@/app/types";
import { ChevronDown, ChevronUp, ShoppingBag } from "lucide-react";
import {
  PageHeader, Card, FilterTabs, StatusChip, CardSkeletons, EmptyState,
} from "@/app/admin/_components/ui";

const STATUSES = ["pending", "paid", "processing", "shipped", "delivered", "cancelled"] as const;
const STATUS_LABEL: Record<string, string> = {
  pending: "Хүлээгдэж буй", paid: "Төлсөн", processing: "Бэлдэж буй",
  shipped: "Илгээсэн", delivered: "Хүргэгдсэн", cancelled: "Цуцалсан",
};
const STATUS_COLOR: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700 border-amber-200",
  paid: "bg-blue-50 text-blue-700 border-blue-200",
  processing: "bg-blue-50 text-blue-700 border-blue-200",
  shipped: "bg-indigo-50 text-indigo-700 border-indigo-200",
  delivered: "bg-emerald-50 text-emerald-700 border-emerald-200",
  cancelled: "bg-red-50 text-red-700 border-red-200",
};

// Escrow (money) state — orthogonal to the goods `status` above.
const PAYMENT_LABEL: Record<string, string> = {
  PENDING: "Төлбөр хүлээгдэж буй",
  PAID: "Escrow-д хадгалагдсан",
  DISPUTED: "Маргаантай · түгжээтэй",
  PARTIAL_REFUND: "Хэсэгчилсэн буцаалт",
  REFUNDED: "Буцаагдсан",
  PAID_OUT: "Худалдагч руу шилжсэн",
  FAILED: "Төлбөр амжилтгүй",
};
const PAYMENT_COLOR: Record<string, string> = {
  PENDING: "bg-gray-50 text-gray-600 border-gray-200",
  PAID: "bg-amber-50 text-amber-700 border-amber-200",
  DISPUTED: "bg-red-50 text-red-700 border-red-200",
  PARTIAL_REFUND: "bg-orange-50 text-orange-700 border-orange-200",
  REFUNDED: "bg-gray-100 text-gray-600 border-gray-300",
  PAID_OUT: "bg-emerald-50 text-emerald-700 border-emerald-200",
  FAILED: "bg-red-50 text-red-700 border-red-200",
};

export default function AdminOrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [filter, setFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busyEscrow, setBusyEscrow] = useState<string | null>(null);

  const reload = () => {
    setLoading(true);
    const q = filter === "all" ? "" : `?status=${filter}`;
    api.get<{ orders: Order[] }>(`/orders${q}`)
      .then(d => setOrders(d.orders))
      .finally(() => setLoading(false));
  };

  // queueMicrotask defers reload()'s setLoading(true) past the effect
  // commit — React 19 warns on sync setState in effect bodies.
  // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect
  useEffect(() => { queueMicrotask(reload); }, [filter]);

  const updateStatus = async (id: string, status: string) => {
    await api.patch(`/orders/${id}/status`, { status });
    reload();
  };

  const escrowAction = async (id: string, action: "release" | "hold") => {
    if (action === "release" &&
        !confirm("Escrow төлбөрийг худалдагч руу ОДОО шилжүүлэх үү? Энэ үйлдлийг буцаах боломжгүй.")) {
      return;
    }
    setBusyEscrow(id);
    try {
      await api.post(`/orders/${id}/escrow/${action}`, {});
      reload();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusyEscrow(null);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader title="Захиалга" subtitle={`${orders.length} захиалга`} icon={ShoppingBag} />

      <FilterTabs
        value={filter}
        onSelect={setFilter}
        options={(["all", ...STATUSES] as const).map(s => ({
          id: s,
          label: s === "all" ? "Бүгд" : STATUS_LABEL[s],
        }))}
      />

      {loading ? (
        <CardSkeletons count={5} height="h-20" />
      ) : orders.length === 0 ? (
        <Card padded={false}>
          <EmptyState icon={ShoppingBag} title="Захиалга байхгүй" />
        </Card>
      ) : (
        <Card padded={false}>
          <div className="divide-y divide-gray-100">
            {orders.map(o => {
              const id = (o._id ?? o.id) as string;
              const isOpen = expanded === id;
              const userObj = typeof o.user === "object" ? o.user : null;
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
                        <span className="text-[13px] font-medium text-gray-900 truncate">{userObj?.name ?? "—"}</span>
                        <span className="text-[11px] text-gray-400">{userObj?.email ?? ""}</span>
                      </div>
                      <div className="text-[11px] text-gray-400 mt-0.5">
                        {new Date(o.createdAt).toLocaleString("mn-MN")} · {o.paymentMethod.toUpperCase()} · {o.items.length} бараа
                      </div>
                    </div>
                    <div className="text-[14px] font-bold text-blue-600 shrink-0">₮{o.total.toLocaleString()}</div>
                    <select value={o.status} onChange={e => updateStatus(id, e.target.value)}
                      className={`text-[11px] font-medium px-2 py-1 rounded-lg border cursor-pointer outline-none ${STATUS_COLOR[o.status]}`}>
                      {STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                    </select>
                  </div>

                  {/* Escrow (money) row — status, held amount, release timing
                      + admin manual Release / Hold overrides. */}
                  {o.paymentStatus && (
                    <div className="flex flex-wrap items-center gap-2 mt-2 ml-10 text-[11px]">
                      <StatusChip color={PAYMENT_COLOR[o.paymentStatus] ?? "bg-gray-50 text-gray-600 border-gray-200"}>
                        🛡 {PAYMENT_LABEL[o.paymentStatus] ?? o.paymentStatus}
                      </StatusChip>
                      {(o.escrowAmount ?? 0) > 0 && o.paymentStatus !== "PAID_OUT" && (
                        <span className="text-gray-500">Дүн: <b className="text-gray-700">₮{o.escrowAmount!.toLocaleString()}</b></span>
                      )}
                      {o.paymentStatus !== "PAID_OUT" && o.escrowReleaseScheduledAt && (
                        <span className="text-gray-400">Release: {new Date(o.escrowReleaseScheduledAt).toLocaleDateString("mn-MN")}</span>
                      )}
                      {o.paymentStatus === "PAID_OUT" && o.escrowReleasedAt && (
                        <span className="text-gray-400">Шилжсэн: {new Date(o.escrowReleasedAt).toLocaleDateString("mn-MN")}</span>
                      )}
                      {["PAID", "PARTIAL_REFUND"].includes(o.paymentStatus) && !o.hasOpenDispute && (
                        <span className="flex items-center gap-1.5 ml-auto">
                          <button onClick={() => escrowAction(id, "release")} disabled={busyEscrow === id}
                            className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer border-none transition-colors">
                            Release
                          </button>
                          {o.escrowReleaseScheduledAt && (
                            <button onClick={() => escrowAction(id, "hold")} disabled={busyEscrow === id}
                              className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-white text-amber-700 border border-amber-300 hover:bg-amber-50 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors">
                              Hold
                            </button>
                          )}
                        </span>
                      )}
                    </div>
                  )}

                  {isOpen && (
                    <div className="mt-3 ml-10 pt-3 border-t border-gray-100 space-y-2">
                      <div className="text-[12px] text-gray-500">
                        <span className="text-gray-400">Хаяг:</span> {o.address}
                      </div>
                      <div className="text-[12px] text-gray-500">
                        <span className="text-gray-400">Утас:</span> {o.phone}
                      </div>
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
        </Card>
      )}
    </div>
  );
}
