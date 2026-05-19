"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Order } from "@/app/types";
import { ChevronDown, ChevronUp } from "lucide-react";

const STATUS_LABEL: Record<string, string> = {
  pending: "Хүлээгдэж буй", paid: "Төлсөн", processing: "Бэлдэж буй",
  shipped: "Илгээсэн", delivered: "Хүргэгдсэн", cancelled: "Цуцалсан",
};
const STATUS_COLOR: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700",
  paid: "bg-blue-50 text-blue-700",
  processing: "bg-violet-50 text-violet-700",
  shipped: "bg-indigo-50 text-indigo-700",
  delivered: "bg-emerald-50 text-emerald-700",
  cancelled: "bg-red-50 text-red-700",
};

export default function SellerOrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ orders: Order[] }>("/seller/orders")
      .then(d => setOrders(d.orders))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[22px] font-semibold text-gray-900">Захиалга</h1>
        <p className="text-[13px] text-gray-500">{orders.length} захиалга</p>
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-400 text-[13px]">Уншиж байна...</div>
        ) : orders.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-[13px]">Захиалга байхгүй</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {orders.map(o => {
              const id = (o._id ?? o.id) as string;
              const isOpen = expanded === id;
              const userObj = (o.user && typeof o.user === "object") ? o.user : null;
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
                    <div className="text-[14px] font-bold text-fuchsia-600 shrink-0">₮{o.total.toLocaleString()}</div>
                    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${STATUS_COLOR[o.status]}`}>
                      {STATUS_LABEL[o.status]}
                    </span>
                  </div>

                  {isOpen && (
                    <div className="mt-3 ml-10 pt-3 border-t border-gray-100 space-y-2">
                      <div className="text-[12px] text-gray-500"><span className="text-gray-400">Хаяг:</span> {o.address}</div>
                      <div className="text-[12px] text-gray-500"><span className="text-gray-400">Утас:</span> {o.phone}</div>
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
