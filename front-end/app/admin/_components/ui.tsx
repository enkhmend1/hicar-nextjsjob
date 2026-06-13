"use client";

/**
 * Shared presentational primitives for the admin console.
 *
 * Purely visual — no data fetching, no business logic. These exist so every
 * admin page renders a consistent B2B header / KPI card / table shell / state
 * (loading · empty · error) without each page reinventing the markup.
 *
 * Theme: blue accent, white cards, border-gray-200, rounded-2xl, text scale
 * [13px]/[11px]. (CLAUDE.md.)
 */

import React from "react";
import type { LucideIcon } from "lucide-react";

// ── Button class strings ──────────────────────────────────────────
// Reusable className recipes so buttons look identical across pages.
// Used both on real <button>s and on <Link>s styled as buttons.
export const btn = {
  primary:
    "inline-flex items-center justify-center gap-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-lg px-3 py-2 text-[13px] font-semibold cursor-pointer border-none transition-colors font-sans disabled:cursor-not-allowed",
  secondary:
    "inline-flex items-center justify-center gap-1.5 border border-gray-200 hover:border-blue-400 bg-white text-gray-700 rounded-lg px-3 py-2 text-[13px] font-semibold cursor-pointer transition-colors font-sans disabled:opacity-50 disabled:cursor-not-allowed",
  danger:
    "inline-flex items-center justify-center gap-1.5 border border-red-200 text-red-600 hover:bg-red-50 bg-white rounded-lg px-3 py-2 text-[13px] font-semibold cursor-pointer transition-colors font-sans disabled:opacity-50 disabled:cursor-not-allowed",
} as const;

// ── PageHeader ────────────────────────────────────────────────────
/**
 * Consistent page heading: title + optional one-line subtitle on the left,
 * optional actions on the right. Stacks cleanly on mobile.
 */
export function PageHeader({
  title,
  subtitle,
  icon: Icon,
  actions,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: LucideIcon;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[20px] md:text-[22px] font-semibold text-gray-900 flex items-center gap-2">
          {Icon && <Icon size={20} className="text-blue-600 shrink-0" />}
          <span className="min-w-0">{title}</span>
        </h1>
        {subtitle && <p className="text-[13px] text-gray-500 mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

// ── StatCard + StatGrid ───────────────────────────────────────────
type StatTone = "blue" | "emerald" | "amber" | "orange" | "red" | "gray" | "indigo";

const TONE: Record<StatTone, string> = {
  blue: "bg-blue-50 text-blue-600",
  emerald: "bg-emerald-50 text-emerald-600",
  amber: "bg-amber-50 text-amber-600",
  orange: "bg-orange-50 text-orange-600",
  red: "bg-red-50 text-red-600",
  gray: "bg-gray-100 text-gray-500",
  indigo: "bg-indigo-50 text-indigo-600",
};

/** White KPI card: icon chip + label + value, with an optional hint line. */
export function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  tone = "blue",
}: {
  icon?: LucideIcon;
  label: React.ReactNode;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: StatTone;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-4">
      {Icon && (
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${TONE[tone]}`}>
          <Icon size={18} />
        </div>
      )}
      <div className="text-[20px] font-bold text-gray-900 leading-tight tabular-nums">
        {value}
      </div>
      <div className="text-[12px] text-gray-500 mt-0.5">{label}</div>
      {hint && <div className="text-[11px] text-gray-400 mt-0.5">{hint}</div>}
    </div>
  );
}

/** Responsive KPI grid: 2-up on mobile, 4-up on desktop by default. */
export function StatGrid({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`grid grid-cols-2 md:grid-cols-4 gap-3 ${className}`}>{children}</div>
  );
}

// ── Card ──────────────────────────────────────────────────────────
/** Plain white panel matching the admin surface (border-gray-200, rounded-2xl). */
export function Card({
  children,
  className = "",
  padded = true,
}: {
  children: React.ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <div className={`bg-white border border-gray-200 rounded-2xl ${padded ? "p-4" : ""} ${className}`}>
      {children}
    </div>
  );
}

// ── Table shell ───────────────────────────────────────────────────
/**
 * Card-wrapped table that never crushes on mobile: an inner overflow-x-auto
 * scroll region with a sensible min-width so columns stay legible. Pass the
 * <thead>/<tbody> as children.
 */
export function TableShell({
  children,
  minWidth = 640,
  className = "",
}: {
  children: React.ReactNode;
  minWidth?: number;
  className?: string;
}) {
  return (
    <div className={`bg-white border border-gray-200 rounded-2xl overflow-hidden ${className}`}>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]" style={{ minWidth }}>
          {children}
        </table>
      </div>
    </div>
  );
}

/** Standard <thead> row styling. Children are <Th> cells. */
export function THead({ children }: { children: React.ReactNode }) {
  return (
    <thead>
      <tr className="bg-gray-50 border-b border-gray-200 text-gray-500 text-[12px]">{children}</tr>
    </thead>
  );
}

export function Th({
  children,
  align = "left",
  className = "",
}: {
  children?: React.ReactNode;
  align?: "left" | "center" | "right";
  className?: string;
}) {
  const a = align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";
  return <th className={`${a} px-4 py-2.5 font-medium whitespace-nowrap ${className}`}>{children}</th>;
}

export function Td({
  children,
  align = "left",
  className = "",
  colSpan,
}: {
  children?: React.ReactNode;
  align?: "left" | "center" | "right";
  className?: string;
  colSpan?: number;
}) {
  const a = align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";
  return (
    <td colSpan={colSpan} className={`${a} px-4 py-2.5 text-[13px] ${className}`}>
      {children}
    </td>
  );
}

// ── States: skeleton · empty · error ──────────────────────────────
/** Single shimmering placeholder block. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse bg-gray-100 rounded-xl ${className}`} />;
}

/** A stack of card-shaped skeletons — generic loading placeholder for lists. */
export function CardSkeletons({
  count = 4,
  height = "h-24",
}: {
  count?: number;
  height?: string;
}) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={`bg-white border border-gray-200 rounded-2xl ${height} animate-pulse`} />
      ))}
    </div>
  );
}

/**
 * Skeleton rows rendered INSIDE a TableShell's <tbody> while data loads, so
 * the table keeps its shape instead of flashing a bare "loading" line.
 */
export function TableSkeleton({ rows = 6, cols }: { rows?: number; cols: number }) {
  return (
    <tbody>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r} className="border-b border-gray-100 last:border-0">
          {Array.from({ length: cols }).map((_, c) => (
            <td key={c} className="px-4 py-3">
              <div className="h-3.5 bg-gray-100 rounded animate-pulse" style={{ width: c === 0 ? "60%" : "80%" }} />
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  );
}

/** Centered empty state: icon chip + message (+ optional sub-text / action). */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className = "",
}: {
  icon?: LucideIcon;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`py-14 px-4 text-center ${className}`}>
      {Icon && (
        <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-3">
          <Icon size={28} className="text-gray-300" />
        </div>
      )}
      <p className="text-[14px] font-medium text-gray-700">{title}</p>
      {description && (
        <p className="text-[12px] text-gray-500 mt-1 max-w-sm mx-auto leading-relaxed">{description}</p>
      )}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

/** Inline red error banner. */
export function ErrorBanner({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-[13px] flex items-start gap-2 ${className}`}>
      <span className="shrink-0 mt-px">⚠</span>
      <span className="min-w-0">{children}</span>
    </div>
  );
}

// ── Filter pills ──────────────────────────────────────────────────
export interface FilterOption<T extends string = string> {
  id: T;
  label: React.ReactNode;
  badge?: React.ReactNode;
}

/**
 * Horizontally-scrollable pill filter row used across list pages. Keeps the
 * exact onSelect wiring of each page; just standardizes the look.
 */
export function FilterTabs<T extends string>({
  options,
  value,
  onSelect,
  className = "",
}: {
  options: ReadonlyArray<FilterOption<T>>;
  value: T;
  onSelect: (id: T) => void;
  className?: string;
}) {
  return (
    <div className={`flex gap-2 overflow-x-auto pb-1 -mx-0.5 px-0.5 ${className}`}>
      {options.map((o) => {
        const active = value === o.id;
        return (
          <button
            key={o.id}
            onClick={() => onSelect(o.id)}
            className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium cursor-pointer border transition-all font-sans ${
              active
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white text-gray-600 border-gray-200 hover:border-blue-400"
            }`}
          >
            {o.label}
            {o.badge != null && (
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${
                  active ? "bg-white/20 text-white" : "bg-amber-100 text-amber-700"
                }`}
              >
                {o.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── StatusChip ────────────────────────────────────────────────────
/** Small colored status pill. Pass the full color className recipe. */
export function StatusChip({
  children,
  color,
  icon: Icon,
  className = "",
}: {
  children: React.ReactNode;
  color: string;
  icon?: LucideIcon;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border ${color} ${className}`}
    >
      {Icon && <Icon size={10} />}
      {children}
    </span>
  );
}
