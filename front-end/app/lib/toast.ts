"use client";

/**
 * Toast notification store — Phase V.1.
 *
 * App-wide ephemeral notifications. Used for cart adds, wishlist
 * toggles, settings saves, error reporting — anywhere a button-text
 * flip ("Нэмсэн ✓") was the only feedback before.
 *
 * Design:
 *   • One global Zustand store (no Provider needed; works from any
 *     client component including hooks, services, and event handlers).
 *   • Toasts auto-dismiss after `duration` ms. Default 3s, error
 *     toasts default to 5s (gives time to read).
 *   • Each toast can carry an optional ACTION (label + onClick) so
 *     the cart toast shows "Сагс үзэх →" right next to the message
 *     (Gmail-style).
 *   • Pure data — the actual rendering lives in
 *     app/components/Toaster.tsx so this store is server-safe-ish
 *     for any tree-shaking purposes.
 *
 * Usage:
 *   import { toast } from "@/app/lib/toast";
 *   toast.success("Сагсанд нэмэгдлээ", {
 *     action: { label: "Сагс үзэх", href: "/cart" },
 *   });
 *   toast.error("Хадгалж чадсангүй");
 *   toast.info("...");
 */

import { create } from "zustand";

export type ToastVariant = "success" | "info" | "warning" | "error";

export interface ToastAction {
  label: string;
  /** Either a navigation href OR a click handler. href takes priority. */
  href?:    string;
  onClick?: () => void;
}

export interface Toast {
  id:        string;
  message:   string;
  variant:   ToastVariant;
  duration:  number;          // ms; 0 = no auto-dismiss
  action?:   ToastAction;
  createdAt: number;
}

interface ToastStore {
  toasts: Toast[];
  push:    (t: Omit<Toast, "id" | "createdAt" | "variant" | "duration"> & Partial<Pick<Toast, "variant" | "duration">>) => string;
  dismiss: (id: string) => void;
  clear:   () => void;
}

const DEFAULT_DURATION: Record<ToastVariant, number> = {
  success: 3000,
  info:    3000,
  warning: 4000,
  error:   5000,
};

// Crypto-id when available, fallback timestamp+random for older browsers
const genId = (): string => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
};

export const useToastStore = create<ToastStore>((set, get) => ({
  toasts: [],
  push: (input) => {
    const variant  = input.variant  ?? "info";
    const duration = input.duration ?? DEFAULT_DURATION[variant];
    const id = genId();
    const toast: Toast = {
      id,
      message:   input.message,
      variant,
      duration,
      action:    input.action,
      createdAt: Date.now(),
    };
    set((s) => ({ toasts: [...s.toasts, toast] }));
    // Auto-dismiss timer. 0 means "stay until manually dismissed".
    if (duration > 0) {
      setTimeout(() => {
        // Only remove if it's still there — manual dismiss is allowed
        // to win the race without us re-adding it.
        if (get().toasts.some((t) => t.id === id)) {
          get().dismiss(id);
        }
      }, duration);
    }
    return id;
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  clear:   () => set({ toasts: [] }),
}));

// ─────────────────────────────────────────────────────────────────
// Convenience API — preferred entry point for app code so consumers
// don't have to remember the store name.
// ─────────────────────────────────────────────────────────────────

type PushArgs = Partial<Omit<Toast, "id" | "createdAt" | "message" | "variant">>;
const make = (variant: ToastVariant) =>
  (message: string, opts: PushArgs = {}) =>
    useToastStore.getState().push({ message, variant, ...opts });

export const toast = {
  success: make("success"),
  info:    make("info"),
  warning: make("warning"),
  error:   make("error"),
  dismiss: (id: string) => useToastStore.getState().dismiss(id),
  clear:   () => useToastStore.getState().clear(),
};
