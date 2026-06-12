"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, usePathname } from "next/navigation";
import { api } from "@/lib/api";
import { Product } from "@/app/types";
import { openAIChat } from "@/app/lib/aiChat";
import { Search, Loader2, ArrowRight, Sparkles } from "lucide-react";

/**
 * NavSearch — global live product search for the navbar (desktop bar +
 * mobile hamburger menu).
 *
 * Typing shows the top matches in a dropdown right under the field — the
 * same "results appear below as you type" behaviour the seller warehouse
 * screen has — instead of forcing a blind Enter → /shop round-trip.
 *
 *   • 250ms debounce, min 2 chars; stale responses dropped via a seq ref.
 *   • Esc / outside-click / route change close the dropdown.
 *   • Enter (or the footer row) still lands on /shop?q=… for the full
 *     filterable grid.
 *   • Mobile variant uses a 16px font so iOS Safari doesn't zoom on focus.
 */
export default function NavSearch({
  variant,
  onNavigate,
}: {
  variant: "desktop" | "mobile";
  /** Called on any navigation out of the box (e.g. close the mobile menu). */
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Product[]>([]);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const seqRef = useRef(0);

  // Debounced top-6 lookup. The seq guard makes sure a slow earlier
  // response can never overwrite a newer one.
  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) { setHits([]); setBusy(false); return; }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBusy(true);
    const seq = ++seqRef.current;
    const t = setTimeout(() => {
      api.get<{ items: Product[] }>(`/products?q=${encodeURIComponent(query)}&limit=6`)
        .then((d) => { if (seqRef.current === seq) { setHits(d.items); setBusy(false); } })
        .catch(() => { if (seqRef.current === seq) { setHits([]); setBusy(false); } });
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  // Outside click + ESC → close.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Route change → close; the dropdown must never survive navigation.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpen(false);
  }, [pathname]);

  const goAll = () => {
    const query = q.trim();
    setOpen(false);
    onNavigate?.();
    router.push(query ? `/shop?q=${encodeURIComponent(query)}` : "/shop");
  };

  /** Hand the query to the AI assistant (vehicle-aware agent pipeline). */
  const askAI = () => {
    const query = q.trim();
    setOpen(false);
    onNavigate?.();
    openAIChat(query);
  };

  const showDrop = open && q.trim().length >= 2;
  const inputCls =
    variant === "mobile"
      ? "w-full bg-gray-50 focus:bg-white border border-gray-200 focus:border-blue-500 rounded-xl pl-9 pr-3 py-2.5 text-[16px] outline-none transition-colors font-sans"
      : "w-full bg-gray-50 hover:bg-white focus:bg-white border border-gray-200 hover:border-gray-300 focus:border-blue-500 rounded-xl pl-9 pr-3 py-2 text-[13px] outline-none transition-colors font-sans";

  return (
    <div className="relative w-full" ref={boxRef}>
      <form onSubmit={(e) => { e.preventDefault(); goAll(); }}>
        <Search
          size={variant === "mobile" ? 15 : 14}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none z-10"
        />
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Сэлбэг хайх... (нэр, OEM, брэнд)"
          className={inputCls}
        />
      </form>

      {showDrop && (
        <div className="absolute top-full left-0 right-0 mt-1.5 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden z-50">
          {/* AI search — routes the query through the chat agent, which
              checks vehicle fitment + OEM cross-references. Always on top
              so it works even when the plain DB search finds nothing. */}
          <button
            type="button"
            onClick={askAI}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 bg-gradient-to-r from-blue-50 to-amber-50 hover:from-blue-100 hover:to-amber-100 cursor-pointer border-none border-b border-gray-100 transition-colors font-sans text-left"
          >
            <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-600 to-amber-600 text-white inline-flex items-center justify-center shrink-0">
              <Sparkles size={14} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[12px] font-semibold text-gray-900 truncate">
                «{q.trim()}» — AI туслахаар хайх
              </span>
              <span className="block text-[10px] text-gray-500 truncate">
                Машинд тохирохыг шалгаж, OEM солбицол хайна
              </span>
            </span>
            <ArrowRight size={13} className="text-blue-600 shrink-0" />
          </button>
          {busy && hits.length === 0 ? (
            <div className="flex items-center gap-2 px-3 py-3 text-[12px] text-gray-500">
              <Loader2 size={13} className="animate-spin" /> Хайж байна…
            </div>
          ) : hits.length === 0 ? (
            <div className="px-3 py-3 text-[12px] text-gray-500">
              Илэрц олдсонгүй — өөр түлхүүр үг туршаад үзээрэй
            </div>
          ) : (
            <div className="max-h-[55vh] overflow-y-auto overscroll-contain">
              {hits.map((p) => {
                const id = (p._id ?? p.id) as string;
                return (
                  <Link
                    key={id}
                    href={`/shop/${id}`}
                    onClick={() => { setOpen(false); onNavigate?.(); }}
                    className="flex items-center gap-2.5 px-3 py-2 hover:bg-blue-50 transition-colors border-b border-gray-50"
                  >
                    <div className="relative w-9 h-9 rounded-lg bg-gradient-to-br from-blue-50 to-amber-50 border border-gray-100 overflow-hidden shrink-0 flex items-center justify-center">
                      {p.images?.[0] ? (
                        <Image src={p.images[0]} alt={p.name} fill sizes="36px" className="object-contain p-0.5" />
                      ) : (
                        <span className="text-[13px] font-bold text-blue-300">
                          {(p.name || "?").charAt(0).toUpperCase()}
                        </span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[12px] font-medium text-gray-900 truncate">{p.name}</div>
                      {p.oem && <div className="text-[10px] font-mono text-gray-500 truncate">{p.oem}</div>}
                    </div>
                    <div className="text-[12px] font-bold text-amber-700 shrink-0">
                      ₮{p.price.toLocaleString()}
                    </div>
                  </Link>
                );
              })}
              <button
                type="button"
                onClick={goAll}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 text-[12px] font-semibold text-blue-700 hover:bg-blue-50 cursor-pointer bg-white border-none transition-colors font-sans"
              >
                Бүх илэрц харах <ArrowRight size={12} />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
