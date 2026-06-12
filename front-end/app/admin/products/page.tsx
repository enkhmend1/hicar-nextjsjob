"use client";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { api } from "@/lib/api";
import { Product } from "@/app/types";
import { Plus, Pencil, Trash2, Search, X, ImagePlus, Loader2, CheckCircle2, XCircle, Clock } from "lucide-react";

const CATEGORIES = [
  { id: "brake", name: "Тоормос" },
  { id: "engine", name: "Хөдөлгүүр" },
  { id: "lighting", name: "Гэрэлтүүлэг" },
  { id: "suspension", name: "Амортизатор" },
  { id: "electric", name: "Цахилгаан" },
  { id: "body", name: "Бие дарц" },
  { id: "transmission", name: "Дамжуулга" },
  { id: "other", name: "Бусад" },
];

const emptyForm: Partial<Product> = {
  name: "", oem: "", price: 0, category: "brake", brand: "", source: "amayama",
  inStock: true, stockQty: 100, description: "", compatible: [], iconPath: "",
  images: [],
  deliveryDays: { fast: 7, normal: 14, cheap: 21 },
};

const STATUS_BADGE: Record<string, { color: string; icon: typeof Clock; label: string }> = {
  pending: { color: "bg-amber-50 text-amber-700 border-amber-200", icon: Clock, label: "Хянагдаж буй" },
  approved: { color: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: CheckCircle2, label: "Зөвшөөрсөн" },
  rejected: { color: "bg-red-50 text-red-700 border-red-200", icon: XCircle, label: "Татгалзсан" },
};

export default function AdminProductsPage() {
  const [items, setItems] = useState<Product[]>([]);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<Product> | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reload = () => {
    setLoading(true);
    const usp = new URLSearchParams();
    if (q) usp.set("q", q);
    if (statusFilter !== "all") usp.set("status", statusFilter);
    api.get<{ items: Product[] }>(`/products/admin/all?${usp.toString()}`)
      .then(d => setItems(d.items))
      .finally(() => setLoading(false));
  };

  // queueMicrotask defers reload()'s setLoading(true) past the effect
  // commit — React 19 warns on sync setState in effect bodies.
  // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect
  useEffect(() => { queueMicrotask(reload); }, [statusFilter]);

  // Live search — results refresh 300ms after the admin stops typing
  // (Enter still triggers instantly). First render is skipped: the
  // statusFilter effect above already performs the initial load.
  const qInitRef = useRef(true);
  useEffect(() => {
    if (qInitRef.current) { qInitRef.current = false; return; }
    const t = setTimeout(reload, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const moderate = async (p: Product, action: "approve" | "reject") => {
    const id = p._id ?? p.id;
    let reason = "";
    if (action === "reject") {
      const r = prompt(`"${p.name}"-г татгалзах шалтгаан:`);
      if (r === null) return;
      reason = r;
    }
    await api.patch(`/products/${id}/moderate`, { action, reason });
    reload();
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setBusy(true); setErr("");
    try {
      const body = {
        ...editing,
        price: Number(editing.price),
        originalPrice: editing.originalPrice ? Number(editing.originalPrice) : undefined,
        compatible: typeof editing.compatible === "string"
          ? (editing.compatible as unknown as string).split("\n").map(s => s.trim()).filter(Boolean)
          : editing.compatible,
      };
      const id = editing._id ?? editing.id;
      if (id) await api.put(`/products/${id}`, body);
      else await api.post(`/products`, body);
      setEditing(null);
      reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (p: Product) => {
    if (!confirm(`"${p.name}"-г устгах уу?`)) return;
    await api.delete(`/products/${p._id ?? p.id}`);
    reload();
  };

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0 || !editing) return;
    setUploading(true); setErr("");
    try {
      const uploaded: string[] = [];
      for (const f of Array.from(files)) {
        const { url } = await api.uploadImage(f);
        uploaded.push(url);
      }
      setEditing(s => ({ ...s, images: [...(s?.images ?? []), ...uploaded] }));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const removeImage = (url: string) => {
    setEditing(s => ({ ...s, images: (s?.images ?? []).filter(u => u !== url) }));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold text-gray-900">Бараа</h1>
          <p className="text-[13px] text-gray-500">{items.length} бараа</p>
        </div>
        <button onClick={() => setEditing({ ...emptyForm })}
          className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-3 py-2 text-[13px] font-semibold cursor-pointer border-none transition-colors font-sans">
          <Plus size={14} /> Шинэ бараа
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === "Enter" && reload()}
            className="w-full min-w-0 bg-white border border-gray-200 rounded-lg pl-9 pr-3 py-2 text-[16px] md:text-[13px] focus:border-blue-500"
            placeholder="Хайх (нэр, OEM, брэнд)..." />
        </div>
        <div className="flex gap-1">
          {[{ id: "all", label: "Бүгд" }, { id: "pending", label: "Хянагдаж буй" }, { id: "approved", label: "Зөвшөөрсөн" }, { id: "rejected", label: "Татгалзсан" }].map(s => (
            <button key={s.id} onClick={() => setStatusFilter(s.id)}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-medium cursor-pointer border transition-all font-sans ${
                statusFilter === s.id ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 border-gray-200 hover:border-blue-400"
              }`}>{s.label}</button>
          ))}
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-gray-500 text-[12px]">
                <th className="px-3 py-2.5 font-medium w-12"></th>
                <th className="text-left px-4 py-2.5 font-medium">Нэр</th>
                <th className="text-left px-4 py-2.5 font-medium">Seller</th>
                <th className="text-left px-4 py-2.5 font-medium">OEM</th>
                <th className="text-right px-4 py-2.5 font-medium">Үнэ</th>
                <th className="text-right px-4 py-2.5 font-medium">Үлдэгдэл</th>
                <th className="text-center px-4 py-2.5 font-medium">Төлөв</th>
                <th className="text-right px-4 py-2.5 font-medium">Үйлдэл</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">Уншиж байна...</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">Бараа байхгүй</td></tr>
              ) : items.map(p => (
                <tr key={p._id ?? p.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                  <td className="px-3 py-2">
                    <div className="relative w-8 h-8 bg-blue-50 rounded-md overflow-hidden flex items-center justify-center">
                      {p.images && p.images.length > 0
                        ? <Image src={p.images[0]} alt="" fill sizes="32px" className="object-cover" />
                        : <ImagePlus size={12} className="text-gray-300" />
                      }
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-gray-900 truncate max-w-[220px]">{p.name}</div>
                    <div className="text-[11px] text-gray-400 truncate">{p.brand} · {CATEGORIES.find(c => c.id === p.category)?.name ?? p.category}</div>
                    {p.status === "rejected" && p.rejectedReason && (
                      <div className="text-[10px] text-red-500 mt-0.5 max-w-[220px] truncate">⚠ {p.rejectedReason}</div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-[12px] text-gray-600">
                    {p.seller && typeof p.seller === "object"
                      ? <div className="truncate max-w-[140px]">{p.seller.sellerProfile?.shopName || p.seller.name}</div>
                      : <span className="text-gray-400 italic">Admin</span>
                    }
                  </td>
                  <td className="px-4 py-2.5 text-gray-500 font-mono text-[12px]">{p.oem}</td>
                  <td className="px-4 py-2.5 text-right font-semibold text-blue-600">₮{p.price.toLocaleString()}</td>
                  <td className={`px-4 py-2.5 text-right font-medium ${(p.stockQty ?? 0) <= 5 ? "text-red-600" : (p.stockQty ?? 0) <= 20 ? "text-amber-600" : "text-gray-700"}`}>
                    {p.stockQty ?? 0}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    {(() => {
                      const st = STATUS_BADGE[p.status ?? "approved"] ?? STATUS_BADGE.approved;
                      const StIcon = st.icon;
                      return (
                        <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border ${st.color}`}>
                          <StIcon size={10} /> {st.label}
                        </span>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    {p.status === "pending" && (
                      <>
                        <button onClick={() => moderate(p, "approve")} title="Зөвшөөрөх"
                          className="w-7 h-7 inline-flex items-center justify-center rounded-lg text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 cursor-pointer bg-transparent border-none transition-colors mr-1">
                          <CheckCircle2 size={13} />
                        </button>
                        <button onClick={() => moderate(p, "reject")} title="Татгалзах"
                          className="w-7 h-7 inline-flex items-center justify-center rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 cursor-pointer bg-transparent border-none transition-colors mr-1">
                          <XCircle size={13} />
                        </button>
                      </>
                    )}
                    <button onClick={() => setEditing(p)} title="Засах"
                      className="w-7 h-7 inline-flex items-center justify-center rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 cursor-pointer bg-transparent border-none transition-colors mr-1">
                      <Pencil size={13} />
                    </button>
                    <button onClick={() => remove(p)} title="Устгах"
                      className="w-7 h-7 inline-flex items-center justify-center rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 cursor-pointer bg-transparent border-none transition-colors">
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => !busy && setEditing(null)}>
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white">
              <h2 className="text-[15px] font-semibold text-gray-900">
                {editing._id || editing.id ? "Бараа засах" : "Шинэ бараа нэмэх"}
              </h2>
              <button onClick={() => setEditing(null)} className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 cursor-pointer bg-transparent border-none">
                <X size={16} />
              </button>
            </div>
            <form onSubmit={save} className="p-5 space-y-3">
              {err && <div className="bg-red-50 border border-red-200 text-red-600 text-[12px] rounded-lg px-3 py-2">{err}</div>}

              {/* IMAGE PICKER */}
              <div>
                <label className="block text-[12px] font-medium text-gray-700 mb-1.5">Зураг</label>
                <div className="grid grid-cols-4 gap-2">
                  {(editing.images ?? []).map((url, i) => (
                    <div key={url} className="relative aspect-square rounded-lg overflow-hidden border border-gray-200 group bg-gray-50">
                      <Image src={url} alt={`img-${i}`} fill sizes="80px" className="object-cover" unoptimized />
                      {i === 0 && (
                        <span className="absolute top-1 left-1 bg-blue-600 text-white text-[9px] font-semibold px-1.5 py-0.5 rounded">Үндсэн</span>
                      )}
                      <button type="button" onClick={() => removeImage(url)}
                        className="absolute top-1 right-1 w-5 h-5 bg-black/70 text-white rounded-full flex items-center justify-center cursor-pointer border-none opacity-0 group-hover:opacity-100 transition-opacity">
                        <X size={11} />
                      </button>
                    </div>
                  ))}
                  <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading}
                    className="aspect-square rounded-lg border-2 border-dashed border-gray-300 hover:border-blue-400 hover:bg-blue-50 flex flex-col items-center justify-center gap-1 cursor-pointer bg-white transition-colors disabled:opacity-50 disabled:cursor-wait">
                    {uploading
                      ? <Loader2 size={16} className="text-blue-500 animate-spin" />
                      : <ImagePlus size={16} className="text-gray-400" />}
                    <span className="text-[10px] text-gray-500 font-medium">{uploading ? "Хуулж байна..." : "Нэмэх"}</span>
                  </button>
                </div>
                <input ref={fileInputRef} type="file" accept="image/*" multiple hidden
                  onChange={e => handleUpload(e.target.files)} />
                <p className="text-[10px] text-gray-400 mt-1.5">JPG, PNG, WEBP — 5MB хүртэл. Эхний зураг нь үндсэн зураг болно.</p>
              </div>

              <Field label="Нэр">
                <input required value={editing.name ?? ""} onChange={e => setEditing(s => ({ ...s, name: e.target.value }))}
                  className="input" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="OEM код">
                  <input required value={editing.oem ?? ""} onChange={e => setEditing(s => ({ ...s, oem: e.target.value }))}
                    className="input" />
                </Field>
                <Field label="Брэнд">
                  <input required value={editing.brand ?? ""} onChange={e => setEditing(s => ({ ...s, brand: e.target.value }))}
                    className="input" />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Үнэ (₮)">
                  <input required type="number" min={0} value={editing.price ?? 0} onChange={e => setEditing(s => ({ ...s, price: Number(e.target.value) }))}
                    className="input" />
                </Field>
                <Field label="Хямдрахаас өмнөх үнэ (заавал биш)">
                  <input type="number" min={0} value={editing.originalPrice ?? ""} onChange={e => setEditing(s => ({ ...s, originalPrice: e.target.value ? Number(e.target.value) : undefined }))}
                    className="input" />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Ангилал">
                  <select value={editing.category ?? "brake"} onChange={e => setEditing(s => ({ ...s, category: e.target.value }))}
                    className="input">
                    {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </Field>
                <Field label="Эх сурвалж">
                  <select value={editing.source ?? "amayama"} onChange={e => setEditing(s => ({ ...s, source: e.target.value as Product["source"] }))}
                    className="input">
                    <option value="amayama">Amayama JP</option>
                    <option value="partsouq">Partsouq UAE</option>
                    <option value="local">Монгол дэлгүүр</option>
                  </select>
                </Field>
              </div>
              <Field label="Тайлбар">
                <textarea value={editing.description ?? ""} onChange={e => setEditing(s => ({ ...s, description: e.target.value }))}
                  className="input min-h-[60px] resize-none" />
              </Field>
              <Field label="Тохирох загварууд (мөр бүрт нэг)">
                <textarea value={Array.isArray(editing.compatible) ? editing.compatible.join("\n") : (editing.compatible as unknown as string ?? "")}
                  onChange={e => setEditing(s => ({ ...s, compatible: e.target.value as unknown as string[] }))}
                  className="input min-h-[60px] resize-none font-mono text-[12px]" />
              </Field>
              <Field label="Badge (Шинэ, Хямдарсан гэх мэт — заавал биш)">
                <input value={editing.badge ?? ""} onChange={e => setEditing(s => ({ ...s, badge: e.target.value }))}
                  className="input" />
              </Field>
              <Field label="Icon SVG path (заавал биш)">
                <input value={editing.iconPath ?? ""} onChange={e => setEditing(s => ({ ...s, iconPath: e.target.value }))}
                  className="input font-mono text-[11px]" placeholder="M12 2C..." />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Үлдэгдэл (ширхэг)">
                  <input type="number" min={0} value={editing.stockQty ?? 0} onChange={e => setEditing(s => ({ ...s, stockQty: Number(e.target.value) }))}
                    className="input" />
                </Field>
                <label className="flex items-end gap-2 cursor-pointer pb-2">
                  <input type="checkbox" checked={editing.inStock ?? true} onChange={e => setEditing(s => ({ ...s, inStock: e.target.checked }))}
                    className="accent-blue-600 w-4 h-4" />
                  <span className="text-[13px] text-gray-700">Идэвхтэй (худалдаалагдана)</span>
                </label>
              </div>

              <div className="flex gap-2 pt-3 sticky bottom-0 bg-white pb-1 -mx-5 px-5 border-t border-gray-100 mt-2">
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
    </div>
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
