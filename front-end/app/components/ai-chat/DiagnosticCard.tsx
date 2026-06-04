import type { Message } from "./types";

// ────────────────────────────────────────────────────────────────────
// Phase I — DiagnosticCard.
//
// Renders layout="diagnostic" payloads as a mechanic's-style ranked
// candidate list with a horizontal likelihood bar per row, plus ONE
// clarifying-question prompt that the user can answer in-place by
// clicking the chip (which then submits as the next user message).
//
// Urgency colour-codes the card border:
//   low    — slate (informational)
//   medium — amber (worth checking soon)
//   high   — rose  (safety / drivability — bring to mechanic)
// ────────────────────────────────────────────────────────────────────
export default function DiagnosticCard({
  data, locale, onQuickAnswer,
}: {
  data: NonNullable<Message["diagnostic"]>;
  locale: "mn" | "en";
  onQuickAnswer: (text: string) => void;
}) {
  const urgencyStyle = {
    low:    { wrap: "border-slate-200 bg-slate-50", chip: "bg-slate-200 text-slate-700", label: locale === "en" ? "Low" : "Бага" },
    medium: { wrap: "border-amber-200 bg-amber-50",  chip: "bg-amber-200 text-amber-800",  label: locale === "en" ? "Medium" : "Дунд" },
    high:   { wrap: "border-rose-200 bg-rose-50",    chip: "bg-rose-200 text-rose-800",    label: locale === "en" ? "High" : "Өндөр" },
  }[data.urgency];

  return (
    <div className={`mt-2 border rounded-lg overflow-hidden text-[11px] ${urgencyStyle.wrap}`}>
      {/* Header — symptom + urgency badge */}
      <div className="px-2.5 py-1.5 flex items-center gap-2 border-b border-current/10">
        <span className="font-semibold text-gray-800 truncate flex-1">
          {locale === "en" ? "Possible causes" : "Боломжит шалтгаан"}
        </span>
        <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold ${urgencyStyle.chip}`}>
          {locale === "en" ? "Urgency" : "Чухал"}: {urgencyStyle.label}
        </span>
      </div>

      {/* Candidate ranked list */}
      <div className="px-2.5 py-1.5 space-y-1.5 bg-white">
        {data.candidates.map((c, i) => {
          const pct = Math.round((c.likelihood || 0) * 100);
          return (
            <div key={`${c.name}-${i}`} className="space-y-0.5">
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-gray-700 truncate flex-1">
                  {i + 1}. {c.name}
                </span>
                <span className="text-[10px] text-gray-500 font-mono shrink-0">{pct}%</span>
              </div>
              <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className={`h-full ${
                    c.urgency === "high"   ? "bg-rose-500" :
                    c.urgency === "medium" ? "bg-amber-500" :
                                              "bg-slate-400"
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              {c.location && (
                <div className="text-[10px] text-gray-500">📍 {c.location}</div>
              )}
            </div>
          );
        })}
      </div>

      {/* Clarifying question chips */}
      {data.clarifyingQuestions.length > 0 && (
        <div className="px-2.5 py-1.5 border-t border-current/10 space-y-1">
          <div className="text-[10px] text-gray-500 uppercase tracking-wide font-semibold">
            {locale === "en" ? "Help narrow it down" : "Нэмэлт асуулт"}
          </div>
          {data.clarifyingQuestions.slice(0, 2).map((q, i) => (
            <button
              key={i}
              onClick={() => onQuickAnswer(q)}
              className="w-full text-left text-[11px] px-2 py-1.5 bg-white hover:bg-blue-50 border border-gray-200 hover:border-blue-300 rounded cursor-pointer transition-colors font-sans text-gray-700">
              ❓ {q}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
