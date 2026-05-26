"use client";

/**
 * Breadcrumbs — Phase W.1.
 *
 * Renders the navigational trail on detail pages:
 *
 *   Нүүр / Сэлбэгүүд / Тоормосны систем / Toyota brake pad
 *
 * Two output channels:
 *   1. Visible <nav> markup — chip-style links + chevron separators.
 *   2. <script type="application/ld+json"> with schema.org
 *      BreadcrumbList markup so Google can render rich breadcrumbs in
 *      search results.
 *
 * Last item is always presented as plain text (not a link) since you
 * shouldn't link to the page you're already on.
 */

import Link from "next/link";
import { ChevronRight } from "lucide-react";

export interface Crumb {
  label: string;
  /** Omitted for the current page (last crumb). */
  href?: string;
}

interface Props {
  items: Crumb[];
  /** Optional className for the outer <nav> — lets callers tweak
   *  spacing without bleeding into other surfaces. */
  className?: string;
}

export default function Breadcrumbs({ items, className = "" }: Props) {
  if (!items || items.length === 0) return null;

  // schema.org BreadcrumbList — Google + Bing pick this up to draw
  // breadcrumb chips directly in search results.
  const ld = {
    "@context": "https://schema.org",
    "@type":    "BreadcrumbList",
    itemListElement: items.map((c, i) => ({
      "@type":    "ListItem",
      position:   i + 1,
      name:       c.label,
      ...(c.href ? { item: c.href } : {}),
    })),
  };

  return (
    <>
      <nav aria-label="Breadcrumb" className={`text-[12px] text-gray-500 ${className}`}>
        <ol className="flex flex-wrap items-center gap-1">
          {items.map((c, i) => {
            const last = i === items.length - 1;
            return (
              <li key={`${c.label}-${i}`} className="flex items-center gap-1">
                {c.href && !last ? (
                  <Link
                    href={c.href}
                    className="hover:text-blue-700 transition-colors truncate max-w-[160px]"
                  >
                    {c.label}
                  </Link>
                ) : (
                  <span
                    aria-current={last ? "page" : undefined}
                    className={`truncate max-w-[220px] ${last ? "text-gray-900 font-medium" : ""}`}
                  >
                    {c.label}
                  </span>
                )}
                {!last && <ChevronRight size={11} className="text-gray-300 shrink-0" />}
              </li>
            );
          })}
        </ol>
      </nav>
      <script
        type="application/ld+json"
        // ld+json is the standard payload — Next.js doesn't sanitize
        // because the content is OURS, not user input.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }}
      />
    </>
  );
}
