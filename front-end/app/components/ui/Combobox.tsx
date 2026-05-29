"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Plus, Check, X } from "lucide-react";

/**
 * Combobox — accessible autocomplete + create-on-the-fly.
 *
 * Designed as a drop-in replacement for `<select>` when the option list
 * should be (a) searchable, (b) extensible by the user, and (c) able to
 * surface a "Recently used" group above the global list.
 */

interface Group {
  label?: string;
  options: string[];
}

interface ComboboxProps {
  value: string;
  onChange: (v: string) => void;
  options?: string[];
  groups?: Group[];
  placeholder?: string;
  allowCreate?: boolean;
  createLabel?: (input: string) => string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  /** Optional formatter (e.g. capitalise for display). Value passed to onChange is always raw. */
  format?: (s: string) => string;
}

export default function Combobox({
  value, onChange, options = [], groups,
  placeholder = "Сонгох эсвэл бичих...",
  allowCreate = true,
  createLabel = (s) => `"${s}" нэмэх`,
  required, disabled,
  className = "",
  format = (s) => s,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Build a flat searchable list with optional group dividers
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const allGroups: Group[] = groups && groups.length > 0 ? groups : [{ options }];
    const out: Array<{ kind: "header"; label: string } | { kind: "option"; value: string }> = [];
    let hasAny = false;
    for (const g of allGroups) {
      const matches = g.options
        .filter((o) => !q || o.toLowerCase().includes(q))
        .filter((o, i, arr) => arr.indexOf(o) === i);
      if (matches.length === 0) continue;
      if (g.label) out.push({ kind: "header", label: g.label });
      for (const o of matches) {
        out.push({ kind: "option", value: o });
        hasAny = true;
      }
    }
    // Surface create suggestion if input doesn't exactly match any option
    if (allowCreate && q && !out.some((r) => r.kind === "option" && r.value.toLowerCase() === q)) {
      out.push({ kind: "option", value: `__create__:${query.trim()}` });
    }
    void hasAny;
    return out;
  }, [groups, options, query, allowCreate]);

  // Click outside to close
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Keep highlight in bounds — reset cursor when query or visibility flips.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHighlight(0);
  }, [query, open]);

  const selectableIndices = useMemo(
    () => filtered.map((r, i) => (r.kind === "option" ? i : -1)).filter((i) => i >= 0),
    [filtered],
  );

  const pick = (raw: string) => {
    const final = raw.startsWith("__create__:") ? raw.slice("__create__:".length) : raw;
    onChange(final);
    setQuery("");
    setOpen(false);
  };

  const moveHighlight = (delta: number) => {
    const idx = selectableIndices.indexOf(highlight);
    const next = (idx + delta + selectableIndices.length) % Math.max(1, selectableIndices.length);
    setHighlight(selectableIndices[next] ?? 0);
  };

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      {open ? (
        <div className="flex items-center bg-white border border-blue-500 rounded-lg pl-2.5 pr-1 py-1.5 focus-within:ring-2 focus-within:ring-blue-100">
          <input
            ref={inputRef}
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); moveHighlight(1); }
              else if (e.key === "ArrowUp") { e.preventDefault(); moveHighlight(-1); }
              else if (e.key === "Enter") {
                e.preventDefault();
                const row = filtered[highlight];
                if (row && row.kind === "option") pick(row.value);
                else if (allowCreate && query.trim()) pick(`__create__:${query.trim()}`);
              } else if (e.key === "Escape") {
                e.preventDefault();
                setOpen(false);
              }
            }}
            placeholder={placeholder}
            className="flex-1 text-[13px] bg-transparent border-none outline-none font-sans"
          />
          {query && (
            <button type="button" onClick={() => setQuery("")}
              className="w-6 h-6 inline-flex items-center justify-center text-gray-400 hover:text-gray-700 cursor-pointer bg-transparent border-none">
              <X size={12} />
            </button>
          )}
        </div>
      ) : (
        <button type="button" disabled={disabled}
          onClick={() => { setOpen(true); setTimeout(() => inputRef.current?.focus(), 0); }}
          className="w-full flex items-center justify-between bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-[13px] hover:border-blue-400 focus:border-blue-500 focus:bg-white outline-none cursor-pointer font-sans disabled:opacity-50">
          <span className={value ? "text-gray-900" : "text-gray-400"}>
            {value ? format(value) : placeholder}
          </span>
          <ChevronDown size={13} className="text-gray-400 shrink-0" />
        </button>
      )}

      {required && (
        <input
          tabIndex={-1}
          aria-hidden
          required
          value={value}
          onChange={() => {}}
          className="absolute inset-0 w-full h-full opacity-0 pointer-events-none"
        />
      )}

      {open && (
        <ul className="absolute z-50 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-64 overflow-y-auto py-1">
          {filtered.length === 0 && (
            <li className="px-3 py-2 text-[12px] text-gray-400 text-center">Илэрц байхгүй</li>
          )}
          {filtered.map((r, i) => {
            if (r.kind === "header") {
              return (
                <li key={`h-${i}`} className="px-3 py-1 text-[10px] uppercase tracking-wide text-gray-400 font-semibold">
                  {r.label}
                </li>
              );
            }
            const isCreate = r.value.startsWith("__create__:");
            const display = isCreate ? r.value.slice("__create__:".length) : r.value;
            const isHighlight = i === highlight;
            const isSelected = !isCreate && value === r.value;
            return (
              <li key={`o-${i}-${r.value}`}>
                <button type="button"
                  onClick={() => pick(r.value)}
                  onMouseEnter={() => setHighlight(i)}
                  className={`w-full text-left flex items-center justify-between gap-2 px-3 py-1.5 text-[13px] cursor-pointer bg-transparent border-none font-sans ${
                    isHighlight ? "bg-blue-50 text-blue-700" : "text-gray-700"
                  } ${isSelected ? "font-semibold" : ""}`}>
                  <span className="flex items-center gap-1.5 truncate">
                    {isCreate && <Plus size={11} className="text-blue-600" />}
                    {isCreate ? createLabel(display) : format(display)}
                  </span>
                  {isSelected && <Check size={12} className="text-blue-600 shrink-0" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
