"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store";
import { Bell, Check, X, ShoppingBag, Package, Store, AlertCircle, Star, MessageSquare } from "lucide-react";

interface Notif {
  _id: string;
  type: string;
  title: string;
  body: string;
  link: string;
  read: boolean;
  createdAt: string;
}

const ICON: Record<string, typeof Bell> = {
  order_placed: ShoppingBag,
  order_status_changed: ShoppingBag,
  payment_received: ShoppingBag,
  seller_application: Store,
  seller_approved: Store,
  seller_rejected: Store,
  product_pending: Package,
  product_approved: Package,
  product_rejected: Package,
  low_stock: AlertCircle,
  review_received: Star,
  system: MessageSquare,
};

const COLOR: Record<string, string> = {
  order_placed: "text-blue-500 bg-blue-50",
  order_status_changed: "text-blue-500 bg-blue-50",
  payment_received: "text-emerald-500 bg-emerald-50",
  seller_application: "text-amber-500 bg-amber-50",
  seller_approved: "text-emerald-500 bg-emerald-50",
  seller_rejected: "text-red-500 bg-red-50",
  product_pending: "text-amber-500 bg-amber-50",
  product_approved: "text-emerald-500 bg-emerald-50",
  product_rejected: "text-red-500 bg-red-50",
  low_stock: "text-orange-500 bg-orange-50",
  review_received: "text-amber-500 bg-amber-50",
  system: "text-gray-500 bg-gray-50",
};

export default function NotificationBell() {
  const user = useAuthStore(s => s.user);
  const [items, setItems] = useState<Notif[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = async () => {
    try {
      const { items, unreadCount } = await api.get<{ items: Notif[]; unreadCount: number }>("/notifications?limit=20");
      setItems(items);
      setUnread(unreadCount);
    } catch { /* ignore */ }
  };

  // Poll every 30s when user is logged in.
  useEffect(() => {
    if (!user) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setItems([]);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setUnread(0);
      return;
    }
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Click outside to close
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  if (!user) return null;

  const markRead = async (id: string) => {
    setItems(prev => prev.map(n => n._id === id ? { ...n, read: true } : n));
    setUnread(u => Math.max(0, u - 1));
    try { await api.patch(`/notifications/${id}/read`); } catch {}
  };
  const markAll = async () => {
    setItems(prev => prev.map(n => ({ ...n, read: true })));
    setUnread(0);
    try { await api.patch("/notifications/read-all"); } catch {}
  };
  const remove = async (id: string) => {
    setItems(prev => prev.filter(n => n._id !== id));
    try { await api.delete(`/notifications/${id}`); } catch {}
  };

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(o => !o)}
        className="relative w-9 h-9 flex items-center justify-center rounded-lg text-gray-500 hover:text-blue-600 hover:bg-blue-50 transition-colors cursor-pointer bg-transparent border-none"
        title="Notifications">
        <Bell size={18} />
        {unread > 0 && (
          <span className="absolute top-0.5 right-0.5 min-w-[16px] h-4 bg-red-500 text-white text-[9px] rounded-full flex items-center justify-center px-0.5 font-semibold">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-[340px] max-h-[480px] bg-white border border-gray-200 rounded-2xl shadow-xl z-50 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <span className="text-[14px] font-semibold text-gray-900">Мэдэгдэл</span>
              {unread > 0 && <span className="text-[10px] bg-red-50 text-red-600 px-1.5 py-0.5 rounded-full font-medium">{unread} шинэ</span>}
            </div>
            {unread > 0 && (
              <button onClick={markAll}
                className="flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-700 cursor-pointer bg-transparent border-none font-medium">
                <Check size={11} /> Бүгдийг уншсан
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto">
            {items.length === 0 ? (
              <div className="text-center py-8">
                <Bell size={28} className="mx-auto text-gray-300 mb-2" />
                <p className="text-[12px] text-gray-400">Мэдэгдэл байхгүй</p>
              </div>
            ) : (
              items.map(n => {
                const Icon = ICON[n.type] ?? Bell;
                const color = COLOR[n.type] ?? "text-gray-500 bg-gray-50";
                const Inner = (
                  <div className="flex items-start gap-3 p-3 hover:bg-gray-50 transition-colors">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${color}`}>
                      <Icon size={14} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-medium text-gray-900 line-clamp-1">{n.title}</div>
                      <div className="text-[12px] text-gray-500 line-clamp-2">{n.body}</div>
                      <div className="text-[10px] text-gray-400 mt-0.5">{new Date(n.createdAt).toLocaleString("mn-MN")}</div>
                    </div>
                    {!n.read && <span className="w-2 h-2 bg-blue-500 rounded-full shrink-0 mt-1.5" />}
                    <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); remove(n._id); }}
                      className="w-5 h-5 flex items-center justify-center rounded text-gray-300 hover:text-red-500 cursor-pointer bg-transparent border-none shrink-0">
                      <X size={11} />
                    </button>
                  </div>
                );
                return n.link ? (
                  <Link key={n._id} href={n.link} onClick={() => { setOpen(false); if (!n.read) markRead(n._id); }}
                    className="block border-b border-gray-100 last:border-0">
                    {Inner}
                  </Link>
                ) : (
                  <div key={n._id} onClick={() => !n.read && markRead(n._id)} className="border-b border-gray-100 last:border-0 cursor-pointer">
                    {Inner}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
