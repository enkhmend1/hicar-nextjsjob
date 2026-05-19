"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import mn from "@/messages/mn.json";
import en from "@/messages/en.json";

export type Locale = "mn" | "en";
export const LOCALES: Locale[] = ["mn", "en"];
export const LOCALE_LABEL: Record<Locale, string> = { mn: "Монгол", en: "English" };
export const LOCALE_FLAG: Record<Locale, string> = { mn: "🇲🇳", en: "🇬🇧" };

type Messages = typeof mn;
const MESSAGES: Record<Locale, Messages> = { mn, en };

interface I18nStore {
  locale: Locale;
  _hasHydrated: boolean;
  setLocale: (l: Locale) => void;
}

const detectBrowserLocale = (): Locale => {
  if (typeof navigator === "undefined") return "mn";
  const lang = navigator.language.toLowerCase();
  if (lang.startsWith("en")) return "en";
  return "mn"; // default
};

export const useI18nStore = create<I18nStore>()(
  persist(
    (set) => ({
      locale: "mn",
      _hasHydrated: false,
      setLocale: (l) => set({ locale: l }),
    }),
    {
      name: "hicar-locale",
      onRehydrateStorage: () => (state) => {
        if (state && !state.locale) {
          state.locale = detectBrowserLocale();
        }
        queueMicrotask(() => useI18nStore.setState({ _hasHydrated: true }));
      },
    },
  ),
);

/** Lookup a dotted key e.g. "nav.shop" from the active locale. Fallback to mn, then key. */
const lookup = (msgs: Messages, key: string): string => {
  const segs = key.split(".");
  let cur: unknown = msgs;
  for (const s of segs) {
    if (cur && typeof cur === "object" && s in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[s];
    } else {
      return key;
    }
  }
  return typeof cur === "string" ? cur : key;
};

/** Replace {name} placeholders. */
const interpolate = (s: string, vars?: Record<string, string | number>): string => {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? String(vars[k]) : `{${k}}`));
};

/** Hook: returns a translate function. Reactive to locale changes. */
export const useT = () => {
  const locale = useI18nStore((s) => s.locale);
  const msgs = MESSAGES[locale] || MESSAGES.mn;
  return (key: string, vars?: Record<string, string | number>): string => {
    const raw = lookup(msgs, key);
    return interpolate(raw, vars);
  };
};

/** Hook: returns current locale + setter. */
export const useLocale = () => {
  const locale = useI18nStore((s) => s.locale);
  const setLocale = useI18nStore((s) => s.setLocale);
  const hydrated = useI18nStore((s) => s._hasHydrated);
  return { locale, setLocale, hydrated };
};
