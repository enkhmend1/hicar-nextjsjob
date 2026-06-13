"use client";

/**
 * Shared loading / empty / error presentational states for the seller
 * surface. Replaces bare "Уншиж байна..." text with animated skeletons
 * and gives every list a real empty state + inline error banner.
 */

import type { LucideIcon } from "lucide-react";
import { AlertTriangle } from "lucide-react";

/** Inline red error banner — consistent across pages. */
export function ErrorBanner({ message }: { message: React.ReactNode }) {
  return (
    <div className="bg-red-50 border border-red-200 text-red-700 text-[13px] rounded-xl p-3 flex items-start gap-2">
      <AlertTriangle size={15} className="shrink-0 mt-0.5" />
      <span className="min-w-0">{message}</span>
    </div>
  );
}

/** Centered empty state inside a white card: icon + message + optional CTA. */
export function EmptyState({
  icon: Icon,
  title,
  hint,
  action,
  className = "",
}: {
  icon: LucideIcon;
  title: React.ReactNode;
  hint?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col items-center justify-center text-center px-4 py-12 ${className}`}>
      <div className="w-14 h-14 bg-gray-100 rounded-2xl flex items-center justify-center mb-3">
        <Icon size={26} className="text-gray-300" />
      </div>
      <p className="text-[14px] font-medium text-gray-700">{title}</p>
      {hint && <p className="text-[12px] text-gray-500 mt-1 max-w-xs">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** A single grey pulse block. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse bg-gray-100 rounded-lg ${className}`} />;
}

/** Grid of pulsing KPI cards (matches StatCard footprint). */
export function StatCardsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-white border border-gray-200 rounded-2xl p-4">
          <Skeleton className="w-10 h-10 rounded-xl mb-3" />
          <Skeleton className="h-5 w-20 mb-2" />
          <Skeleton className="h-3 w-16" />
        </div>
      ))}
    </div>
  );
}

/** Skeleton rows for a table body (drop into <tbody>). */
export function TableRowsSkeleton({ rows = 5, cols }: { rows?: number; cols: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r} className="border-b border-gray-100 last:border-0">
          {Array.from({ length: cols }).map((_, c) => (
            <td key={c} className="px-4 py-3">
              <Skeleton className="h-4 w-full max-w-[140px]" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/** Stack of pulsing card placeholders (for card lists like RFQ/orders). */
export function CardListSkeleton({ count = 3, height = "h-[120px]" }: { count?: number; height?: string }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={`bg-white border border-gray-200 rounded-2xl ${height} animate-pulse`} />
      ))}
    </div>
  );
}
