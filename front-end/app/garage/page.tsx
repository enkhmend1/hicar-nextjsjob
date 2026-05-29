"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import BuyerShell from "@/app/components/BuyerShell";
import { useAuthStore, useCarStore } from "@/store";
import { api, ApiError } from "@/lib/api";
import { toast } from "@/app/lib/toast";
import { Vehicle } from "@/app/types";
import { Car, Plus, Pencil, Trash2, X, Star, Save, Loader2, History, RefreshCw } from "lucide-react";

/**
 * Wire shape of GET /api/vehicle/:id — used by the "Шинэчлэх" button on
 * the "Сүүлд хайсан" cards. Backend's publicVehicle() already returns
 * displacement + carname + engineCode, but old localStorage entries from
 * before Phase AE only have engineCode/engineType (no displacement). This
 * endpoint re-fetches the canonical snapshot from the Vehicle cache so
 * stale recents pick up the new shape without the user having to do a
 * full /lookup round-trip.
 */
interface PublicVehicleResponse {
  id: string;
  plate: string;
  manufacturer: string;
  model: string;
  generation?: string;
  engineCode?: string;
  engineType?: string;
  displacement?: string;
  carname?: string;
}

const emptyForm: Partial<Vehicle> = {
  plate: "", vin: "", make: "", model: "", year: new Date().getFullYear(),
  engine: "", chassis: "", color: "", isDefault: false,
};

export default function GaragePage() {
  const router = useRouter();
  const { user, _hasHydrated } = useAuthStore();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<Vehicle> | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // Phase AD: recent vehicles from plate-lookup / chat AI live in Zustand
  // (localStorage). They're SEPARATE from the persisted Garage docs the
  // /api/garage endpoint serves. Surfacing them here lets the user
  // promote a recent lookup into a saved garage entry in one click.
  const recentVehicles      = useCarStore((s) => s.recentVehicles);
  const removeRecentVehicle = useCarStore((s) => s.removeRecentVehicle);
  const pushRecentVehicle   = useCarStore((s) => s.pushRecentVehicle);
  const carHydrated         = useCarStore((s) => s._hasHydrated);
  const [savingRecentId,    setSavingRecentId]    = useState<string | null>(null);
  const [refreshingRecentId, setRefreshingRecentId] = useState<string | null>(null);

  const reload = () => {
    setLoading(true);
    api.get<{ vehicles: Vehicle[] }>("/vehicles")
      .then(d => setVehicles(d.vehicles))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!_hasHydrated) return;
    if (!user) { router.push("/auth/login"); return; }
    // Defer to a microtask so the setLoading(true) inside reload()
    // doesn't fire synchronously inside the effect body — React 19
    // warns about that pattern because it cascades renders. The
    // microtask runs after the effect commits, eliminating the cascade.
    queueMicrotask(reload);
  }, [user, _hasHydrated, router]);

  // Filter out recents that are ALREADY saved as Garage entries (by
  // plate match — case-insensitive, whitespace-normalised). This is
  // the dedup signal the user actually cares about: "is THIS plate
  // already in my garage". The Garage doc's `vehicleRef` is unreliable
  // because lookups don't always pin one.
  const norm = (s: string | null | undefined) =>
    String(s || "").replace(/\s+/g, "").toUpperCase();
  const unsavedRecents = useMemo(() => {
    if (!carHydrated) return [];
    const savedPlates = new Set(vehicles.map((v) => norm(v.plate)));
    return recentVehicles.filter((r) => !savedPlates.has(norm(r.plate)));
  }, [recentVehicles, vehicles, carHydrated]);

  if (!_hasHydrated || !user) return null;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setBusy(true); setErr("");
    try {
      const body = { ...editing, year: Number(editing.year) };
      if (editing._id) await api.put(`/vehicles/${editing._id}`, body);
      else await api.post("/vehicles", body);
      setEditing(null);
      reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (v: Vehicle) => {
    if (!confirm(`${v.make} ${v.model}-г устгах уу?`)) return;
    await api.delete(`/vehicles/${v._id}`);
    reload();
  };

  // Promote a recent lookup → persistent Garage doc. We pre-fill from
  // the recent vehicle's data and POST directly — no modal — because the
  // recent already has enough info (make/model/plate/engine code).
  // User can still Pencil-edit afterwards to add color/VIN.
  //
  // Phase AE field-mapping rules (per buyer feedback):
  //   • engine   ← engineCode (motorcode like "2GR-FSE"). engineType
  //               ("gasoline"/"hybrid") is NOT the engine name — that
  //               was the old bug. Buyers identify engines by code.
  //   • chassis  ← "" empty by default. The Garage `chassis` field is
  //               for the 17-char VIN, NOT the generation code.
  //               Generation (e.g. "AZE156") stays out — user can add
  //               it manually via Pencil if they want.
  //   • year     ← current year as a safe default. Lookup data rarely
  //               carries production year; user edits if wrong.
  // Re-fetch the canonical Vehicle snapshot for a stale recent and write
  // it back to the Zustand store. Used to retro-fit pre-Phase-AE recents
  // (which lack `displacement` / `carname`) without requiring the user
  // to re-do a full /lookup. Idempotent on the server side — just reads
  // the cached Vehicle doc.
  const refreshRecent = async (recentId: string) => {
    setRefreshingRecentId(recentId);
    try {
      const { vehicle } = await api.get<{ vehicle: PublicVehicleResponse }>(
        `/vehicle/${recentId}`,
      );
      pushRecentVehicle({
        id:           vehicle.id,
        plate:        vehicle.plate,
        manufacturer: vehicle.manufacturer,
        model:        vehicle.model,
        generation:   vehicle.generation,
        engineCode:   vehicle.engineCode,
        engineType:   vehicle.engineType,
        displacement: vehicle.displacement,
        carname:      vehicle.carname,
      });
      toast.success("Машины мэдээлэл шинэчлэгдлээ");
    } catch (e) {
      const msg = e instanceof ApiError && e.status === 404
        ? "Энэ машин кэшээс устаагдсан байж магадгүй — дугаараар дахин хайна уу"
        : "Шинэчилж чадсангүй";
      toast.error(msg);
    } finally {
      setRefreshingRecentId(null);
    }
  };

  const saveRecent = async (recentId: string) => {
    const r = recentVehicles.find((v) => v.id === recentId);
    if (!r) return;
    setSavingRecentId(recentId);
    try {
      await api.post<{ vehicle: Vehicle }>("/vehicles", {
        make:    r.manufacturer,
        model:   r.model,
        year:    new Date().getFullYear(),
        plate:   r.plate,
        chassis: "",                       // EMPTY — never auto-fill VIN from generation
        engine:  r.engineCode || "",       // motorcode is the engine identifier
        vehicleRef: r.id,
      });
      toast.success(`${r.manufacturer} ${r.model} гаражид хадгалагдлаа`);
      reload();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Хадгалж чадсангүй";
      toast.error(msg);
    } finally {
      setSavingRecentId(null);
    }
  };

  return (
    <BuyerShell>
      <div className="max-w-3xl mx-auto px-5 py-5">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-[22px] font-semibold text-gray-900 flex items-center gap-2">
              <Car size={22} className="text-blue-600" />
              Миний машинууд
            </h1>
            <p className="text-[13px] text-gray-500 mt-0.5">Машинаа бүртгүүлэн тохирох сэлбэг хайхад тус болно</p>
          </div>
          <button onClick={() => setEditing({ ...emptyForm })}
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-3 py-2 text-[13px] font-semibold cursor-pointer border-none transition-colors font-sans">
            <Plus size={14} /> Шинэ машин
          </button>
        </div>

        {/* ── Phase AD: Сүүлд хайсан машинууд (Zustand recents) ───── */}
        {unsavedRecents.length > 0 && (
          <section className="mb-5 bg-gradient-to-br from-blue-50/60 to-amber-50/40 border border-blue-200 rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <History size={14} className="text-blue-700" />
              <h2 className="text-[13px] font-semibold text-blue-900">
                Сүүлд хайсан машинууд
              </h2>
              <span className="text-[10px] bg-white text-blue-700 border border-blue-200 px-2 py-0.5 rounded-full font-medium">
                {unsavedRecents.length}
              </span>
            </div>
            <p className="text-[11px] text-blue-800/80 mb-3">
              Plate lookup эсвэл AI чатаар асууж байсан машинууд. Удаан ашиглах
              бол гаражид нэмж хадгална уу.
            </p>
            <div className="space-y-2">
              {unsavedRecents.map((r) => {
                const isSaving     = savingRecentId === r.id;
                const isRefreshing = refreshingRecentId === r.id;
                return (
                  <div
                    key={r.id}
                    className="bg-white border border-blue-100 rounded-xl p-3 flex items-center gap-3"
                  >
                    <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-100 to-amber-100 text-blue-700 flex items-center justify-center shrink-0">
                      <Car size={15} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-semibold text-gray-900 truncate">
                        {r.manufacturer} {r.model}
                        {r.generation && (
                          <span className="text-gray-400 font-normal"> · {r.generation}</span>
                        )}
                      </div>
                      <div className="text-[11px] text-gray-500 font-mono truncate">
                        {r.plate}
                      </div>
                      {/* Phase AE: surface engine info before "Хадгалах"
                          so the buyer sees what will end up in the form.
                          Hides the row entirely when no engine data — no
                          empty "Хөдөлгүүр:" labels. */}
                      {(r.engineCode || r.displacement || r.engineType) && (
                        <div className="flex flex-wrap gap-1.5 mt-1 text-[10px]">
                          {r.engineCode && (
                            <span className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 border border-blue-100 px-1.5 py-0.5 rounded font-mono">
                              ⚙ {r.engineCode}
                            </span>
                          )}
                          {r.displacement && (
                            <span className="inline-flex items-center gap-1 bg-gray-50 text-gray-600 border border-gray-200 px-1.5 py-0.5 rounded">
                              {r.displacement}
                            </span>
                          )}
                          {r.engineType && (
                            <span className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 border border-emerald-100 px-1.5 py-0.5 rounded capitalize">
                              {r.engineType}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button
                        onClick={() => refreshRecent(r.id)}
                        disabled={isRefreshing || isSaving}
                        aria-label="Серверээс шинэчлэх"
                        title="Серверээс шинэчлэх (engine/displacement)"
                        className="w-7 h-7 inline-flex items-center justify-center rounded-md text-gray-400 hover:text-blue-600 hover:bg-blue-50 cursor-pointer bg-transparent border-none transition-colors disabled:opacity-40"
                      >
                        {isRefreshing
                          ? <Loader2 size={12} className="animate-spin" />
                          : <RefreshCw size={12} />}
                      </button>
                      <button
                        onClick={() => saveRecent(r.id)}
                        disabled={isSaving || isRefreshing}
                        className="inline-flex items-center gap-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-[11px] font-semibold rounded-md px-2.5 py-1.5 cursor-pointer border-none transition-colors font-sans"
                      >
                        {isSaving ? (
                          <Loader2 size={11} className="animate-spin" />
                        ) : (
                          <Save size={11} />
                        )}
                        Хадгалах
                      </button>
                      <button
                        onClick={() => removeRecentVehicle(r.id)}
                        aria-label="Түүхээс хасах"
                        title="Түүхээс хасах"
                        className="w-7 h-7 inline-flex items-center justify-center rounded-md text-gray-300 hover:text-red-500 hover:bg-red-50 cursor-pointer bg-transparent border-none transition-colors"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="bg-white border border-gray-200 rounded-2xl h-[100px] animate-pulse" />
            ))}
          </div>
        ) : vehicles.length === 0 ? (
          <div className="text-center py-16 bg-white border border-gray-200 rounded-2xl">
            <Car size={36} className="mx-auto text-gray-300 mb-3" />
            <p className="text-[14px] font-medium text-gray-700 mb-2">Машин бүртгээгүй байна</p>
            <p className="text-[12px] text-gray-400 mb-4">&ldquo;Шинэ машин&rdquo; товчоор эхэлнэ үү</p>
          </div>
        ) : (
          <div className="space-y-3">
            {vehicles.map(v => (
              <div key={v._id} className="bg-white border border-gray-200 rounded-2xl p-4 flex flex-wrap items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-amber-500 text-white flex items-center justify-center shrink-0">
                  <Car size={20} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[15px] font-semibold text-gray-900">{v.make} {v.model}</span>
                    <span className="text-[13px] text-gray-500">{v.year}</span>
                    {v.isDefault && (
                      <span className="inline-flex items-center gap-1 text-[10px] bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full font-medium">
                        <Star size={9} fill="currentColor" /> Үндсэн
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-3 text-[12px] text-gray-500 mt-1">
                    {v.plate && <span className="font-mono font-medium">🚗 {v.plate}</span>}
                    {v.engine && <span>⚙️ {v.engine}</span>}
                    {v.chassis && <span className="font-mono">{v.chassis}</span>}
                    {v.color && <span>🎨 {v.color}</span>}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => setEditing(v)}
                    className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 cursor-pointer bg-transparent border-none transition-colors">
                    <Pencil size={14} />
                  </button>
                  <button onClick={() => remove(v)}
                    className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 cursor-pointer bg-transparent border-none transition-colors">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {editing && (
          <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => !busy && setEditing(null)}>
            <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
              <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                <h2 className="text-[15px] font-semibold text-gray-900">
                  {editing._id ? "Машин засах" : "Шинэ машин"}
                </h2>
                <button onClick={() => setEditing(null)}
                  className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 cursor-pointer bg-transparent border-none">
                  <X size={16} />
                </button>
              </div>
              <form onSubmit={save} className="p-5 space-y-3">
                {err && <div className="bg-red-50 border border-red-200 text-red-600 text-[12px] rounded-lg px-3 py-2">{err}</div>}
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Үйлдвэрлэгч *">
                    <input required value={editing.make ?? ""} onChange={e => setEditing(s => ({ ...s, make: e.target.value }))} className="input" placeholder="Toyota" />
                  </Field>
                  <Field label="Загвар *">
                    <input required value={editing.model ?? ""} onChange={e => setEditing(s => ({ ...s, model: e.target.value }))} className="input" placeholder="Prius" />
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Он *">
                    <input required type="number" min={1980} max={new Date().getFullYear() + 1} value={editing.year ?? ""}
                      onChange={e => setEditing(s => ({ ...s, year: Number(e.target.value) }))} className="input" />
                  </Field>
                  <Field label="Хөдөлгүүр">
                    <input value={editing.engine ?? ""} onChange={e => setEditing(s => ({ ...s, engine: e.target.value }))} className="input" placeholder="1.8L Hybrid" />
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Улсын дугаар">
                    <input value={editing.plate ?? ""} onChange={e => setEditing(s => ({ ...s, plate: e.target.value }))} className="input font-mono" placeholder="УБ 1234 АА" />
                  </Field>
                  <Field label="Chassis / VIN">
                    <input value={editing.chassis ?? ""} onChange={e => setEditing(s => ({ ...s, chassis: e.target.value }))} className="input font-mono" placeholder="ZVW50" />
                  </Field>
                </div>
                <Field label="Өнгө">
                  <input value={editing.color ?? ""} onChange={e => setEditing(s => ({ ...s, color: e.target.value }))} className="input" placeholder="Цагаан" />
                </Field>
                <label className="flex items-center gap-2 cursor-pointer pt-1">
                  <input type="checkbox" checked={!!editing.isDefault} onChange={e => setEditing(s => ({ ...s, isDefault: e.target.checked }))}
                    className="accent-blue-600 w-4 h-4" />
                  <span className="text-[13px] text-gray-700">Үндсэн машин болгох</span>
                </label>

                <div className="flex gap-2 pt-3 border-t border-gray-100">
                  <button type="button" onClick={() => setEditing(null)} disabled={busy}
                    className="flex-1 border border-gray-200 rounded-lg py-2.5 text-[13px] text-gray-600 cursor-pointer bg-white font-sans">
                    Болих
                  </button>
                  <button type="submit" disabled={busy}
                    className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-lg py-2.5 text-[13px] font-semibold cursor-pointer border-none transition-colors font-sans">
                    {busy ? "Хадгалж байна..." : "Хадгалах"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>

      <style jsx>{`
        :global(.input) {
          width: 100%;
          background: #f9fafb;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          padding: 8px 12px;
          font-size: 13px;
          font-family: inherit;
          color: #111;
        }
        :global(.input:focus) {
          outline: none;
          border-color: #8b5cf6;
          background: white;
        }
      `}</style>
    </BuyerShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[12px] font-medium text-gray-700 mb-1">{label}</label>
      {children}
    </div>
  );
}
