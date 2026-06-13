"use client";

/**
 * Buyer ticket thread — "/support/[id]".
 *
 * Fetches GET /support/:id (must own; the backend clears unreadForUser on
 * read), renders the ticket header (subject + category + status) and the
 * message thread (buyer right/blue, operator left/white, system centered),
 * then a composer at the bottom that POSTs /support/:id/messages and refetches.
 *
 * When status === "closed" the composer is replaced with a notice. A
 * "Хүсэлт хаах" button (confirm-gated) PATCHes /support/:id/close.
 *
 * The id comes from `use(params)` (App Router async params, same as
 * app/shop/[id]/page.tsx). Auth-gate mirrors /rfq.
 */

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import BuyerShell from "@/app/components/BuyerShell";
import { useAuthStore } from "@/store";
import { api, ApiError } from "@/lib/api";
import { toast } from "@/app/lib/toast";
import { SupportTicket } from "@/app/types";
import {
  CategoryChip, StatusChip, MessageThread, Composer,
} from "@/app/components/support/shared";
import { ArrowLeft, Loader2, CheckCircle, Package } from "lucide-react";

export default function BuyerTicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { user, _hasHydrated } = useAuthStore();

  const [ticket, setTicket] = useState<SupportTicket | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [closing, setClosing] = useState(false);

  const load = (showSpinner = true) => {
    if (showSpinner) setLoading(true);
    api.get<{ ticket: SupportTicket }>(`/support/${id}`)
      .then((d) => { setTicket(d.ticket); setNotFound(false); })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!_hasHydrated) return;
    if (!user) { router.push("/auth/login"); return; }
    queueMicrotask(() => load(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, _hasHydrated, id]);

  const sendMessage = async (text: string, images: string[]) => {
    try {
      const { ticket } = await api.post<{ ticket: SupportTicket }>(`/support/${id}/messages`, {
        text,
        images: images.length ? images : undefined,
      });
      setTicket(ticket);
    } catch (e) {
      toast.error((e as ApiError).message || "Зурвас илгээж чадсангүй");
      throw e; // keep the composer's draft on failure
    }
  };

  const closeTicket = async () => {
    if (!confirm("Энэ хүсэлтийг хаах уу? Хаасны дараа шинэ зурвас бичих боломжгүй.")) return;
    setClosing(true);
    try {
      const { ticket } = await api.patch<{ ticket: SupportTicket }>(`/support/${id}/close`, {});
      setTicket(ticket);
      toast.info("Хүсэлт хаагдлаа.");
    } catch (e) {
      toast.error((e as ApiError).message || "Алдаа гарлаа");
    } finally {
      setClosing(false);
    }
  };

  if (!_hasHydrated || !user) return null;

  const isClosed = ticket?.status === "closed";

  return (
    <BuyerShell>
      <div className="max-w-2xl mx-auto px-5 py-5">
        <Link href="/support"
          className="inline-flex items-center gap-1.5 text-[13px] text-gray-500 hover:text-blue-600 transition-colors mb-4">
          <ArrowLeft size={15} /> Бүх хүсэлт
        </Link>

        {loading ? (
          <div className="space-y-3">
            <div className="bg-white border border-gray-200 rounded-2xl h-[80px] animate-pulse" />
            <div className="bg-white border border-gray-200 rounded-2xl h-[280px] animate-pulse" />
          </div>
        ) : notFound || !ticket ? (
          <div className="text-center py-20">
            <p className="text-[15px] font-medium text-gray-700 mb-2">Хүсэлт олдсонгүй.</p>
            <Link href="/support" className="text-[13px] text-blue-600 hover:underline">Бүх хүсэлт рүү буцах</Link>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm mb-4">
              <div className="flex items-start justify-between gap-2">
                <h1 className="text-[16px] font-semibold text-gray-900 leading-snug min-w-0">{ticket.subject}</h1>
                <StatusChip status={ticket.status} />
              </div>
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <CategoryChip category={ticket.category} />
                {ticket.relatedOrder && (
                  <Link href="/orders"
                    className="inline-flex items-center gap-1 text-[11px] text-blue-600 hover:underline">
                    <Package size={11} /> Холбоотой захиалга
                  </Link>
                )}
              </div>
              {!isClosed && ticket.status !== "resolved" && (
                <div className="mt-3 pt-3 border-t border-gray-100 flex justify-end">
                  <button onClick={closeTicket} disabled={closing}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold text-gray-600 hover:bg-gray-50 bg-transparent border border-gray-200 cursor-pointer disabled:opacity-50 font-sans">
                    {closing ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />}
                    Хүсэлт хаах
                  </button>
                </div>
              )}
            </div>

            {/* Thread */}
            <div className="mb-4">
              <MessageThread messages={ticket.messages} meAuthor="user" />
            </div>

            {/* Composer */}
            <Composer
              onSend={sendMessage}
              disabled={isClosed}
              disabledNotice="Энэ хүсэлт хаагдсан тул шинэ зурвас бичих боломжгүй."
              placeholder="Операторт зурвас бичих..."
            />
          </>
        )}
      </div>
    </BuyerShell>
  );
}
