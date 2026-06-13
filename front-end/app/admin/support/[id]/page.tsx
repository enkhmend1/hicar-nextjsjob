"use client";

/**
 * Admin ticket thread — "/admin/support/[id]".
 *
 * Lives inside the admin layout shell (role-gated there). Fetches
 * GET /support/admin/:id, shows the opener's name/email + relatedOrder link,
 * the same message thread (admin replies right/blue, user left/white), an
 * admin reply composer (POST /support/admin/:id/reply), and a status toggle:
 *   • "Шийдэгдсэн болгох"  → PATCH /support/admin/:id/status {status:"resolved"}
 *   • "Дахин нээх"         → PATCH /support/admin/:id/status {status:"open"}
 *
 * Closed tickets are read-only (no reply, no toggle) — only the user can
 * close, and the backend rejects replies to closed tickets.
 */

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { toast } from "@/app/lib/toast";
import { SupportTicket } from "@/app/types";
import {
  CategoryChip, StatusChip, MessageThread, Composer,
} from "@/app/components/support/shared";
import { ArrowLeft, Loader2, CheckCircle, RotateCcw, Package, Mail, User as UserIcon } from "lucide-react";

export default function AdminTicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const [ticket, setTicket] = useState<SupportTicket | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [toggling, setToggling] = useState(false);

  const load = (showSpinner = true) => {
    if (showSpinner) setLoading(true);
    api.get<{ ticket: SupportTicket }>(`/support/admin/${id}`)
      .then((d) => { setTicket(d.ticket); setNotFound(false); })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect
  useEffect(() => { queueMicrotask(() => load(true)); }, [id]);

  const reply = async (text: string, images: string[]) => {
    try {
      const { ticket } = await api.post<{ ticket: SupportTicket }>(`/support/admin/${id}/reply`, {
        text,
        images: images.length ? images : undefined,
      });
      setTicket(ticket);
    } catch (e) {
      toast.error((e as ApiError).message || "Хариу илгээж чадсангүй");
      throw e; // keep the composer draft on failure
    }
  };

  const setStatus = async (status: "resolved" | "open") => {
    setToggling(true);
    try {
      const { ticket } = await api.patch<{ ticket: SupportTicket }>(`/support/admin/${id}/status`, { status });
      setTicket(ticket);
      toast.success(status === "resolved" ? "Хүсэлтийг шийдэгдсэн болголоо." : "Хүсэлтийг дахин нээлээ.");
    } catch (e) {
      toast.error((e as ApiError).message || "Алдаа гарлаа");
    } finally {
      setToggling(false);
    }
  };

  const name = ticket && typeof ticket.user === "object" ? ticket.user.name : "Хэрэглэгч";
  const email = ticket && typeof ticket.user === "object" ? ticket.user.email : null;
  const isClosed = ticket?.status === "closed";
  const isResolved = ticket?.status === "resolved";

  return (
    <div className="max-w-2xl mx-auto">
      <Link href="/admin/support"
        className="inline-flex items-center gap-1.5 text-[13px] text-gray-500 hover:text-blue-600 transition-colors mb-4">
        <ArrowLeft size={15} /> Бүх хүсэлт
      </Link>

      {loading ? (
        <div className="space-y-3">
          <div className="bg-white border border-gray-200 rounded-2xl h-[110px] animate-pulse" />
          <div className="bg-white border border-gray-200 rounded-2xl h-[280px] animate-pulse" />
        </div>
      ) : notFound || !ticket ? (
        <div className="text-center py-20">
          <p className="text-[15px] font-medium text-gray-700 mb-2">Хүсэлт олдсонгүй.</p>
          <Link href="/admin/support" className="text-[13px] text-blue-600 hover:underline">Бүх хүсэлт рүү буцах</Link>
        </div>
      ) : (
        <>
          {/* Header */}
          <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm mb-4">
            <div className="flex items-start justify-between gap-2">
              <h1 className="text-[16px] font-semibold text-gray-900 leading-snug min-w-0">{ticket.subject}</h1>
              <StatusChip status={ticket.status} forAdmin />
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[12px] text-gray-600">
              <span className="inline-flex items-center gap-1 font-medium text-gray-800">
                <UserIcon size={12} /> {name}
              </span>
              {email && (
                <a href={`mailto:${email}`} className="inline-flex items-center gap-1 hover:text-blue-600">
                  <Mail size={12} /> {email}
                </a>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 mt-2">
              <CategoryChip category={ticket.category} />
              {ticket.relatedOrder && (
                <Link href="/admin/orders"
                  className="inline-flex items-center gap-1 text-[11px] text-blue-600 hover:underline">
                  <Package size={11} /> Холбоотой захиалга
                </Link>
              )}
            </div>

            {!isClosed && (
              <div className="mt-3 pt-3 border-t border-gray-100 flex justify-end">
                {isResolved ? (
                  <button onClick={() => setStatus("open")} disabled={toggling}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold text-gray-600 hover:bg-gray-50 bg-transparent border border-gray-200 cursor-pointer disabled:opacity-50 font-sans">
                    {toggling ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                    Дахин нээх
                  </button>
                ) : (
                  <button onClick={() => setStatus("resolved")} disabled={toggling}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer border-none disabled:opacity-50 font-sans">
                    {toggling ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />}
                    Шийдэгдсэн болгох
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Thread — admin's own replies render right/blue */}
          <div className="mb-4">
            <MessageThread messages={ticket.messages} meAuthor="admin" />
          </div>

          {/* Reply composer */}
          <Composer
            onSend={reply}
            disabled={isClosed}
            disabledNotice="Хэрэглэгч хүсэлтээ хаасан тул хариу бичих боломжгүй."
            placeholder="Хэрэглэгчид хариу бичих..."
            sendLabel="Хариу илгээх"
          />
        </>
      )}
    </div>
  );
}
