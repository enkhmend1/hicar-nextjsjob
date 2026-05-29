"use client";
import { useEffect, useState } from "react";
import { Calendar } from "lucide-react";

export type DateRange = { from: string; to: string };

const PRESETS: Array<{ id: string; label: string; days: number | "month" | "ytd" }> = [
  { id: "7d",  label: "7 хоног",   days: 7 },
  { id: "30d", label: "30 хоног",  days: 30 },
  { id: "90d", label: "90 хоног",  days: 90 },
  { id: "mtd", label: "Энэ сар",   days: "month" },
  { id: "ytd", label: "Энэ жил",   days: "ytd" },
];

const fmt = (d: Date) => d.toISOString().slice(0, 10);

export const computeRange = (presetId: string): DateRange => {
  const now = new Date();
  const to = fmt(now);
  if (presetId === "mtd") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: fmt(start), to };
  }
  if (presetId === "ytd") {
    const start = new Date(now.getFullYear(), 0, 1);
    return { from: fmt(start), to };
  }
  const days = Number(presetId.replace("d", "")) || 30;
  const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return { from: fmt(start), to };
};

export default function DateRangePicker({
  value, onChange, defaultPreset = "30d",
}: {
  value: DateRange;
  onChange: (r: DateRange) => void;
  defaultPreset?: string;
}) {
  const [activePreset, setActivePreset] = useState<string | null>(defaultPreset);
  const [isCustom, setIsCustom] = useState(false);

  // Initialise default range once
  useEffect(() => {
    if (!value.from && !value.to) onChange(computeRange(defaultPreset));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickPreset = (id: string) => {
    setActivePreset(id);
    setIsCustom(false);
    onChange(computeRange(id));
  };

  const onCustom = (key: keyof DateRange, v: string) => {
    setActivePreset(null);
    setIsCustom(true);
    onChange({ ...value, [key]: v });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1 bg-gray-50 border border-gray-200 rounded-lg px-1 py-0.5">
        {PRESETS.map((p) => (
          <button key={p.id} type="button" onClick={() => pickPreset(p.id)}
            className={`px-2.5 py-1 text-[12px] font-medium rounded-md cursor-pointer border-none transition-colors font-sans ${
              activePreset === p.id
                ? "bg-blue-600 text-white"
                : "bg-transparent text-gray-600 hover:text-blue-700"
            }`}>
            {p.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1.5 text-[12px] text-gray-500">
        <Calendar size={13} className={isCustom ? "text-blue-500" : ""} />
        <input type="date" value={value.from || ""} onChange={(e) => onCustom("from", e.target.value)}
          className="bg-white border border-gray-200 rounded-md px-2 py-1 text-[12px] focus:border-blue-500 outline-none font-sans" />
        <span className="text-gray-400">→</span>
        <input type="date" value={value.to || ""} onChange={(e) => onCustom("to", e.target.value)}
          className="bg-white border border-gray-200 rounded-md px-2 py-1 text-[12px] focus:border-blue-500 outline-none font-sans" />
      </div>
    </div>
  );
}
