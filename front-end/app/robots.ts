import type { MetadataRoute } from "next";

/**
 * robots.txt — generated. Public marketplace surfaces are crawlable;
 * authenticated / transactional / admin areas are kept out of the index.
 */

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://hicar.mn";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/admin",
        "/seller",
        "/profile",
        "/orders",
        "/cart",
        "/checkout",
        "/wishlist",
        "/api/",
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
