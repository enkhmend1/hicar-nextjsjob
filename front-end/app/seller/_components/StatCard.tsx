"use client";

/**
 * KPI / stat cards used across the seller surface.
 *
 *  • <StatCard>        — large vertical card (icon chip on top, big value,
 *                        label, optional sub). Used on the dashboard +
 *                        analytics where stats are the hero content.
 *  • <StatCardInline>  — compact horizontal card (icon chip + value/label)
 *                        used as a tight summary strip above tables
 *                        (products / warehouse inventory health).
 *
 * Both share one tone palette so colours stay consistent everywhere.
 * Theme stays within blue / amber / emerald / indigo / red / gray —
 * no violet/fuchsia (CLAUDE.md ban).
 */

import type { LucideIcon } from "lucide-react";

export type StatTone = "blue" | "amber" | "emerald" | "indigo" | "red" | "gray";

const TONE_CHIP: Record<StatTone, string> = {
  blue: "bg-blue-50 text-blue-600",
  amber: "bg-amber-50 text-amber-600",
  emerald: "bg-emerald-50 text-emerald-600",
  indigo: "bg-indigo-50 text-indigo-600",
  red: "bg-red-50 text-red-600",
  gray: "bg-gray-50 text-gray-500",
};

export function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  tone = "blue",
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: LucideIcon;
  tone?: StatTone;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-4">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${TONE_CHIP[tone]}`}>
        <Icon size={18} />
      </div>
      <div className="text-[20px] font-bold text-gray-900 tabular-nums truncate">{value}</div>
      <div className="text-[12px] text-gray-500 mt-0.5">{label}</div>
      {sub && <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}

export function StatCardInline({
  label,
  value,
  icon: Icon,
  tone = "gray",
}: {
  label: string;
  value: string | number;
  icon: LucideIcon;
  tone?: StatTone;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-3 flex items-center gap-3">
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${TONE_CHIP[tone]}`}>
        <Icon size={15} />
      </div>
      <div className="min-w-0">
        <div className="text-[16px] font-bold text-gray-900 tabular-nums truncate">{value}</div>
        <div className="text-[11px] text-gray-500 truncate">{label}</div>
      </div>
    </div>
  );
}
