"use client";

/**
 * Admin support inbox — "Тусламжийн хүсэлт".
 *
 * Renders inside the admin layout shell (sidebar from app/admin/layout.tsx,
 * which already gates on role === "admin"). Fetches GET /support/admin
 * (user populated to {name,email}) with status filter tabs:
 *   Бүгд · Хариу хүлээж буй (awaiting_admin) · Таны хариулсан (awaiting_user)
 *   · Шийдэгдсэн (resolved) · Хаагдсан (closed)
 *
 * The "Хариу хүлээж буй" tab carries an unread badge counting tickets with
 * unreadForAdmin. Each row shows the opener's name/email, subject, category +
 * status chips, last-message preview + time, and an unread dot. Click → the
 * admin thread at /admin/support/[id].
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { SupportStatus, SupportTicket } from "@/app/types";
import {
  CategoryChip, StatusChip, relTime,
} from "@/app/components/support/shared";
import { Headset, Circle, ChevronRight, User as UserIcon } from "lucide-react";
import {
  PageHeader, FilterTabs, CardSkeletons, EmptyState,
} from "@/app/admin/_components/ui";

type Filter = "all" | "awaiting_admin" | "awaiting_user" | "resolved" | "closed";

const TABS: Array<{ id: Filter; label: string }> = [
  { id: "all",            label: "Бүгд" },
  { id: "awaiting_admin", label: "Хариу хүлээж буй" },
  { id: "awaiting_user",  label: "Таны хариулсан" },
  { id: "resolved",       label: "Шийдэгдсэн" },
  { id: "closed",         label: "Хаагдсан" },
];

const openerName = (t: SupportTicket): string =>
  typeof t.user === "object" && t.user ? t.user.name : "Хэрэглэгч";
const openerEmail = (t: SupportTicket): string | null =>
  typeof t.user === "object" && t.user ? t.user.email : null;

const lastPreview = (t: SupportTicket): string => {
  const last = t.messages?.[t.messages.length - 1];
  if (!last) return "Зурвас алга";
  if (last.text) return last.text;
  if (last.images?.length) return "📎 Зураг хавсаргав";
  return "—";
};

export default function AdminSupportPage() {
  const router = useRouter();
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");

  const reload = useCallback(async () => {
    setLoading(true);
    // The backend filters by status; "all" omits the query param.
    const q = filter === "all" ? "" : `?status=${filter}`;
    try {
      const { tickets } = await api.get<{ tickets: SupportTicket[] }>(`/support/admin${q}`);
      setTickets(tickets);
    } catch {
      setTickets([]);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect
  useEffect(() => { queueMicrotask(reload); }, [filter]);

  // Unread count is only reliable on the "all" view; on a filtered view we
  // still surface the unread dots per row, but the tab badge counts whatever
  // is currently loaded that is awaiting the admin + unread.
  const unreadCount = useMemo(
    () => tickets.filter((t) => t.unreadForAdmin).length,
    [tickets],
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Тусламжийн хүсэлт"
        icon={Headset}
        subtitle={
          <>
            {tickets.length} хүсэлт
            {unreadCount > 0 && <span className="text-amber-600 font-medium"> · {unreadCount} уншаагүй</span>}
          </>
        }
      />

      {/* Filter tabs */}
      <FilterTabs
        value={filter}
        onSelect={setFilter}
        options={TABS.map((t) => ({
          id: t.id,
          label: t.label,
          badge:
            t.id === "awaiting_admin" && unreadCount > 0 && filter !== "awaiting_admin"
              ? unreadCount
              : undefined,
        }))}
      />

      {loading ? (
        <CardSkeletons count={4} height="h-[96px]" />
      ) : tickets.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-2xl">
          <EmptyState
            icon={Headset}
            title="Хүсэлт алга."
            description="Хэрэглэгч тусламж хүсмэгц энд харагдана."
          />
        </div>
      ) : (
        <div className="space-y-3">
          {tickets.map((t) => {
            const email = openerEmail(t);
            return (
              <button
                key={t._id}
                onClick={() => router.push(`/admin/support/${t._id}`)}
                className="w-full text-left bg-white border border-gray-200 rounded-2xl p-4 shadow-sm hover:border-blue-300 transition-colors cursor-pointer font-sans block"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {t.unreadForAdmin && (
                      <Circle size={8} className="fill-amber-500 text-amber-500 shrink-0" />
                    )}
                    <div className="text-[14px] font-semibold text-gray-900 leading-snug line-clamp-1">{t.subject}</div>
                  </div>
                  <StatusChip status={t.status} forAdmin />
                </div>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-[11px] text-gray-500">
                  <span className="inline-flex items-center gap-1 font-medium text-gray-700">
                    <UserIcon size={11} /> {openerName(t)}
                  </span>
                  {email && <span className="truncate">{email}</span>}
                </div>

                <div className="flex items-center gap-2 mt-1.5">
                  <CategoryChip category={t.category} />
                  <span className="text-[11px] text-gray-400">{relTime(t.lastMessageAt)}</span>
                </div>

                <div className="flex items-center gap-2 mt-2">
                  <p className="text-[12px] text-gray-500 line-clamp-1 flex-1 min-w-0">{lastPreview(t)}</p>
                  <ChevronRight size={15} className="text-gray-300 shrink-0" />
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
