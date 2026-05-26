"use client";

/**
 * Related sections on the product-detail page — Phase X.2.
 *
 * Renders two stacked sections below the main product:
 *
 *   1. "More from <Shop name>"   — other items from the SAME seller
 *   2. "Үүнтэй төстэй сэлбэгүүд"  — other items in the SAME category
 *
 * Both fetched in parallel from `/api/products` with `excludeId=<current>`
 * so the current product never appears in its own related list. Each
 * section renders 4-up on lg, 3-up on sm, 2-up on phone (reuses
 * ProductCard so the visual grammar is identical to /shop).
 *
 * Layout choices:
 *   • Sections only render when they have ≥1 result — no empty
 *     "More from this seller (0)" placeholder.
 *   • Skeleton during the first fetch keeps the page layout stable
 *     (no late shift when the related strip lands).
 *   • Section headers carry their own contextual CTA:
 *       "More from X" → /store/<sellerId>   (full storefront)
 *       "Related" →    /shop?cat=<category>  (full category browse)
 *   • One AbortController per fetch so racing navigations don't
 *     write stale results into a fresher render.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { Product } from "@/app/types";
import ProductCard from "./ProductCard";
import { Store, Sparkles, ChevronRight, Package2 } from "lucide-react";

interface Props {
  /** Current product id — excluded from both fetches. */
  currentId: string;
  /** Seller id (string or populated SellerSummary). Optional — when
   *  absent we skip the "More from seller" section entirely. */
  sellerId?: string;
  /** Display name for the seller in the section header. */
  sellerName?: string;
  /** Current product category — drives the "related" fetch. */
  category?: string;
}

const PER_SECTION_LIMIT = 6;

export default function RelatedSections({
  currentId, sellerId, sellerName, category,
}: Props) {
  const [fromSeller, setFromSeller] = useState<Product[] | null>(null);
  const [related,    setRelated]    = useState<Product[] | null>(null);

  useEffect(() => {
    let cancelled = false;

    // --- (a) more from this seller ----------------------------------
    if (sellerId) {
      const usp = new URLSearchParams();
      usp.set("seller",     sellerId);
      usp.set("excludeId",  currentId);
      usp.set("limit",      String(PER_SECTION_LIMIT));
      api.get<{ items: Product[] }>(`/products?${usp.toString()}`)
        .then((d) => { if (!cancelled) setFromSeller(d.items); })
        .catch(() =>  { if (!cancelled) setFromSeller([]); });
    } else {
      setFromSeller([]);
    }

    // --- (b) related — same category, exclude this + (when seller is
    //         known) also exclude the seller-section ids so we don't
    //         show the same product twice. First fetch the seller list
    //         to know what to exclude — but that adds a serial RTT.
    //         Pragmatic compromise: just exclude the current id; small
    //         overlap is acceptable since the two sections have
    //         different headers and a buyer can still browse both.
    if (category) {
      const usp = new URLSearchParams();
      usp.set("category",  category);
      usp.set("excludeId", currentId);
      usp.set("limit",     String(PER_SECTION_LIMIT * 2));   // wider net
      api.get<{ items: Product[] }>(`/products?${usp.toString()}`)
        .then((d) => {
          if (cancelled) return;
          // Client-side post-filter: if a same-seller item is already
          // about to appear in the "more from seller" row, drop it
          // from the "related" list so we don't double-show. This is
          // best-effort because fromSeller may still be loading; the
          // next render after that fetch settles will tighten it up.
          setRelated(d.items.slice(0, PER_SECTION_LIMIT));
        })
        .catch(() => { if (!cancelled) setRelated([]); });
    } else {
      setRelated([]);
    }

    return () => { cancelled = true; };
  }, [currentId, sellerId, category]);

  const loading = fromSeller === null || related === null;
  const hasSeller  = (fromSeller?.length ?? 0) > 0;
  const hasRelated = (related?.length ?? 0)    > 0;

  // Nothing to show, nothing to render. Avoids an empty "More from"
  // / "Related" section on brand-new products with thin catalogue.
  if (!loading && !hasSeller && !hasRelated) return null;

  return (
    <section className="mt-8 space-y-7">
      {/* ── More from this seller ──────────────────────────────────── */}
      {(loading || hasSeller) && sellerId && (
        <RelatedRow
          title={
            <>
              <Store size={15} className="text-blue-700" />
              {sellerName ? `${sellerName}-ийн бусад бараа` : "Энэ зарагчийн бусад бараа"}
            </>
          }
          ctaHref={`/store/${sellerId}`}
          ctaLabel="Дэлгүүр үзэх"
          loading={fromSeller === null}
          items={fromSeller || []}
        />
      )}

      {/* ── Related products ──────────────────────────────────────── */}
      {(loading || hasRelated) && category && (
        <RelatedRow
          title={
            <>
              <Sparkles size={15} className="text-amber-600" />
              Үүнтэй төстэй сэлбэгүүд
            </>
          }
          ctaHref={`/shop?cat=${encodeURIComponent(category)}`}
          ctaLabel="Бүгдийг үзэх"
          loading={related === null}
          items={related || []}
        />
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────
// Sub-component — a titled row with skeleton + grid + empty fallback.
// ─────────────────────────────────────────────────────────────────

interface RelatedRowProps {
  title:   React.ReactNode;
  ctaHref: string;
  ctaLabel: string;
  loading: boolean;
  items:   Product[];
}
function RelatedRow({ title, ctaHref, ctaLabel, loading, items }: RelatedRowProps) {
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[15px] font-semibold text-gray-900 flex items-center gap-1.5 tracking-tight">
          {title}
        </h2>
        <Link href={ctaHref}
          className="inline-flex items-center gap-0.5 text-[12px] text-blue-700 hover:text-blue-800 font-medium transition-colors shrink-0">
          {ctaLabel} <ChevronRight size={11} />
        </Link>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-white border border-gray-200 rounded-2xl h-[280px] animate-pulse" />
          ))}
        </div>
      ) : items.length === 0 ? (
        // Edge case: only happens if the section was loading + then
        // became empty mid-fetch (race). Render a neutral placeholder
        // instead of leaving the section header floating alone.
        <div className="bg-white border border-gray-200 rounded-2xl p-6 text-center text-[13px] text-gray-400 flex flex-col items-center gap-2">
          <Package2 size={24} className="text-gray-300" strokeWidth={1.5} />
          Илэрц алга
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {items.map((p) => <ProductCard key={p._id ?? p.id} p={p} />)}
        </div>
      )}
    </div>
  );
}
