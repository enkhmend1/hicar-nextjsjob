"use client";

/**
 * Buyer support inbox — "Тусламж / Оператор".
 *
 * Lists the buyer's own tickets (GET /support/mine, newest by lastMessageAt)
 * as cards: subject, category + status chip, last-message preview + relative
 * time, and an unread dot when unreadForUser. Tapping a card opens the thread
 * at /support/[id].
 *
 * A "Шинэ хүсэлт" button reveals an inline compose form (subject + category +
 * optional first message + optional image attach) → POST /support → on success
 * we route straight into the new ticket's thread.
 *
 * Auth-gated exactly like /rfq: wait for the persisted auth store to hydrate,
 * then redirect guests to /auth/login.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import BuyerShell from "@/app/components/BuyerShell";
import { useAuthStore } from "@/store";
import { api, ApiError } from "@/lib/api";
import { toast } from "@/app/lib/toast";
import { SupportCategory, SupportTicket } from "@/app/types";
import {
  CATEGORY_OPTIONS, CategoryChip, StatusChip, relTime,
} from "@/app/components/support/shared";
import {
  Headset, Plus, X, Loader2, MessageSquare, ChevronRight, Circle, Upload,
} from "lucide-react";

/** Last message text for the card preview, falling back gracefully. */
const lastPreview = (t: SupportTicket): string => {
  const last = t.messages?.[t.messages.length - 1];
  if (!last) return "Зурвас алга";
  if (last.text) return last.text;
  if (last.images?.length) return "📎 Зураг хавсаргав";
  return "—";
};

export default function BuyerSupportPage() {
  const router = useRouter();
  const { user, _hasHydrated } = useAuthStore();
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);

  // Compose form state.
  const [composing, setComposing] = useState(false);
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState<SupportCategory>("order");
  const [message, setMessage] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState("");

  const reload = () => {
    setLoading(true);
    api.get<{ tickets: SupportTicket[] }>("/support/mine")
      .then((d) => setTickets(d.tickets))
      .catch(() => setTickets([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!_hasHydrated) return;
    if (!user) { router.push("/auth/login"); return; }
    queueMicrotask(reload);
  }, [user, router, _hasHydrated]);

  const create = async () => {
    setErr("");
    const subj = subject.trim();
    if (subj.length < 3) { setErr("Гарчгийг 3-аас дээш тэмдэгтээр бичнэ үү."); return; }
    setCreating(true);
    try {
      const { ticket } = await api.post<{ ticket: SupportTicket }>("/support", {
        subject: subj,
        category,
        message: message.trim() || undefined,
        images: images.length ? images : undefined,
      });
      toast.success("Хүсэлт үүсгэгдлээ.");
      router.push(`/support/${ticket._id}`);
    } catch (e) {
      setErr((e as ApiError).message || "Алдаа гарлаа");
      setCreating(false);
    }
  };

  if (!_hasHydrated || !user) return null;

  return (
    <BuyerShell>
      <div className="max-w-2xl mx-auto px-5 py-5">
        <div className="flex items-center justify-between gap-2 mb-5">
          <div className="flex items-center gap-2 min-w-0">
            <Headset size={20} className="text-blue-600 shrink-0" />
            <h1 className="text-[20px] font-semibold text-gray-900 truncate">Тусламж / Оператор</h1>
          </div>
          {!composing && (
            <button onClick={() => setComposing(true)}
              className="inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl px-3.5 py-2 text-[13px] font-semibold cursor-pointer border-none transition-colors shrink-0">
              <Plus size={15} /> Шинэ хүсэлт
            </button>
          )}
        </div>

        {/* Compose form */}
        {composing && (
          <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm mb-5">
            <div className="flex items-center justify-between mb-3">
              <div className="text-[14px] font-semibold text-gray-900">Шинэ хүсэлт</div>
              <button onClick={() => { setComposing(false); setErr(""); }}
                className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 cursor-pointer bg-transparent border-none">
                <X size={15} />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-[12px] font-medium text-gray-700 mb-1.5">Гарчиг</label>
                <input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  maxLength={150}
                  placeholder="Жнь: Захиалга минь ирэхгүй байна"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[16px] md:text-[13px] focus:border-blue-500 outline-none transition-colors"
                />
              </div>

              <div>
                <label className="block text-[12px] font-medium text-gray-700 mb-1.5">Ангилал</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as SupportCategory)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[16px] md:text-[13px] focus:border-blue-500 outline-none transition-colors bg-white"
                >
                  {CATEGORY_OPTIONS.map((c) => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[12px] font-medium text-gray-700 mb-1.5">Тайлбар (заавал биш)</label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={4}
                  maxLength={4000}
                  placeholder="Асуудлаа дэлгэрэнгүй бичвэл оператор хурдан тусална."
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[16px] md:text-[13px] focus:border-blue-500 outline-none resize-none transition-colors font-sans"
                />
              </div>

              <ImageAttach images={images} setImages={setImages} />

              {err && (
                <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-2.5 text-[12px]">{err}</div>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <button onClick={() => { setComposing(false); setErr(""); }}
                  className="bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg px-4 py-2 text-[13px] font-semibold cursor-pointer border-none transition-colors font-sans">
                  Болих
                </button>
                <button onClick={create} disabled={creating}
                  className="inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg px-4 py-2 text-[13px] font-semibold cursor-pointer border-none transition-colors font-sans">
                  {creating && <Loader2 size={13} className="animate-spin" />} Илгээх
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Ticket list */}
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="bg-white border border-gray-200 rounded-2xl h-[96px] animate-pulse" />
            ))}
          </div>
        ) : tickets.length === 0 ? (
          !composing && (
            <div className="text-center py-16">
              <div className="w-20 h-20 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <MessageSquare size={36} className="text-gray-300" />
              </div>
              <p className="text-[15px] font-medium text-gray-700 mb-2">Тусламжийн хүсэлт алга.</p>
              <p className="text-[13px] text-gray-500 mb-4">Асуудал гарвал оператортой шууд чатлаарай.</p>
              <button onClick={() => setComposing(true)}
                className="inline-flex items-center gap-1.5 bg-blue-600 text-white rounded-xl px-5 py-2.5 text-[13px] font-semibold cursor-pointer border-none">
                <Plus size={15} /> Шинэ хүсэлт
              </button>
            </div>
          )
        ) : (
          <div className="space-y-3">
            {tickets.map((t) => (
              <button
                key={t._id}
                onClick={() => router.push(`/support/${t._id}`)}
                className="w-full text-left bg-white border border-gray-200 rounded-2xl p-4 shadow-sm hover:border-blue-300 transition-colors cursor-pointer font-sans block"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {t.unreadForUser && (
                      <Circle size={8} className="fill-blue-600 text-blue-600 shrink-0" />
                    )}
                    <div className="text-[14px] font-semibold text-gray-900 leading-snug line-clamp-1">{t.subject}</div>
                  </div>
                  <StatusChip status={t.status} />
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
            ))}
          </div>
        )}
      </div>
    </BuyerShell>
  );
}

/**
 * Small inline image picker for the compose form — mirrors DisputeModal's
 * tile grid but uses the api.uploadImage helper.
 */
function ImageAttach({
  images, setImages,
}: { images: string[]; setImages: (fn: (prev: string[]) => string[]) => void }) {
  const [uploading, setUploading] = useState(false);

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      const uploaded = await Promise.all(
        Array.from(files).slice(0, 6 - images.length).map(async (file) => {
          const { url } = await api.uploadImage(file);
          return url;
        }),
      );
      setImages((prev) => [...prev, ...uploaded.filter(Boolean)]);
    } catch (e) {
      toast.error((e as ApiError).message || "Зураг байршуулж чадсангүй");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <label className="block text-[12px] font-medium text-gray-700 mb-1.5">Зураг хавсаргах (заавал биш)</label>
      <div className="flex flex-wrap gap-2">
        {images.map((url, i) => (
          <div key={i} className="relative w-16 h-16 rounded-lg overflow-hidden border border-gray-200">
            <Image src={url} alt="" fill sizes="64px" className="object-cover" unoptimized />
            <button onClick={() => setImages((prev) => prev.filter((_, idx) => idx !== i))}
              className="absolute top-0.5 right-0.5 w-5 h-5 bg-black/60 text-white rounded-full flex items-center justify-center cursor-pointer border-none">
              <X size={10} />
            </button>
          </div>
        ))}
        {images.length < 6 && (
          <label className={`w-16 h-16 border-2 border-dashed rounded-lg flex flex-col items-center justify-center cursor-pointer transition-colors ${
            uploading ? "border-blue-300 bg-blue-50" : "border-gray-300 hover:border-blue-400"
          }`}>
            <input type="file" accept="image/*" multiple className="hidden"
              onChange={(e) => onFiles(e.target.files)} disabled={uploading} />
            {uploading ? <Loader2 size={15} className="animate-spin text-blue-500" /> : <Upload size={15} className="text-gray-400" />}
          </label>
        )}
      </div>
    </div>
  );
}
