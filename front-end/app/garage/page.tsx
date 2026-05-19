"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Navbar from "@/app/components/Navbar";
import { useAuthStore } from "@/store";
import { api } from "@/lib/api";
import { Vehicle } from "@/app/types";
import { Car, Plus, Pencil, Trash2, X, Star } from "lucide-react";

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

  const reload = () => {
    setLoading(true);
    api.get<{ vehicles: Vehicle[] }>("/vehicles")
      .then(d => setVehicles(d.vehicles))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!_hasHydrated) return;
    if (!user) { router.push("/auth/login"); return; }
    reload();
  }, [user, _hasHydrated, router]);

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

  return (
    <>
      <Navbar />
      <div className="max-w-3xl mx-auto px-5 py-5">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-[22px] font-semibold text-gray-900 flex items-center gap-2">
              <Car size={22} className="text-violet-600" />
              Миний машинууд
            </h1>
            <p className="text-[13px] text-gray-500 mt-0.5">Машинаа бүртгүүлэн тохирох сэлбэг хайхад тус болно</p>
          </div>
          <button onClick={() => setEditing({ ...emptyForm })}
            className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-700 text-white rounded-lg px-3 py-2 text-[13px] font-semibold cursor-pointer border-none transition-colors font-sans">
            <Plus size={14} /> Шинэ машин
          </button>
        </div>

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
            <p className="text-[12px] text-gray-400 mb-4">"Шинэ машин" товчоор эхэлнэ үү</p>
          </div>
        ) : (
          <div className="space-y-3">
            {vehicles.map(v => (
              <div key={v._id} className="bg-white border border-gray-200 rounded-2xl p-4 flex flex-wrap items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white flex items-center justify-center shrink-0">
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
                    className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-gray-400 hover:text-violet-600 hover:bg-violet-50 cursor-pointer bg-transparent border-none transition-colors">
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
                    className="accent-violet-600 w-4 h-4" />
                  <span className="text-[13px] text-gray-700">Үндсэн машин болгох</span>
                </label>

                <div className="flex gap-2 pt-3 border-t border-gray-100">
                  <button type="button" onClick={() => setEditing(null)} disabled={busy}
                    className="flex-1 border border-gray-200 rounded-lg py-2.5 text-[13px] text-gray-600 cursor-pointer bg-white font-sans">
                    Болих
                  </button>
                  <button type="submit" disabled={busy}
                    className="flex-1 bg-violet-600 hover:bg-violet-700 disabled:bg-violet-300 text-white rounded-lg py-2.5 text-[13px] font-semibold cursor-pointer border-none transition-colors font-sans">
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
    </>
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
