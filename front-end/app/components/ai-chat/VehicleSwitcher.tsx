"use client";

import { Car, X, Loader2, Search as SearchIcon, AlertTriangle } from "lucide-react";
import type { ActiveVehicle } from "@/store";

// ────────────────────────────────────────────────────────────────────
// VehicleSwitcher — Phase G dropdown rendered below the chat header.
//
// One self-contained panel for THREE entry points:
//   ① "Active vehicle" row at the top (with a Clear button)
//   ② Recent vehicles list (move-to-front LRU, capped at 5)
//   ③ Plate input — manual lookup that creates/activates a Vehicle
//
// All actions resolve via callbacks the parent supplied, so the
// switcher is purely presentational. State (loading, error) is also
// owned by the parent so a stale switcher mount can't get out of sync
// after a chat re-render.
// ────────────────────────────────────────────────────────────────────
export default function VehicleSwitcher({
  activeVehicle, recentVehicles, plateInput, plateBusy, plateErr,
  locale, onPlateInputChange, onLookupPlate, onPickRecent, onClear, onClose,
}: {
  activeVehicle:       ActiveVehicle | null;
  recentVehicles:      ActiveVehicle[];
  plateInput:          string;
  plateBusy:           boolean;
  plateErr:            string;
  locale:              "mn" | "en";
  onPlateInputChange:  (v: string) => void;
  onLookupPlate:       () => void;
  onPickRecent:        (vehicleId: string) => void;
  onClear:             () => void;
  onClose:             () => void;
}) {
  // Filter out the active vehicle from the "recents" list — showing
  // it twice is noise.
  const others = recentVehicles.filter((v) => v.id !== activeVehicle?.id);

  return (
    <div className="border-b border-gray-200 bg-white px-3 py-2.5 text-[12px] space-y-2">
      {/* Active vehicle row */}
      <div className="flex items-center gap-2">
        <Car size={13} className="text-blue-600 shrink-0" />
        <div className="flex-1 min-w-0">
          {activeVehicle ? (
            <>
              <div className="font-semibold text-gray-900 truncate">
                {activeVehicle.manufacturer} {activeVehicle.model}
                {activeVehicle.generation && (
                  <span className="text-gray-400 font-normal"> · {activeVehicle.generation}</span>
                )}
              </div>
              <div className="text-[10px] text-gray-500 font-mono">{activeVehicle.plate}</div>
            </>
          ) : (
            <div className="text-gray-500 italic">
              {locale === "en" ? "No vehicle selected" : "Машин сонгоогүй"}
            </div>
          )}
        </div>
        {activeVehicle && (
          <button
            onClick={onClear} disabled={plateBusy}
            title={locale === "en" ? "Clear vehicle" : "Машингүй болгох"}
            className="text-[10px] px-2 py-0.5 rounded border border-gray-200 text-gray-500 hover:text-red-600 hover:border-red-300 cursor-pointer bg-white transition-colors disabled:opacity-50 font-sans">
            {locale === "en" ? "Clear" : "Цуцлах"}
          </button>
        )}
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 cursor-pointer bg-transparent border-none p-0.5">
          <X size={12} />
        </button>
      </div>

      {/* Recents */}
      {others.length > 0 && (
        <div className="space-y-1 pt-1 border-t border-gray-100">
          <div className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">
            {locale === "en" ? "Recent" : "Сүүлийн машинууд"}
          </div>
          <div className="space-y-0.5">
            {others.map((v) => (
              <button
                key={v.id}
                onClick={() => onPickRecent(v.id)}
                disabled={plateBusy}
                className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-blue-50 cursor-pointer bg-transparent border-none transition-colors disabled:opacity-50 font-sans">
                <Car size={11} className="text-gray-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] text-gray-800 truncate">
                    {v.manufacturer} {v.model}
                    {v.generation && <span className="text-gray-400 font-normal"> · {v.generation}</span>}
                  </div>
                  <div className="text-[10px] text-gray-400 font-mono">{v.plate}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Manual plate input */}
      <div className="pt-1 border-t border-gray-100 space-y-1.5">
        <div className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">
          {locale === "en" ? "New plate" : "Шинэ дугаар"}
        </div>
        <div className="flex gap-1.5">
          <input
            value={plateInput}
            onChange={(e) => onPlateInputChange(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === "Enter" && !plateBusy && onLookupPlate()}
            placeholder="1234УБА"
            className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1.5 text-[16px] md:text-[12px] font-mono focus:border-blue-500 focus:bg-white outline-none transition-colors"
            autoCapitalize="characters"
            spellCheck={false}
          />
          <button
            onClick={onLookupPlate}
            disabled={plateBusy || !plateInput.trim()}
            className="shrink-0 inline-flex items-center gap-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-lg px-2.5 py-1.5 text-[11px] font-semibold cursor-pointer border-none transition-colors font-sans">
            {plateBusy
              ? <Loader2 size={11} className="animate-spin" />
              : <SearchIcon size={11} />}
            {locale === "en" ? "Look up" : "Хайх"}
          </button>
        </div>
        {plateErr && (
          <div className="text-[11px] text-red-600 flex items-center gap-1">
            <AlertTriangle size={10} /> {plateErr}
          </div>
        )}
        <div className="text-[10px] text-gray-400 italic">
          {locale === "en"
            ? "Tip: type /car anywhere to open this menu."
            : "Зөвлөгөө: чат дотор /car бичвэл энэ цонх нээгдэнэ."}
        </div>
      </div>
    </div>
  );
}
