/**
 * Storefront server layout — Phase W.2.
 *
 * generateMetadata fetches the seller's public storefront payload
 * (Phase P.1 endpoint) and emits a shop-specific page title +
 * description + cover-image OG so share links render with the
 * seller's actual brand instead of generic HiCar metadata.
 */

import type { Metadata } from "next";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5001/api";

interface ShopLike {
  shopName?: string;
  description?: string;
  coverImage?: string;
  logo?: string;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  let shop: ShopLike | null = null;
  try {
    const res = await fetch(`${API}/seller/store/${id}`, {
      next: { revalidate: 120 },
    });
    if (res.ok) {
      const data = await res.json();
      shop = data?.shop ?? null;
    }
  } catch {
    /* swallow — generic title below */
  }

  if (!shop?.shopName) {
    return {
      title: "Дэлгүүр · HiCar MN",
      description: "HiCar marketplace дэлгүүр",
    };
  }

  const title = `${shop.shopName} · HiCar`;
  const description = shop.description?.slice(0, 160) ||
    `${shop.shopName} — авто сэлбэгийн дэлгүүр HiCar платформ дээр`;
  // Prefer cover (richer) → logo → none for OG image.
  const image = shop.coverImage || shop.logo || undefined;

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
