"use client";

/**
 * Toaster — sticky container that renders all active toasts. Mounted
 * once in the root layout so any client component can call
 * `toast.success("...")` from anywhere and have the message appear.
 *
 * Position:
 *   • Desktop (sm+): bottom-right, max-width 380px
 *   • Mobile:        bottom-center above the MobileBottomNav (h-14
 *                    → safe-area bottom-16)
 *
 * Per-toast visual:
 *   • Variant-coloured left edge (emerald/blue/amber/red)
 *   • Icon + message
 *   • Optional Action button (link or onClick)
 *   • Dismiss × on hover (always visible on touch)
 *   • Fade-in via tailwind animate-* (animate-in is provided by Tailwind 4)
 */

import Link from "next/link";
import { useToastStore, type ToastVariant } from "@/app/lib/toast";
import { Check, Info, AlertTriangle, X, CircleAlert } from "lucide-react";

interface VariantStyle {
  bar:    string;
  icon:   string;
  iconBg: string;
  Icon:   typeof Check;
}
const VARIANTS: Record<ToastVariant, VariantStyle> = {
  success: { bar: "bg-emerald-500", icon: "text-emerald-700", iconBg: "bg-emerald-50",  Icon: Check         },
  info:    { bar: "bg-blue-500",    icon: "text-blue-700",    iconBg: "bg-blue-50",     Icon: Info          },
  warning: { bar: "bg-amber-500",   icon: "text-amber-700",   iconBg: "bg-amber-50",    Icon: AlertTriangle },
  error:   { bar: "bg-red-500",     icon: "text-red-700",     iconBg: "bg-red-50",      Icon: CircleAlert   },
};

export default function Toaster() {
  const toasts  = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  if (toasts.length === 0) return null;

  return (
    <div
      // z-index above MobileBottomNav (z-40) and Navbar (z-50) — toasts
      // are the most ephemeral signal so they win the stack.
      className="pointer-events-none fixed z-[60] inset-x-0 bottom-0 px-3 pb-[calc(env(safe-area-inset-bottom,0)+72px)] sm:bottom-4 sm:right-4 sm:left-auto sm:pb-0 sm:px-0 flex flex-col items-end gap-2"
      role="region"
      aria-label="Notifications"
    >
      {toasts.map((t) => {
        const v = VARIANTS[t.variant];
        const Icon = v.Icon;
        return (
          <div
            key={t.id}
            // pointer-events-auto so toast children are clickable even
            // though the wrapper is pointer-events-none (so the rest of
            // the page underneath stays scrollable).
            className="pointer-events-auto w-full sm:w-[360px] bg-white border border-gray-200 rounded-xl shadow-lg shadow-black/5 overflow-hidden flex items-stretch animate-in slide-in-from-bottom-2 fade-in duration-200"
            role="status"
          >
            {/* Variant-coloured rail */}
            <div className={`w-1 ${v.bar} shrink-0`} aria-hidden />

            <div className="flex items-start gap-2.5 flex-1 px-3 py-2.5 min-w-0">
              <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${v.iconBg} ${v.icon}`}>
                <Icon size={14} strokeWidth={2.25} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium text-gray-900 leading-snug break-words">
                  {t.message}
                </p>
                {t.action && (
                  t.action.href ? (
                    <Link
                      href={t.action.href}
                      onClick={() => dismiss(t.id)}
                      className="inline-block mt-1 text-[12px] font-semibold text-blue-700 hover:text-blue-800 transition-colors"
                    >
                      {t.action.label} →
                    </Link>
                  ) : (
                    <button
                      type="button"
                      onClick={() => { t.action?.onClick?.(); dismiss(t.id); }}
                      className="inline-block mt-1 text-[12px] font-semibold text-blue-700 hover:text-blue-800 cursor-pointer bg-transparent border-none p-0 font-sans"
                    >
                      {t.action.label}
                    </button>
                  )
                )}
              </div>

              <button
                type="button"
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss"
                className="w-6 h-6 inline-flex items-center justify-center rounded-md text-gray-300 hover:text-gray-600 hover:bg-gray-50 cursor-pointer bg-transparent border-none shrink-0"
              >
                <X size={13} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
