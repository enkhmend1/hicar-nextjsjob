/**
 * Product-detail server layout — Phase W.2.
 *
 * `generateMetadata` runs server-side at request time. It fetches the
 * product from the backend and emits the title / description / OG
 * image. Without this, every product page rendered under the
 * generic root metadata ("HiCar MN — Автомашины сэлбэг") regardless
 * of which part the URL points at — terrible for SEO + share previews.
 *
 * The page itself stays a Client Component (uses hooks, useState).
 * This layout just adds metadata + transparently re-renders children.
 */

import type { Metadata } from "next";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5001/api";

interface ProductLike {
  name?: string;
  oem?: string;
  brand?: string;
  description?: string;
  price?: number;
  images?: string[];
  category?: string;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  let p: ProductLike | null = null;
  try {
    // Server-side fetch — runs once per request before the page renders.
    // 60s revalidate so popular products don't re-fetch on every view.
    const res = await fetch(`${API}/products/${id}`, {
      next: { revalidate: 60 },
    });
    if (res.ok) {
      const data = await res.json();
      p = data?.item ?? null;
    }
  } catch {
    /* swallow — fall through to generic title below */
  }

  if (!p?.name) {
    return {
      title: "Бараа · HiCar MN",
      description: "HiCar — авто сэлбэгийн платформ",
    };
  }

  const title = `${p.name}${p.oem ? ` (OEM ${p.oem})` : ""} · HiCar`;
  const description = p.description?.slice(0, 160) ||
    `${p.brand ?? ""} ${p.name}${p.price ? ` — ₮${p.price.toLocaleString()}` : ""}`.trim();
  const image = p.images?.[0];

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      ...(image ? { images: [{ url: image }] } : {}),
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title,
      description,
      ...(image ? { images: [image] } : {}),
    },
  };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
