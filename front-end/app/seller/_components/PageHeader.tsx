"use client";

/**
 * Consistent B2B page header used at the top of every seller page.
 *
 * Layout: title (+ optional icon) and one-line subtitle on the left,
 * primary action(s) on the right. Wraps + stacks cleanly on mobile so
 * the actions drop below the title instead of crushing it.
 */

import type { LucideIcon } from "lucide-react";

export default function PageHeader({
  title,
  subtitle,
  icon: Icon,
  iconClassName = "text-amber-600",
  actions,
}: {
  title: string;
  subtitle?: React.ReactNode;
  icon?: LucideIcon;
  iconClassName?: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[20px] md:text-[22px] font-semibold text-gray-900 flex items-center gap-2">
          {Icon && <Icon size={20} className={`shrink-0 ${iconClassName}`} />}
          <span className="truncate">{title}</span>
        </h1>
        {subtitle && (
          <p className="text-[13px] text-gray-500 mt-0.5">{subtitle}</p>
        )}
      </div>
      {actions && (
        <div className="flex items-center gap-2 flex-wrap shrink-0">{actions}</div>
      )}
    </header>
  );
}
