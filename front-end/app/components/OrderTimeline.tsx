/**
 * Phase AQ.3 — OrderTimeline
 *
 * A horizontal 5-step pill timeline showing where an order is in its
 * lifecycle. Used identically by buyer (/orders) and seller
 * (/seller/orders) so both sides see the same picture.
 *
 *   Үүсгэсэн → Төлсөн → Бэлдэж буй → Илгээсэн → Хүргэгдсэн
 *
 * Visual states per step:
 *   • completed (past)      — solid blue circle with check, blue label
 *   • current  (active)     — pulsing blue ring, semibold blue label
 *   • upcoming              — gray circle, gray label
 *   • cancelled (any step)  — all steps gray + red CANCELLED chip above
 *
 * Why a shared component:
 *   Buyers and sellers MUST see the same status semantics. Drift between
 *   the two surfaces is the #1 source of "Where is my order?" support
 *   tickets. One component = one rendering = zero drift.
 */
"use client";
import { Check, X } from "lucide-react";

type OrderStatus = "pending" | "paid" | "processing" | "shipped" | "delivered" | "cancelled";

interface Step {
  key: OrderStatus;
  label: string;
}

// Ordered left-to-right. `cancelled` is rendered as a separate banner,
// NOT a step in the timeline (it can happen from any earlier state).
const STEPS: ReadonlyArray<Step> = [
  { key: "pending",    label: "Үүсгэсэн" },
  { key: "paid",       label: "Төлсөн" },
  { key: "processing", label: "Бэлдэж буй" },
  { key: "shipped",    label: "Илгээсэн" },
  { key: "delivered",  label: "Хүргэгдсэн" },
] as const;

interface Props {
  /** Current status from the Order document. */
  status: OrderStatus;
  /** Compact mode shrinks padding for use inside dense tables. */
  compact?: boolean;
}

export default function OrderTimeline({ status, compact = false }: Props) {
  if (status === "cancelled") {
    return (
      <div className={`flex items-center gap-2 ${compact ? "text-[11px]" : "text-[12px]"}`}>
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200 font-medium">
          <X size={11} /> Цуцалсан
        </span>
      </div>
    );
  }

  const currentIdx = STEPS.findIndex((s) => s.key === status);

  return (
    <div className={`flex items-stretch w-full ${compact ? "gap-1" : "gap-1.5"}`}>
      {STEPS.map((step, idx) => {
        const isComplete = idx < currentIdx;
        const isCurrent  = idx === currentIdx;
        const isUpcoming = idx > currentIdx;

        const circleColor = isComplete
          ? "bg-blue-600 text-white"
          : isCurrent
            ? "bg-blue-600 text-white ring-2 ring-blue-200 animate-pulse"
            : "bg-gray-100 text-gray-300";
        const labelColor = isComplete
          ? "text-blue-600"
          : isCurrent
            ? "text-blue-700 font-semibold"
            : "text-gray-400";
        const lineColor = isComplete ? "bg-blue-200" : "bg-gray-100";

        const circleSize = compact ? "w-5 h-5" : "w-6 h-6";
        const labelSize  = compact ? "text-[10px]" : "text-[11px]";
        const lineHeight = compact ? "h-[2px]" : "h-[2px]";

        return (
          <div key={step.key} className="flex-1 min-w-0 flex flex-col items-center">
            <div className="flex items-center w-full">
              {/* left connecting line — skipped for first step */}
              {idx === 0 ? (
                <div className="flex-1" />
              ) : (
                <div className={`flex-1 ${lineHeight} ${lineColor}`} />
              )}
              <div className={`${circleSize} rounded-full flex items-center justify-center shrink-0 ${circleColor}`}>
                {isComplete ? <Check size={compact ? 10 : 12} /> : (
                  <span className={`${compact ? "text-[9px]" : "text-[10px]"} font-bold`}>{idx + 1}</span>
                )}
              </div>
              {/* right connecting line — skipped for last step */}
              {idx === STEPS.length - 1 ? (
                <div className="flex-1" />
              ) : (
                <div className={`flex-1 ${lineHeight} ${lineColor}`} />
              )}
            </div>
            <div className={`mt-1 ${labelSize} text-center truncate w-full ${labelColor}`}>
              {step.label}
            </div>
          </div>
        );
      })}
    </div>
  );
}
