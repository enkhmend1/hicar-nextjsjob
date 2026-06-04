import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import type { AIResponse } from "@/app/lib/services/chat.service";

// ────────────────────────────────────────────────────────────────────
// Phase H — Confidence badge (medium / low bands).
//
// Subtle inline pill below the assistant bubble. Color shifts by band:
//   70-89  amber  ("Магадлал: 78%")
//   50-69  rose   ("AI бүрэн итгэлгүй байна — Магадлал: 62%")
//
// We deliberately DO NOT show this in the high band (≥90) — the
// product UX rule is "no chrome for happy paths". Critical (<50) gets
// the escalation banner instead, not a badge.
// ────────────────────────────────────────────────────────────────────
export function ConfidenceBadge({ value, locale }: { value: number; locale: "mn" | "en" }) {
  const isLow = value < 70;
  const wrap  = isLow
    ? "border-rose-200 bg-rose-50 text-rose-700"
    : "border-amber-200 bg-amber-50 text-amber-700";
  const label = locale === "en"
    ? (isLow ? `Low confidence — ${value}%` : `Confidence: ${value}%`)
    : (isLow ? `AI бүрэн итгэлгүй байна — Магадлал: ${value}%` : `Магадлал: ${value}%`);

  return (
    <div className={`mt-1.5 inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border ${wrap}`}>
      <AlertTriangle size={9} />
      <span>{label}</span>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Phase H — Escalation banner (CRITICAL band).
//
// Prominent block under the assistant bubble inviting the user to
// connect to a human operator. Renders when reflection.shouldEscalate
// fires (confidence < 50% OR a tool errored mid-turn).
// ────────────────────────────────────────────────────────────────────
export function ConfidenceEscalation({
  data, locale,
}: {
  data: NonNullable<AIResponse["escalation"]>;
  locale: "mn" | "en";
}) {
  return (
    <div className="mt-2 border border-rose-200 bg-rose-50 rounded-lg p-2.5 space-y-1.5">
      <div className="flex items-start gap-2 text-[12px]">
        <AlertTriangle size={13} className="text-rose-600 shrink-0 mt-0.5" />
        <span className="text-rose-900">{data.message}</span>
      </div>
      <Link
        href={data.suggestedAction.href}
        className="inline-block text-[11px] px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-md font-semibold transition-colors"
       >
        {locale === "en" ? "Contact operator →" : "Оператортой холбогдох →"}
      </Link>
    </div>
  );
}
