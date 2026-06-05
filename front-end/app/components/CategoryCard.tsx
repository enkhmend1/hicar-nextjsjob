"use client";
import { ReactNode } from "react";
import Image from "next/image";
import { visualFor, toneStyles } from "@/app/lib/categoryIcons";

interface Props {
  /** Category id — used to look up the Lucide icon + tone. Optional so
   *  legacy callers without an id still render via the `icon` fallback. */
  id?: string;
  /** Uploaded category image URL. When set, overrides the icon entirely. */
  imageUrl?: string;
  /** Fallback icon node — the legacy MongoDB iconPath rendered as an
   *  inline SVG. Used only when `id` doesn't map to CATEGORY_VISUAL. */
  icon: ReactNode;
  name: string;
  count: string;
}

/**
 * Category card — Phase O.5 redesign.
 *
 * BEFORE: 36px (h-9) icon tile, all-blue background, all categories
 * looked the same. The catalogue grid felt monotonous and the tiny
 * icon was easy to miss on mobile.
 *
 * NOW: 56px (h-14) icon tile with a per-category COLORED gradient
 * background, ring outline, and stroked Lucide icon. Each "family"
 * of parts (powertrain blue, safety red, electrical amber, fluids
 * cyan, …) reads as a distinct group at a glance — Stripe / Linear /
 * Vercel-style modern card identity. Falls back gracefully to the
 * legacy iconPath for categories that aren't in CATEGORY_VISUAL yet.
 */
export default function CategoryCard({ id, imageUrl, icon, name, count }: Props) {
  const visual = id ? visualFor(id) : undefined;
  const tone   = visual ? toneStyles(visual.tone) : null;
  const Icon   = visual?.Icon;

  return (
    <div className="group relative bg-white border border-gray-200 rounded-2xl p-4 text-center cursor-pointer hover:border-blue-400 hover:shadow-lg hover:shadow-blue-100/50 hover:-translate-y-0.5 transition-all duration-200">
      {/* Icon tile — larger, gradient-tinted by category family.
          Responsive: 64px on phones (fits the 3-col grid without overflow),
          80px from sm up so uploaded category photos read clearly. */}
      <div className={`w-16 h-16 sm:w-20 sm:h-20 rounded-2xl flex items-center justify-center mx-auto mb-2.5 ring-1 ring-inset transition-colors overflow-hidden ${
        imageUrl
          ? "bg-gray-100 ring-gray-200/50"
          : tone
            ? `${tone.bg} ${tone.hover} ${tone.ring}`
            : "bg-gradient-to-br from-blue-50 to-blue-100 group-hover:from-blue-100 group-hover:to-blue-200 ring-blue-200/50"
      }`}>
        {imageUrl ? (
          <Image
            src={imageUrl}
            alt={name}
            width={96}
            height={96}
            className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-110"
          />
        ) : Icon ? (
          <Icon size={36} strokeWidth={1.75} className={`${tone?.icon ?? "text-blue-700"} transition-transform duration-200 group-hover:scale-110`} />
        ) : (
          <span className="block w-9 h-9 transition-transform duration-200 group-hover:scale-110">{icon}</span>
        )}
      </div>
      <div className="text-[13px] font-semibold text-gray-900 leading-tight">{name}</div>
      <div className="text-[11px] text-gray-400 mt-1">{count}</div>
    </div>
  );
}
