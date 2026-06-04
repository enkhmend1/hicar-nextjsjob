"use client";

import { useState } from "react";
import type { DiagField } from "./types";

// ────────────────────────────────────────────────────────────────────
// DiagFormCard — inline disambiguation widget rendered by layout="diag_form".
//
// Tiny self-contained form that captures the answers the AI asked for
// (year / model / side / position) and submits them back as a single
// chat turn. We deliberately keep it minimal — the source of truth for
// available fields is the backend's vagueQueryFormFor() registry.
// ────────────────────────────────────────────────────────────────────
export default function DiagFormCard({
  data, locale, onSubmit,
}: {
  data: { partType: string; fields: DiagField[]; note?: string };
  locale: "mn" | "en";
  onSubmit: (answers: Record<string, string>) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const ready = data.fields
    .filter((f) => f.required)
    .every((f) => answers[f.key] && answers[f.key].length > 0);

  return (
    <div className="mt-2 border border-amber-200 bg-amber-50 rounded-lg p-2 space-y-1.5 text-[12px]">
      <div className="font-semibold text-amber-800">
        {locale === "en" ? `Narrow down: ${data.partType}` : `Тодруулъя — ${data.partType}`}
      </div>
      {data.note && <div className="text-[10px] text-amber-700 italic">{data.note}</div>}
      {data.fields.map((f) => (
        <div key={f.key} className="flex items-center gap-2">
          <label className="w-24 text-amber-900 shrink-0">{f.label}{f.required ? " *" : ""}</label>
          {f.type === "select" && f.options ? (
            <select
              value={answers[f.key] || ""}
              onChange={(e) => setAnswers((a) => ({ ...a, [f.key]: e.target.value }))}
              className="flex-1 bg-white border border-amber-300 rounded px-2 py-1 text-[12px] outline-none">
              <option value="">—</option>
              {f.options.map((o) => (<option key={o} value={o}>{o}</option>))}
            </select>
          ) : f.type === "year" ? (
            <input
              type="number" min={1980} max={2030}
              value={answers[f.key] || ""}
              onChange={(e) => setAnswers((a) => ({ ...a, [f.key]: e.target.value }))}
              className="flex-1 bg-white border border-amber-300 rounded px-2 py-1 text-[12px] outline-none" />
          ) : (
            <input
              type="text"
              value={answers[f.key] || ""}
              onChange={(e) => setAnswers((a) => ({ ...a, [f.key]: e.target.value }))}
              className="flex-1 bg-white border border-amber-300 rounded px-2 py-1 text-[12px] outline-none" />
          )}
        </div>
      ))}
      <button
        onClick={() => onSubmit(answers)}
        disabled={!ready}
        className="w-full mt-1 bg-amber-600 hover:bg-amber-700 disabled:bg-amber-300 text-white rounded px-2 py-1.5 text-[12px] font-semibold cursor-pointer border-none transition-colors">
        {locale === "en" ? "Search →" : "Хайх →"}
      </button>
    </div>
  );
}
