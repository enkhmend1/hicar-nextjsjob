import type { MetadataRoute } from "next";

/**
 * sitemap.xml — generated. Lists the public static routes plus every
 * product detail page (/shop/[id]) pulled from the API.
 *
 * Graceful degradation (CLAUDE.md): if the API is unreachable, we still
 * emit the static routes rather than failing the whole sitemap.
 */

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://hicar.mn";
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5001/api";

// Cap so a large catalog never blows past the 50k-URL sitemap limit.
const MAX_PRODUCTS = 5000;

type ProductLite = { _id: string; updatedAt?: string };

async function fetchProducts(): Promise<ProductLite[]> {
  try {
    const res = await fetch(`${API_URL}/products?limit=${MAX_PRODUCTS}`, {
      // Re-fetch hourly so new listings appear without a redeploy.
      next: { revalidate: 3600 },
    });
    if (!res.ok) return [];
    const data = await res.json();
    const items = Array.isArray(data?.items) ? data.items : [];
    return items.filter((p: ProductLite) => p && p._id);
  } catch {
    return [];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: `${SITE_URL}/shop`, lastModified: now, changeFrequency: "daily", priority: 0.9 },
    { url: `${SITE_URL}/lookup`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${SITE_URL}/garage`, lastModified: now, changeFrequency: "monthly", priority: 0.4 },
    { url: `${SITE_URL}/seller/apply`, lastModified: now, changeFrequency: "monthly", priority: 0.3 },
  ];

  const products = await fetchProducts();
  const productRoutes: MetadataRoute.Sitemap = products.map((p) => ({
    url: `${SITE_URL}/shop/${p._id}`,
    lastModified: p.updatedAt ? new Date(p.updatedAt) : now,
    changeFrequency: "weekly",
    priority: 0.7,
  }));

  return [...staticRoutes, ...productRoutes];
}
