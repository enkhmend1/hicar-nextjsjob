"use client";
import { useState, useRef, useEffect } from "react";
import { useLocale, LOCALES, LOCALE_LABEL, LOCALE_FLAG, Locale } from "@/lib/i18n";
import { Globe, Check } from "lucide-react";

export default function LangSwitcher({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale } = useLocale();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-1.5 border border-gray-200 rounded-lg ${compact ? "px-2 py-1.5" : "px-3 py-1.5"} text-[13px] text-gray-600 hover:border-violet-500 hover:text-violet-600 transition-colors cursor-pointer bg-white font-sans`}>
        {compact ? <Globe size={14} /> : <span>{LOCALE_FLAG[locale]}</span>}
        <span className={compact ? "sr-only" : "font-medium"}>{LOCALE_LABEL[locale]}</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg py-1 z-50 min-w-[140px]">
          {LOCALES.map((l: Locale) => (
            <button key={l} onClick={() => { setLocale(l); setOpen(false); }}
              className={`w-full text-left px-3 py-2 text-[13px] flex items-center gap-2 hover:bg-gray-50 cursor-pointer bg-transparent border-none font-sans ${
                l === locale ? "text-violet-600 font-semibold" : "text-gray-700"
              }`}>
              <span>{LOCALE_FLAG[l]}</span>
              <span className="flex-1">{LOCALE_LABEL[l]}</span>
              {l === locale && <Check size={13} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
