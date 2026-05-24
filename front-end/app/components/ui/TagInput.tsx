"use client";
import { useMemo, useState } from "react";
import { X, Plus } from "lucide-react";

interface TagInputProps {
  value: string[];
  onChange: (next: string[]) => void;
  suggestions?: string[];
  placeholder?: string;
  max?: number;
  /** Force lowercase and trim each token. */
  normalize?: boolean;
  className?: string;
}

const dedupe = (xs: string[]) => [...new Set(xs)];

export default function TagInput({
  value, onChange, suggestions = [],
  placeholder = "Tag нэмэх... (Enter)",
  max = 20,
  normalize = true,
  className = "",
}: TagInputProps) {
  const [draft, setDraft] = useState("");

  const norm = (s: string) => (normalize ? s.trim().toLowerCase() : s.trim());

  const suggested = useMemo(() => {
    const q = norm(draft);
    if (!q) return [];
    return suggestions
      .filter((s) => norm(s).includes(q) && !value.includes(norm(s)))
      .slice(0, 6);
  }, [draft, suggestions, value]);

  const add = (raw: string) => {
    const v = norm(raw);
    if (!v) return;
    if (value.includes(v)) { setDraft(""); return; }
    if (value.length >= max) return;
    onChange(dedupe([...value, v]));
    setDraft("");
  };
  const remove = (t: string) => onChange(value.filter((x) => x !== t));

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 focus-within:border-blue-500 focus-within:bg-white transition-colors">
        {value.map((t) => (
          <span key={t}
            className="inline-flex items-center gap-1 bg-blue-100 text-blue-700 text-[11px] font-medium px-2 py-0.5 rounded-full">
            {t}
            <button type="button" onClick={() => remove(t)}
              className="w-3.5 h-3.5 inline-flex items-center justify-center rounded-full text-blue-500 hover:text-white hover:bg-blue-500 cursor-pointer bg-transparent border-none">
              <X size={9} />
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(draft); }
            else if (e.key === "Backspace" && !draft && value.length > 0) {
              remove(value[value.length - 1]);
            }
          }}
          onBlur={() => add(draft)}
          placeholder={value.length === 0 ? placeholder : ""}
          className="flex-1 min-w-[100px] bg-transparent border-none outline-none text-[12px] font-sans"
          maxLength={40}
          disabled={value.length >= max}
        />
      </div>
      {suggested.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {suggested.map((s) => (
            <button key={s} type="button" onClick={() => add(s)}
              className="inline-flex items-center gap-0.5 text-[11px] border border-gray-200 hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700 rounded-full px-2 py-0.5 cursor-pointer bg-white text-gray-600 transition-colors font-sans">
              <Plus size={9} /> {s}
            </button>
          ))}
        </div>
      )}
      <div className="text-[10px] text-gray-400 mt-1">
        {value.length}/{max} tag
      </div>
    </div>
  );
}
