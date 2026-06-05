"use client";

import { useState } from "react";

// ────────────────────────────────────────────────────────────────────
// QuotationCard — renders layout="quotation". The bodyText is already
// preformatted plain-text (template lives in sellerInsights.service.js),
// so this component is intentionally dumb: monospace block + a copy-to-
// clipboard button so the seller can paste it straight into an email.
// ────────────────────────────────────────────────────────────────────
export default function QuotationCard({
  data, locale,
}: {
  data: { quoteId: string; bodyText: string; summary: Record<string, unknown> };
  locale: "mn" | "en";
}) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(data.bodyText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API can fail in non-HTTPS contexts; fall back to select.
      const ta = document.createElement("textarea");
      ta.value = data.bodyText;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); setCopied(true); setTimeout(() => setCopied(false), 2000); }
      catch { /* user can still select manually */ }
      document.body.removeChild(ta);
    }
  };

  return (
    <div className="mt-2 border border-emerald-200 bg-emerald-50 rounded-lg overflow-hidden text-[11px]">
      <div className="flex items-center justify-between px-2 py-1 bg-emerald-100 text-emerald-800">
        <span className="font-mono font-semibold">{data.quoteId}</span>
        <button
          onClick={handleCopy}
          className="text-[10px] px-2 py-0.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded cursor-pointer border-none transition-colors">
          {copied
            ? (locale === "en" ? "✓ Copied" : "✓ Хууллаа")
            : (locale === "en" ? "Copy" : "Хуулах")}
        </button>
      </div>
      <pre className="px-2 py-1.5 m-0 whitespace-pre overflow-x-auto font-mono text-[10px] leading-tight text-emerald-900 bg-white">
{data.bodyText}
      </pre>
      {data.summary && Object.keys(data.summary).length > 0 && (
        <div className="px-2 py-1 bg-emerald-50 text-[10px] text-emerald-700 font-mono">
          {Object.entries(data.summary)
            .filter(([k]) => !["validUntil"].includes(k))
            .map(([k, v]) => `${k}: ${typeof v === "number" ? v.toLocaleString() : String(v)}`)
            .join(" · ")}
        </div>
      )}
    </div>
  );
}
