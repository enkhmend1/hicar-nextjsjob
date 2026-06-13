"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAuthStore } from "@/store";
import { useNotifications } from "@/app/lib/notifications";
import { Bell, Check, X, ShoppingBag, Package, Store, AlertCircle, Star, MessageSquare, MessageSquareQuote, LifeBuoy } from "lucide-react";

/**
 * NotificationBell — presentational dropdown. Data (items/unread) and the
 * fetch/poll live in the shared `useNotifications` store, driven globally by
 * <NotificationPoller/>; this component only renders + dispatches read/remove.
 *
 * Rendered in multiple places (buyer navbar desktop + mobile, seller & admin
 * layouts). `align` controls which edge the panel opens from so it never runs
 * off-screen: "right" for top-bar/navbar bells, "left" for a left sidebar.
 */

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
  rfq_received: MessageSquareQuote,
  rfq_quoted: MessageSquareQuote,
  rfq_accepted: MessageSquareQuote,
  rfq_declined: MessageSquareQuote,
  support_opened: LifeBuoy,
  support_reply: LifeBuoy,
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
  rfq_received: "text-blue-500 bg-blue-50",
  rfq_quoted: "text-blue-500 bg-blue-50",
  rfq_accepted: "text-emerald-500 bg-emerald-50",
  rfq_declined: "text-red-500 bg-red-50",
  support_opened: "text-amber-500 bg-amber-50",
  support_reply: "text-indigo-500 bg-indigo-50",
};

export default function NotificationBell({ align = "right" }: { align?: "left" | "right" }) {
  const user = useAuthStore((s) => s.user);
  const items = useNotifications((s) => s.items);
  const unread = useNotifications((s) => s.unread);
  const markRead = useNotifications((s) => s.markRead);
  const markAll = useNotifications((s) => s.markAll);
  const remove = useNotifications((s) => s.remove);

  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Click outside to close.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  if (!user) return null;

  const close = () => setOpen(false);
  // Desktop dropdown opens from the bell's side; "left" for sidebar bells so
  // the panel opens inward instead of off-screen.
  const panelPos = align === "left" ? "left-0" : "right-0";

  const header = (
    <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 shrink-0">
      <div className="flex items-center gap-2">
        <span className="text-[15px] md:text-[14px] font-semibold text-gray-900">Мэдэгдэл</span>
        {unread > 0 && <span className="text-[10px] bg-red-50 text-red-600 px-1.5 py-0.5 rounded-full font-medium">{unread} шинэ</span>}
      </div>
      <div className="flex items-center gap-1.5">
        {unread > 0 && (
          <button onClick={markAll}
            className="flex items-center gap-1 text-[12px] md:text-[11px] text-blue-600 hover:text-blue-700 cursor-pointer bg-transparent border-none font-medium px-1 py-1">
            <Check size={12} /> Бүгдийг уншсан
          </button>
        )}
        {/* Explicit close — essential on the mobile sheet. */}
        <button onClick={close} aria-label="Хаах"
          className="md:hidden w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 cursor-pointer bg-transparent border-none">
          <X size={16} />
        </button>
      </div>
    </div>
  );

  const list = (
    <div className="flex-1 overflow-y-auto overscroll-contain">
      {items.length === 0 ? (
              <div className="text-center py-8">
                <Bell size={28} className="mx-auto text-gray-300 mb-2" />
                <p className="text-[12px] text-gray-400">Мэдэгдэл байхгүй</p>
              </div>
            ) : (
              items.map((n) => {
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
                      aria-label="Устгах"
                      className="w-6 h-6 flex items-center justify-center rounded text-gray-300 hover:text-red-500 cursor-pointer bg-transparent border-none shrink-0">
                      <X size={12} />
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
  );

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)}
        className="relative w-9 h-9 flex items-center justify-center rounded-lg text-gray-500 hover:text-blue-600 hover:bg-blue-50 transition-colors cursor-pointer bg-transparent border-none"
        aria-label="Мэдэгдэл" title="Мэдэгдэл">
        <Bell size={18} />
        {unread > 0 && (
          <span className="absolute top-0.5 right-0.5 min-w-[16px] h-4 bg-red-500 text-white text-[9px] rounded-full flex items-center justify-center px-0.5 font-semibold">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* Mobile: full-width bottom sheet (backdrop + slide-up) so the
              list is readable on a phone instead of a cramped dropdown. */}
          <div className="md:hidden fixed inset-0 z-[60]">
            <div className="absolute inset-0 bg-black/40" onClick={close} />
            <div className="absolute inset-x-0 bottom-0 max-h-[85vh] bg-white rounded-t-2xl shadow-2xl flex flex-col overflow-hidden pb-[env(safe-area-inset-bottom)]">
              <div className="mx-auto mt-2 mb-1 h-1 w-10 rounded-full bg-gray-300 shrink-0" />
              {header}
              {list}
            </div>
          </div>
          {/* Desktop: anchored dropdown. */}
          <div className={`hidden md:flex absolute ${panelPos} top-full mt-2 w-[360px] max-h-[70vh] bg-white border border-gray-200 rounded-2xl shadow-xl z-50 flex-col overflow-hidden`}>
            {header}
            {list}
          </div>
        </>
      )}
    </div>
  );
}
