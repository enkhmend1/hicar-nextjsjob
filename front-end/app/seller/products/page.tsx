"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store";
import { Product } from "@/app/types";
import Combobox from "@/app/components/ui/Combobox";
import TagInput from "@/app/components/ui/TagInput";
import Link from "next/link";
import {
  Plus, Pencil, Trash2, X, ImagePlus, Loader2, Search,
  CheckCircle2, Clock, XCircle, AlertTriangle, Tag, Settings2, Sparkles, Boxes, Package,
} from "lucide-react";
import PageHeader from "@/app/seller/_components/PageHeader";
import { StatCardInline } from "@/app/seller/_components/StatCard";
import { EmptyState, TableRowsSkeleton } from "@/app/seller/_components/States";
import { TableCard, Th } from "@/app/seller/_components/Table";

// ── Canonical categories (shown first in autocomplete) ───────────────
const CANONICAL_CATEGORIES = [
  { id: "brake",        label: "Тоормос" },
  { id: "engine",       label: "Хөдөлгүүр" },
  { id: "lighting",     label: "Гэрэлтүүлэг" },
  { id: "suspension",   label: "Амортизатор" },
  { id: "electric",     label: "Цахилгаан" },
  { id: "body",         label: "Бие дарц" },
  { id: "transmission", label: "Дамжуулга" },
  { id: "other",        label: "Бусад" },
];
const CANONICAL_SOURCES = ["amayama", "partsouq", "local", "yahoo auction", "alibaba", "personal import"];

const STATUS_STYLE: Record<string, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  approved: { label: "Зөвшөөрсөн",   color: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: CheckCircle2 },
  pending:  { label: "Хянагдаж буй", color: "bg-amber-50 text-amber-700 border-amber-200",       icon: Clock },
  rejected: { label: "Татгалзсан",   color: "bg-red-50 text-red-700 border-red-200",             icon: XCircle },
};

const emptyForm: Partial<Product> = {
  name: "", oem: "", price: 0, category: "", brand: "", source: "",
  inStock: true, stockQty: 100, lowStockThreshold: -1,
  description: "", compatible: [], iconPath: "",
  images: [], tags: [],
  deliveryDays: { fast: 7, normal: 14, cheap: 21 },
};

interface Facets {
  sources: string[];
  categories: string[];
  brands: string[];
  tags: string[];
}

// Phase AT: stock badge meta — a colour-coded pill that doubles as a quick
// edit shortcut so the seller can jump straight into the stock field. Three
// tiers: out (red) · low ≤ threshold (amber) · healthy (emerald).
const stockBadge = (qty: number, threshold: number, inStock: boolean) => {
  if (qty === 0 || !inStock)
    return { cls: "bg-red-50 text-red-600 border-red-200 hover:bg-red-100", note: "Дууссан" };
  if (qty <= threshold)
    return { cls: "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100", note: "Бага" };
  return { cls: "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100", note: "" };
};

const categoryLabel = (id: string) =>
  CANONICAL_CATEGORIES.find((c) => c.id === id)?.label ?? id;

export default function SellerProductsPage() {
  const user = useAuthStore((s) => s.user);
  const defaultThreshold = user?.sellerProfile?.defaultLowStockThreshold ?? 5;

  const [items, setItems] = useState<Product[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<Product> | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [uploading, setUploading] = useState(false);
  const [facets, setFacets] = useState<Facets>({ sources: [], categories: [], brands: [], tags: [] });
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Data fetch ────────────────────────────────────────────────────
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const { items } = await api.get<{ items: Product[] }>("/products/mine");
      setItems(items);
    } finally { setLoading(false); }
  }, []);

  // queueMicrotask defers reload()'s setLoading(true) past the effect
  // commit — React 19 warns on sync setState in effect bodies.
  useEffect(() => { queueMicrotask(reload); }, [reload]);

  useEffect(() => {
    api.get<Facets>("/seller/facets").then(setFacets).catch(() => {});
  }, [editing]); // refetch when opening modal so newly created tags from another tab appear

  // ── Derived: facet groups with "recently used" header ─────────────
  const sourceGroups = useMemo(() => buildGroups(facets.sources, CANONICAL_SOURCES, user?.sellerProfile?.customSources), [facets.sources, user]);
  const categoryGroups = useMemo(() => buildGroups(facets.categories, CANONICAL_CATEGORIES.map(c => c.id), user?.sellerProfile?.customCategories), [facets.categories, user]);
  const brandGroups = useMemo(() => buildGroups(facets.brands, [], user?.sellerProfile?.customBrands), [facets.brands, user]);

  // ── Mutations ─────────────────────────────────────────────────────
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    if (!editing.name?.trim()) { setErr("Нэр шаардлагатай"); return; }
    if (!editing.category?.trim()) { setErr("Ангилал шаардлагатай"); return; }
    if (!editing.brand?.trim()) { setErr("Брэнд шаардлагатай"); return; }

    setBusy(true); setErr("");
    try {
      const body = {
        ...editing,
        price: Number(editing.price ?? 0),
        originalPrice: editing.originalPrice ? Number(editing.originalPrice) : undefined,
        compatible: typeof editing.compatible === "string"
          ? (editing.compatible as unknown as string).split("\n").map((s) => s.trim()).filter(Boolean)
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
      setEditing((s) => ({ ...s, images: [...(s?.images ?? []), ...uploaded] }));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const removeImage = (url: string) =>
    setEditing((s) => ({ ...s, images: (s?.images ?? []).filter((u) => u !== url) }));

  // ── Inventory health summary above the table ──────────────────────
  const inventoryStats = useMemo(() => {
    let low = 0, out = 0, totalValue = 0;
    for (const p of items) {
      const t = p.lowStockThreshold && p.lowStockThreshold >= 0 ? p.lowStockThreshold : defaultThreshold;
      const q = p.stockQty ?? 0;
      if (q === 0 || !p.inStock) out++;
      else if (q <= t) low++;
      totalValue += p.price * q;
    }
    return { low, out, totalValue };
  }, [items, defaultThreshold]);

  // ── Live search — same instant client-side filter the warehouse page
  // has: results update under the field on every keystroke. ───────────
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((p) =>
      p.name.toLowerCase().includes(needle) ||
      (p.oem ?? "").toLowerCase().includes(needle) ||
      (p.brand ?? "").toLowerCase().includes(needle) ||
      categoryLabel(p.category ?? "").toLowerCase().includes(needle),
    );
  }, [items, q]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Миний бараа"
        subtitle={`${q.trim() ? `${visible.length} / ${items.length}` : items.length} бараа`}
        icon={Package}
        actions={
          <>
            <Link href="/seller/products/import"
              className="inline-flex items-center gap-1.5 border border-blue-200 hover:border-blue-400 hover:bg-blue-50 text-blue-700 rounded-lg px-3 py-2 text-[13px] font-semibold cursor-pointer bg-white transition-all font-sans"
             >
              <Sparkles size={14} /> AI Bulk Import
            </Link>
            {/*
              "Шинэ бараа" товчийг новын 3-алхамт форм руу route хийсэн.
              Хуучин setEditing-аар нээгддэг inline modal нь EXISTING product-ыг
              ЗАСАХАД л үлдсэн (хүснэгтийн мөр доторх Pencil товч).
            */}
            <Link href="/seller/products/new"
              className="flex items-center gap-1.5 bg-gradient-to-r from-blue-600 to-amber-600 hover:from-blue-700 hover:to-amber-700 text-white rounded-lg px-3 py-2 text-[13px] font-semibold cursor-pointer border-none transition-all font-sans shadow-md shadow-blue-200"
             >
              <Plus size={14} /> Шинэ бараа
            </Link>
          </>
        }
      />

      {/* Inventory health */}
      <div className="grid grid-cols-3 gap-3">
        <StatCardInline label="Цөөн үлдсэн" value={inventoryStats.low} tone={inventoryStats.low > 0 ? "amber" : "gray"} icon={AlertTriangle} />
        <StatCardInline label="Дууссан" value={inventoryStats.out} tone={inventoryStats.out > 0 ? "red" : "gray"} icon={XCircle} />
        <StatCardInline label="Нөөцийн үнэлгээ" value={`₮${inventoryStats.totalValue.toLocaleString()}`} tone="blue" icon={Tag} />
      </div>

      {/* Live search over the list (name / OEM / brand / category) */}
      <div className="relative max-w-sm">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input value={q} onChange={(e) => setQ(e.target.value)}
          className="w-full min-w-0 bg-white border border-gray-200 rounded-lg pl-9 pr-9 py-2 text-[16px] md:text-[13px] focus:border-blue-500 outline-none transition-colors"
          placeholder="Нэр, OEM, брэнд, ангиллаар хайх..." />
        {q && (
          <button onClick={() => setQ("")} aria-label="Хайлт цэвэрлэх"
            className="absolute right-1 top-1/2 -translate-y-1/2 w-7 h-7 inline-flex items-center justify-center rounded-md text-gray-400 hover:text-gray-700 cursor-pointer bg-transparent border-none">
            <X size={13} />
          </button>
        )}
      </div>

      <TableCard>
        <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-gray-500 text-[12px]">
                <Th className="w-12" />
                <Th>Нэр / Брэнд</Th>
                <Th>OEM</Th>
                <Th>Ангилал</Th>
                <Th align="right">Үнэ</Th>
                <Th align="right">Үлдэгдэл</Th>
                <Th align="center">Төлөв</Th>
                <Th align="right">Үйлдэл</Th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableRowsSkeleton rows={6} cols={8} />
              ) : visible.length === 0 ? (
                <tr><td colSpan={8}>
                  {q.trim() ? (
                    <EmptyState icon={Search} title={`«${q.trim()}» гэсэн илэрц олдсонгүй`} hint="Өөр түлхүүр үгээр хайж үзнэ үү." />
                  ) : (
                    <EmptyState
                      icon={Package}
                      title="Бараа байхгүй"
                      hint="Эхний бараагаа нэмж эхлээрэй."
                      action={
                        <Link href="/seller/products/new" className="inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 py-2 text-[13px] font-semibold cursor-pointer transition-colors" style={{ textDecoration: "none", color: "white" }}>
                          <Plus size={14} /> Шинэ бараа нэмэх
                        </Link>
                      }
                    />
                  )}
                </td></tr>
              ) : visible.map((p) => {
                const st = STATUS_STYLE[p.status ?? "approved"];
                const StIcon = st.icon;
                const threshold = p.lowStockThreshold && p.lowStockThreshold >= 0 ? p.lowStockThreshold : defaultThreshold;
                const qty = p.stockQty ?? 0;
                const sb = stockBadge(qty, threshold, p.inStock);
                return (
                  <tr key={p._id ?? p.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                    <td className="px-3 py-2">
                      <div className="relative w-9 h-9 bg-amber-50 rounded-md overflow-hidden flex items-center justify-center">
                        {p.images && p.images.length > 0
                          ? <Image src={p.images[0]} alt="" fill sizes="36px" className="object-cover" />
                          : <ImagePlus size={13} className="text-gray-300" />}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-gray-900 truncate max-w-[240px]">{p.name}</div>
                      <div className="text-[11px] text-gray-400 truncate">{p.brand}</div>
                      {p.status === "rejected" && p.rejectedReason && (
                        <div className="text-[10px] text-red-500 mt-0.5">⚠ {p.rejectedReason}</div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-gray-500 font-mono text-[12px]">{p.oem || "—"}</td>
                    <td className="px-4 py-2.5 text-gray-600">{categoryLabel(p.category)}</td>
                    <td className="px-4 py-2.5 text-right font-semibold text-blue-600">₮{p.price.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={() => setEditing(p)}
                        title={`Үлдэгдэл засах (анхааруулах босго: ${threshold})`}
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold border cursor-pointer transition-colors ${sb.cls}`}>
                        <Boxes size={11} /> {qty} ш
                        {sb.note && <span className="font-normal opacity-80">· {sb.note}</span>}
                      </button>
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-medium border ${st.color}`}>
                        <StIcon size={10} /> {st.label}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
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
                );
              })}
            </tbody>
        </table>
      </TableCard>

      {editing && (
        <Modal onClose={() => !busy && setEditing(null)}>
          <header className="px-5 py-3 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white z-10">
            <h2 className="text-[15px] font-semibold text-gray-900">
              {editing._id || editing.id ? "Бараа засах" : "Шинэ бараа нэмэх"}
            </h2>
            <button onClick={() => setEditing(null)} className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 cursor-pointer bg-transparent border-none">
              <X size={16} />
            </button>
          </header>
          <form onSubmit={save} className="p-5 space-y-3.5">
            {err && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-[12px] rounded-lg px-3 py-2">{err}</div>
            )}
            {editing._id && editing.status === "approved" && (
              <div className="bg-amber-50 border border-amber-200 text-amber-700 text-[11px] rounded-lg px-3 py-2">
                ⚠ Зөвшөөрөгдсөн барааг засвал дахин хяналтад орно.
              </div>
            )}

            {/* Images */}
            <Section title="Зураг">
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
                onChange={(e) => handleUpload(e.target.files)} />
            </Section>

            {/* Basic info */}
            <Field label="Нэр *">
              <input required value={editing.name ?? ""} onChange={(e) => setEditing((s) => ({ ...s, name: e.target.value }))} className="input" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="OEM код (заавал биш)" hint="Жнь: 43512-47060. Хоосон үлдээж болно — aftermarket/universal/accessory">
                <input value={editing.oem ?? ""} onChange={(e) => setEditing((s) => ({ ...s, oem: e.target.value }))} className="input font-mono" placeholder="—" />
              </Field>
              <Field label="Брэнд *">
                <Combobox
                  required
                  value={editing.brand ?? ""}
                  onChange={(v) => setEditing((s) => ({ ...s, brand: v }))}
                  groups={brandGroups}
                  placeholder="Toyota Genuine, KYB, Denso..."
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Үнэ (₮) *">
                <input required type="number" min={0} value={editing.price ?? 0}
                  onChange={(e) => setEditing((s) => ({ ...s, price: Number(e.target.value) }))} className="input" />
              </Field>
              <Field label="Хуучин үнэ (заавал биш)">
                <input type="number" min={0} value={editing.originalPrice ?? ""}
                  onChange={(e) => setEditing((s) => ({ ...s, originalPrice: e.target.value ? Number(e.target.value) : undefined }))} className="input" />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Ангилал *" hint="Бичиж сонгох, шинээр үүсгэх боломжтой">
                <Combobox
                  required
                  value={editing.category ?? ""}
                  onChange={(v) => setEditing((s) => ({ ...s, category: v }))}
                  groups={categoryGroups}
                  format={categoryLabel}
                  placeholder="brake, engine, accessory..."
                />
              </Field>
              <Field label="Эх сурвалж" hint="Yahoo Auction, Alibaba, Personal import..">
                <Combobox
                  value={editing.source ?? ""}
                  onChange={(v) => setEditing((s) => ({ ...s, source: v }))}
                  groups={sourceGroups}
                  placeholder="local"
                />
              </Field>
            </div>

            <Field label="Tags" hint="Хайлтыг хялбарчилна (max 20). Enter эсвэл таслалаар нэмнэ.">
              <TagInput
                value={editing.tags ?? []}
                onChange={(tags) => setEditing((s) => ({ ...s, tags }))}
                suggestions={facets.tags}
              />
            </Field>

            <Field label="Тайлбар">
              <textarea value={editing.description ?? ""} onChange={(e) => setEditing((s) => ({ ...s, description: e.target.value }))} className="input min-h-[60px] resize-none" />
            </Field>

            <Field label="Тохирох загварууд (мөр бүрт нэг)">
              <textarea
                value={Array.isArray(editing.compatible) ? editing.compatible.join("\n") : (editing.compatible as unknown as string ?? "")}
                onChange={(e) => setEditing((s) => ({ ...s, compatible: e.target.value as unknown as string[] }))}
                className="input min-h-[60px] resize-none font-mono text-[12px]" />
            </Field>

            {/* Inventory */}
            <Section title="Нөөцийн тохиргоо" icon={Settings2}>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Үлдэгдэл (ширхэг)">
                  <input type="number" min={0} value={editing.stockQty ?? 0}
                    onChange={(e) => setEditing((s) => ({ ...s, stockQty: Number(e.target.value) }))} className="input" />
                </Field>
                <Field label={`Low-stock threshold`} hint={`Хоосон үлдээвэл seller default-ийг (${defaultThreshold}) ашиглана`}>
                  <input
                    type="number"
                    min={0}
                    placeholder={`default: ${defaultThreshold}`}
                    value={editing.lowStockThreshold !== undefined && editing.lowStockThreshold >= 0 ? editing.lowStockThreshold : ""}
                    onChange={(e) =>
                      setEditing((s) => ({
                        ...s,
                        lowStockThreshold: e.target.value === "" ? -1 : Math.max(0, Number(e.target.value)),
                      }))
                    }
                    className="input"
                  />
                </Field>
              </div>
              <label className="flex items-center gap-2 cursor-pointer mt-1">
                <input type="checkbox" checked={editing.inStock ?? true}
                  onChange={(e) => setEditing((s) => ({ ...s, inStock: e.target.checked }))}
                  className="accent-blue-600 w-4 h-4" />
                <span className="text-[13px] text-gray-700">Идэвхтэй (худалдаалагдана)</span>
              </label>
            </Section>

            <footer className="flex gap-2 pt-3 sticky bottom-0 bg-white pb-1 -mx-5 px-5 border-t border-gray-100 mt-2">
              <button type="button" onClick={() => setEditing(null)} disabled={busy}
                className="flex-1 border border-gray-200 rounded-lg py-2.5 text-[13px] text-gray-600 cursor-pointer bg-white font-sans">
                Болих
              </button>
              <button type="submit" disabled={busy}
                className="flex-1 bg-gradient-to-r from-blue-600 to-amber-600 hover:from-blue-700 hover:to-amber-700 disabled:from-gray-300 disabled:to-gray-400 text-white rounded-lg py-2.5 text-[13px] font-semibold cursor-pointer border-none transition-all font-sans flex items-center justify-center gap-1.5">
                {busy && <Loader2 size={12} className="animate-spin" />}
                {busy ? "Хадгалж байна..." : "Хадгалах"}
              </button>
            </footer>
          </form>
        </Modal>
      )}

      <style jsx>{`
        :global(.input) {
          width: 100%;
          background: #f9fafb;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          padding: 8px 12px;
          font-size: 16px;
          font-family: inherit;
          color: #111;
        }
        @media (min-width: 768px) {
          :global(.input) {
            font-size: 13px;
          }
        }
        :global(.input:focus) {
          outline: none;
          border-color: #3b82f6;
          background: white;
        }
      `}</style>
    </div>
  );
}

// ── Small reusable bits ─────────────────────────────────────────────
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[12px] font-medium text-gray-700 mb-1">{label}</label>
      {children}
      {hint && <p className="text-[10px] text-gray-400 mt-1">{hint}</p>}
    </div>
  );
}

function Section({ title, icon: Icon, children }: { title: string; icon?: typeof Settings2; children: React.ReactNode }) {
  return (
    <fieldset className="border-t border-gray-100 pt-3 space-y-3">
      <legend className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 inline-flex items-center gap-1.5">
        {Icon && <Icon size={11} />} {title}
      </legend>
      {children}
    </fieldset>
  );
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

// ── Helper: build groups (Recently used + Suggested) for Combobox ──
function buildGroups(global: string[], canonical: string[], personal?: string[]) {
  const groups: Array<{ label?: string; options: string[] }> = [];
  if (personal && personal.length > 0) {
    groups.push({ label: "Сүүлд хэрэглэсэн", options: personal.slice(0, 8) });
  }
  if (canonical && canonical.length > 0) {
    groups.push({ label: "Санал болгох", options: canonical });
  }
  const rest = global.filter((g) => !canonical?.includes(g) && !personal?.includes(g));
  if (rest.length > 0) groups.push({ label: "Бусад", options: rest });
  return groups;
}
