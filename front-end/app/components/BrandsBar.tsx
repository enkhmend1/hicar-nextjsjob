"use client";

/**
 * Auto-scrolling car-brand marquee with logos.
 *
 * Logo quality via a source fallback chain (best → safest):
 *   1. Clearbit  — real FULL-COLOUR brand logo at 2× (128px) for retina crispness
 *   2. Simple Icons — clean monochrome wordmark tinted to the brand colour
 *   3. coloured monogram — never shows a broken image
 *
 * The track holds two identical groups and scrolls -50% for a seamless loop
 * (see .brand-marquee in globals.css). Pauses on hover, respects reduced-motion.
 */
import { useState } from "react";

type Brand = { n: string; domain: string; slug: string; c: string; local?: string };

const BRANDS: Brand[] = [
  { n: "TOYOTA",     domain: "toyota.com",            slug: "toyota",     c: "#eb0a1e" },
  { n: "LEXUS",      domain: "lexus.com",             slug: "lexus",      c: "#1a1a1a", local: "/brands/lexus.png" },
  { n: "NISSAN",     domain: "nissan.com",            slug: "nissan",     c: "#c3002f" },
  { n: "HONDA",      domain: "honda.com",             slug: "honda",      c: "#cc0000" },
  { n: "HYUNDAI",    domain: "hyundai.com",           slug: "hyundai",    c: "#002c5f" },
  { n: "KIA",        domain: "kia.com",               slug: "kia",        c: "#05141f" },
  { n: "SUBARU",     domain: "subaru.com",            slug: "subaru",     c: "#0067b1" },
  { n: "MAZDA",      domain: "mazda.com",             slug: "mazda",      c: "#101010" },
  { n: "MITSUBISHI", domain: "mitsubishi-motors.com", slug: "mitsubishi", c: "#ed0000" },
];

function BrandLogo({ name, color, sources }: { name: string; color: string; sources: string[] }) {
  const [idx, setIdx] = useState(0);

  if (idx >= sources.length) {
    return (
      <span
        className="grid place-items-center w-7 h-7 rounded-md text-[11px] font-black text-white shrink-0"
        style={{ background: color }}
      >
        {name[0]}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={sources[idx]}
      alt={name}
      width={28}
      height={28}
      className="w-7 h-7 object-contain shrink-0"
      loading="lazy"
      onError={() => setIdx((i) => i + 1)}
    />
  );
}

export default function BrandsBar() {
  return (
    <div className="bg-white border-t border-b border-gray-100">
      <div className="brand-marquee-mask max-w-6xl mx-auto px-5">
        <div className="flex w-max brand-marquee">
          {[0, 1].map((dup) => (
            <div key={dup} className="flex shrink-0" aria-hidden={dup === 1}>
              {BRANDS.map((b) => (
                <div
                  key={b.n + dup}
                  className="flex items-center gap-2.5 px-6 py-3.5 cursor-pointer opacity-70 hover:opacity-100 transition-opacity"
                >
                  <BrandLogo
                    name={b.n}
                    color={b.c}
                    sources={[
                      ...(b.local ? [b.local] : []),
                      `https://logo.clearbit.com/${b.domain}?size=128`,
                      `https://cdn.simpleicons.org/${b.slug}/${b.c.slice(1)}`,
                    ]}
                  />
                  <span className="text-[12px] font-black tracking-widest select-none whitespace-nowrap" style={{ color: b.c }}>
                    {b.n}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
