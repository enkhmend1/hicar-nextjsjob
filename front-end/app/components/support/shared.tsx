"use client";

/**
 * Shared support-helpdesk UI primitives, reused by both the buyer
 * (`/support`) and admin (`/admin/support`) surfaces:
 *
 *   • Category / status label + chip metadata (Mongolian Cyrillic)
 *   • <StatusChip> / <CategoryChip> — small rounded pills
 *   • <MessageThread> — the bubble list (user right/blue, admin left/white
 *     with an "Оператор" tag, system centered/gray) with image rendering,
 *     localized timestamps, and auto-scroll to the latest message
 *   • <Composer> — textarea + optional image attach + send button, the
 *     identical input used by buyer messages and admin replies
 *
 * The admin status label for `awaiting_user` differs from the buyer's
 * (operator's perspective), so the label lookup takes a `forAdmin` flag.
 */

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { api, ApiError } from "@/lib/api";
import { SupportCategory, SupportMessage, SupportStatus } from "@/app/types";
import { Loader2, Send, Upload, X, Headset } from "lucide-react";

// ── Category metadata ──────────────────────────────────────────────
export const CATEGORY_META: Record<SupportCategory, { label: string; cls: string }> = {
  order:    { label: "Захиалга",   cls: "bg-blue-50 text-blue-700 border-blue-200" },
  payment:  { label: "Төлбөр",     cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  delivery: { label: "Хүргэлт",    cls: "bg-amber-50 text-amber-700 border-amber-200" },
  account:  { label: "Данс",       cls: "bg-indigo-50 text-indigo-700 border-indigo-200" },
  seller:   { label: "Худалдагч",  cls: "bg-rose-50 text-rose-700 border-rose-200" },
  other:    { label: "Бусад",      cls: "bg-gray-100 text-gray-600 border-gray-200" },
};

export const CATEGORY_OPTIONS: Array<{ id: SupportCategory; label: string }> = (
  Object.keys(CATEGORY_META) as SupportCategory[]
).map((id) => ({ id, label: CATEGORY_META[id].label }));

// ── Status metadata ────────────────────────────────────────────────
const STATUS_CLS: Record<SupportStatus, string> = {
  open:           "bg-blue-50 text-blue-700 border-blue-200",
  awaiting_admin: "bg-amber-50 text-amber-700 border-amber-200",
  awaiting_user:  "bg-indigo-50 text-indigo-700 border-indigo-200",
  resolved:       "bg-emerald-50 text-emerald-700 border-emerald-200",
  closed:         "bg-gray-100 text-gray-600 border-gray-200",
};

/** Buyer-facing label; pass forAdmin to get the operator's wording. */
export const statusLabel = (s: SupportStatus, forAdmin = false): string => {
  switch (s) {
    case "open":           return "Нээлттэй";
    case "awaiting_admin": return "Хариу хүлээж буй";
    case "awaiting_user":  return forAdmin ? "Хэрэглэгчийн хариу хүлээж буй" : "Таны хариу хүлээж буй";
    case "resolved":       return "Шийдэгдсэн";
    case "closed":         return "Хаагдсан";
    default:               return s;
  }
};

export function StatusChip({ status, forAdmin = false }: { status: SupportStatus; forAdmin?: boolean }) {
  return (
    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border shrink-0 ${STATUS_CLS[status] ?? "bg-gray-100 text-gray-600 border-gray-200"}`}>
      {statusLabel(status, forAdmin)}
    </span>
  );
}

export function CategoryChip({ category }: { category: SupportCategory }) {
  const meta = CATEGORY_META[category] ?? CATEGORY_META.other;
  return (
    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border shrink-0 ${meta.cls}`}>
      {meta.label}
    </span>
  );
}

// ── Time formatting ────────────────────────────────────────────────
const RTF = new Intl.RelativeTimeFormat("mn", { numeric: "auto" });
const REL_STEPS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 31536000],
  ["month", 2592000],
  ["day", 86400],
  ["hour", 3600],
  ["minute", 60],
];
/** Relative time, e.g. "2 цагийн өмнө". Falls back to "саяхан". */
export const relTime = (iso?: string): string => {
  if (!iso) return "—";
  const diffSec = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diffSec);
  for (const [unit, secs] of REL_STEPS) {
    if (abs >= secs) return RTF.format(Math.round(diffSec / secs), unit);
  }
  return "саяхан";
};

export const fmtTime = (iso?: string) =>
  iso ? new Date(iso).toLocaleString("mn-MN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

// ── Message thread ─────────────────────────────────────────────────
/**
 * Renders the message bubbles. Whose message sits on the right is
 * perspective-dependent: on the buyer view the buyer's own ("user")
 * messages are right/blue; on the admin view the admin's replies are
 * right/blue. Pass `meAuthor` accordingly. The other party renders
 * left/white. System messages are centered/gray.
 */
export function MessageThread({
  messages,
  meAuthor,
}: {
  messages: SupportMessage[];
  meAuthor: "user" | "admin";
}) {
  const endRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to the newest message whenever the thread changes.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length]);

  return (
    <div className="space-y-3">
      {messages.map((m, i) => {
        if (m.author === "system") {
          return (
            <div key={m._id || i} className="flex justify-center">
              <div className="max-w-[85%] text-center text-[11px] text-gray-500 bg-gray-100 border border-gray-200 rounded-full px-3 py-1">
                {m.text}
              </div>
            </div>
          );
        }
        const mine = m.author === meAuthor;
        const adminAuthored = m.author === "admin";
        return (
          <div key={m._id || i} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] min-w-0`}>
              {adminAuthored && (
                <div className={`flex items-center gap-1 mb-1 ${mine ? "justify-end" : "justify-start"}`}>
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">
                    <Headset size={10} /> Оператор
                  </span>
                </div>
              )}
              <div
                className={`rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap break-words ${
                  mine
                    ? "bg-blue-600 text-white rounded-br-md"
                    : "bg-white text-gray-800 border border-gray-200 rounded-bl-md"
                }`}
              >
                {m.text && <div>{m.text}</div>}
                {!!m.images?.length && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {m.images.map((url, idx) => (
                      <a key={idx} href={url} target="_blank" rel="noreferrer"
                        className="relative w-24 h-24 rounded-lg overflow-hidden border border-black/10 block">
                        <Image src={url} alt="" fill sizes="96px" className="object-cover" unoptimized />
                      </a>
                    ))}
                  </div>
                )}
              </div>
              <div className={`text-[10px] text-gray-400 mt-1 ${mine ? "text-right" : "text-left"}`}>
                {fmtTime(m.createdAt)}
              </div>
            </div>
          </div>
        );
      })}
      <div ref={endRef} />
    </div>
  );
}

// ── Composer ───────────────────────────────────────────────────────
/**
 * Shared message composer. Uploads attachments through api.uploadImage
 * (same Cloudinary endpoint DisputeModal uses) and calls `onSend(text,
 * images)`. The parent owns the actual POST + refetch so this stays
 * surface-agnostic. Disabled with a notice when `disabled` is set
 * (e.g. the ticket is closed).
 */
export function Composer({
  onSend,
  disabled = false,
  disabledNotice,
  placeholder = "Зурвас бичих...",
  sendLabel = "Илгээх",
}: {
  onSend: (text: string, images: string[]) => Promise<void>;
  disabled?: boolean;
  disabledNotice?: string;
  placeholder?: string;
  sendLabel?: string;
}) {
  const [text, setText] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);

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
      const { toast } = await import("@/app/lib/toast");
      toast.error((e as ApiError).message || "Зураг байршуулж чадсангүй");
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    const body = text.trim();
    if (!body && images.length === 0) return;
    setSending(true);
    try {
      await onSend(body, images);
      setText("");
      setImages([]);
    } finally {
      setSending(false);
    }
  };

  if (disabled) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3 text-[12px] text-gray-500 text-center">
        {disabledNotice || "Энэ хүсэлт хаагдсан тул шинэ зурвас бичих боломжгүй."}
      </div>
    );
  }

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-3 shadow-sm">
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {images.map((url, i) => (
            <div key={i} className="relative w-16 h-16 rounded-lg overflow-hidden border border-gray-200">
              <Image src={url} alt="" fill sizes="64px" className="object-cover" unoptimized />
              <button onClick={() => setImages((prev) => prev.filter((_, idx) => idx !== i))}
                className="absolute top-0.5 right-0.5 w-5 h-5 bg-black/60 text-white rounded-full flex items-center justify-center cursor-pointer border-none">
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      )}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        maxLength={4000}
        placeholder={placeholder}
        onKeyDown={(e) => {
          // Cmd/Ctrl+Enter sends; plain Enter keeps a newline.
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
        }}
        className="w-full border border-gray-200 rounded-xl px-3 py-2 text-[16px] md:text-[13px] focus:border-blue-500 outline-none resize-none font-sans"
      />
      <div className="flex items-center justify-between gap-2 mt-2">
        <label className={`inline-flex items-center gap-1.5 text-[12px] px-2.5 py-1.5 rounded-lg border cursor-pointer transition-colors font-sans ${
          uploading ? "border-blue-300 bg-blue-50 text-blue-600" : "border-gray-200 text-gray-500 hover:border-blue-300 hover:text-blue-600"
        }`}>
          <input type="file" accept="image/*" multiple className="hidden"
            onChange={(e) => onFiles(e.target.files)} disabled={uploading || images.length >= 6} />
          {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
          {uploading ? "Хадгалж…" : "Зураг"}
        </label>
        <button onClick={submit} disabled={sending || uploading || (!text.trim() && images.length === 0)}
          className="inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl px-4 py-2 text-[13px] font-semibold cursor-pointer border-none transition-colors font-sans">
          {sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
          {sendLabel}
        </button>
      </div>
    </div>
  );
}
