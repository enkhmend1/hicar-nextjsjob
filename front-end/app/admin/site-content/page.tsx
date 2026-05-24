"use client";

/**
 * Admin → Сайтын контент.
 *
 * Edits the singleton SiteContent document the homepage reads from:
 *   • Categories list — display name, icon SVG path-d, sort order,
 *     visibility. Counts are NOT editable (they're live aggregates).
 *   • Hero copy — badge, title segments, subtitle. Locale stays
 *     Mongolian-only for now.
 *
 * UX choices:
 *   • Single Save button at the bottom commits the entire form (categories
 *     + hero) in one PATCH. Less round-tripping, fewer edge cases than
 *     per-row autosave.
 *   • Live count chip per category reuses the public /categories endpoint
 *     so admins see the real product count alongside what they're editing.
 *   • Order reordering uses up/down arrows (more predictable than drag-
 *     and-drop, simpler than a library dep).
 */

import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { invalidateCategoriesCache } from "@/app/lib/useCategories";
import {
  AlertCircle, ArrowDown, ArrowUp, Check, ChevronDown, ChevronRight, Eye, EyeOff,
  LayoutTemplate, Loader2, Plus, Save, Sliders, Trash2,
} from "lucide-react";

interface AttributeDef {
  key: string;
  label: string;
  type: "text" | "number" | "select";
  options: string[];
  required: boolean;
}
interface SiteCategory {
  id: string;
  name: string;
  iconPath: string;
  order: number;
  visible: boolean;
  attributesSchema: AttributeDef[];
}
interface SiteHero {
  badge?: string;
  title1?: string;
  title2?: string;
  titleAi?: string;
  title3?: string;
  title4?: string;
  subtitle?: string;
}
interface SiteContent {
  categories: SiteCategory[];
  hero: SiteHero;
  version: number;
  updatedAt: string;
}
interface HomepageCategoryWithCount {
  id: string;
  name: string;
  iconPath: string;
  count: number;
}

const HERO_FIELDS: { key: keyof SiteHero; label: string; placeholder?: string; multiline?: boolean }[] = [
  { key: "badge",    label: "Тэмдэг",         placeholder: "AI-driven автомашины сэлбэг" },
  { key: "title1",   label: "Гарчиг — мөр 1",  placeholder: "Автомашины сэлбэгээ" },
  { key: "title2",   label: "Гарчиг — мөр 2",  placeholder: "Шинэ хэлбэрээр" },
  { key: "titleAi",  label: "AI тэмдэг үг",    placeholder: "AI" },
  { key: "title3",   label: "Гарчиг — мөр 3",  placeholder: "-тай" },
  { key: "title4",   label: "Гарчиг — мөр 4",  placeholder: "хайж захиалаарай." },
  { key: "subtitle", label: "Дэд тайлбар",     placeholder: "...", multiline: true },
];

const EMPTY_CATEGORY: SiteCategory = {
  id: "", name: "", iconPath: "", order: 999, visible: true, attributesSchema: [],
};
const EMPTY_ATTRIBUTE: AttributeDef = {
  key: "", label: "", type: "text", options: [], required: false,
};

const ATTR_TYPE_LABELS: Record<AttributeDef["type"], string> = {
  text:   "Текст",
  number: "Тоо",
  select: "Сонголт",
};

export default function AdminSiteContentPage() {
  const [content, setContent] = useState<SiteContent | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [err, setErr] = useState("");
  const [serverErrors, setServerErrors] = useState<string[]>([]);
  // Which category rows are showing their attributesSchema editor.
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const toggleExpanded = (idx: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  };

  const reload = async () => {
    setLoading(true); setErr("");
    try {
      const [c, cat] = await Promise.all([
        api.get<{ content: SiteContent }>("/site-content"),
        api.get<{ categories: HomepageCategoryWithCount[] }>("/site-content/categories"),
      ]);
      setContent(c.content);
      setCounts(Object.fromEntries(cat.categories.map((x) => [x.id, x.count])));
    } catch (e) {
      setErr((e as ApiError).message || "Ачаалж чадсангүй");
    } finally {
      setLoading(false);
    }
  };
  // queueMicrotask defers reload()'s setLoading(true) past the effect
  // commit — React 19 warns on sync setState in effect bodies.
  useEffect(() => { queueMicrotask(reload); }, []);

  // ── Mutators ──────────────────────────────────────────────────────
  const updateCategory = (idx: number, patch: Partial<SiteCategory>) => {
    setContent((c) => c ? {
      ...c,
      categories: c.categories.map((cat, i) => i === idx ? { ...cat, ...patch } : cat),
    } : c);
  };

  const moveCategory = (idx: number, delta: -1 | 1) => {
    setContent((c) => {
      if (!c) return c;
      const next = [...c.categories];
      const target = idx + delta;
      if (target < 0 || target >= next.length) return c;
      [next[idx], next[target]] = [next[target], next[idx]];
      // Re-stamp order so the DB persists the new sequence
      return { ...c, categories: next.map((cat, i) => ({ ...cat, order: i + 1 })) };
    });
  };

  const addCategory = () => {
    setContent((c) => c ? {
      ...c,
      categories: [
        ...c.categories,
        { ...EMPTY_CATEGORY, order: c.categories.length + 1 },
      ],
    } : c);
  };

  const removeCategory = (idx: number) => {
    setContent((c) => c ? {
      ...c,
      categories: c.categories.filter((_, i) => i !== idx).map((cat, i) => ({ ...cat, order: i + 1 })),
    } : c);
  };

  const updateHero = (key: keyof SiteHero, value: string) => {
    setContent((c) => c ? { ...c, hero: { ...c.hero, [key]: value } } : c);
  };

  // ── attributesSchema sub-array helpers ────────────────────────────
  const addAttribute = (catIdx: number) => {
    updateCategory(catIdx, {
      attributesSchema: [
        ...(content?.categories[catIdx].attributesSchema || []),
        { ...EMPTY_ATTRIBUTE },
      ],
    });
    setExpanded((prev) => new Set(prev).add(catIdx));
  };
  const updateAttribute = (catIdx: number, attrIdx: number, patch: Partial<AttributeDef>) => {
    const current = content?.categories[catIdx].attributesSchema || [];
    updateCategory(catIdx, {
      attributesSchema: current.map((a, i) => i === attrIdx ? { ...a, ...patch } : a),
    });
  };
  const removeAttribute = (catIdx: number, attrIdx: number) => {
    const current = content?.categories[catIdx].attributesSchema || [];
    updateCategory(catIdx, {
      attributesSchema: current.filter((_, i) => i !== attrIdx),
    });
  };

  const save = async () => {
    if (!content) return;
    setSaving(true); setErr(""); setServerErrors([]);
    try {
      const r = await api.patch<{ content: SiteContent }>("/site-content", {
        categories: content.categories,
        hero:       content.hero,
      });
      setContent(r.content);
      // Re-fetch live counts because new categories may have appeared.
      const cat = await api.get<{ categories: HomepageCategoryWithCount[] }>("/site-content/categories");
      setCounts(Object.fromEntries(cat.categories.map((x) => [x.id, x.count])));
      // Invalidate the module-scoped cache used by useCategories() so the
      // seller's product-form dropdown picks up the new list on its NEXT
      // mount.
      invalidateCategoriesCache();
      setSavedAt(new Date());
    } catch (e) {
      const apiErr = e as ApiError;
      // The backend returns ATTRIBUTE_SCHEMA_INVALID with a `details`
      // array when one or more attributesSchema rows are malformed.
      const details = (apiErr.data as { details?: string[] })?.details;
      if (Array.isArray(details) && details.length > 0) {
        setServerErrors(details);
        setErr("Шинж чанарын тодорхойлолтод алдаа байна — доорхыг засна уу");
      } else {
        setErr(apiErr.message || "Хадгалж чадсангүй");
      }
    } finally {
      setSaving(false);
    }
  };

  // Validate before save — surface inline so the save button can disable.
  // Mirrors back-end/Service/productSchema.service.js validateAttributeDefinition.
  const validation = useMemo(() => {
    if (!content) return { ok: false, issues: [] as string[] };
    const issues: string[] = [];
    const seen = new Set<string>();
    content.categories.forEach((c, i) => {
      const id = c.id.trim().toLowerCase();
      if (!id)        issues.push(`Мөр ${i + 1}: id хоосон`);
      if (!c.name)    issues.push(`Мөр ${i + 1}: нэр хоосон`);
      if (!c.iconPath) issues.push(`Мөр ${i + 1}: icon SVG path хоосон`);
      if (id && seen.has(id)) issues.push(`Мөр ${i + 1}: давхардсан id "${id}"`);
      seen.add(id);

      const attrSeen = new Set<string>();
      (c.attributesSchema || []).forEach((a, j) => {
        const akey = a.key.trim().toLowerCase();
        if (!akey)              issues.push(`Категори ${i + 1}, шинж ${j + 1}: key хоосон`);
        else if (!/^[a-z][a-z0-9_]{0,39}$/i.test(akey)) {
          issues.push(`Категори ${i + 1}, шинж "${akey}": key нь үсэгээр эхэлж үсэг/тоо/_ зөвшөөрнө`);
        }
        if (!a.label.trim()) issues.push(`Категори ${i + 1}, шинж ${j + 1}: label хоосон`);
        if (!["text", "number", "select"].includes(a.type)) {
          issues.push(`Категори ${i + 1}, шинж ${j + 1}: type буруу`);
        }
        if (a.type === "select" && (!a.options || a.options.length === 0)) {
          issues.push(`Категори ${i + 1}, шинж "${akey}": select төрөл option-уудтай байх`);
        }
        if (akey && attrSeen.has(akey)) {
          issues.push(`Категори ${i + 1}: давхардсан шинж "${akey}"`);
        }
        attrSeen.add(akey);
      });
    });
    return { ok: issues.length === 0, issues };
  }, [content]);

  if (loading) {
    return <div className="text-gray-400 text-sm py-12 text-center">Уншиж байна...</div>;
  }
  if (!content) {
    return <div className="text-red-600 text-sm py-12 text-center">Контент ачаалж чадсангүй</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[22px] font-semibold text-gray-900 inline-flex items-center gap-2">
            <LayoutTemplate size={20} className="text-blue-600" />
            Сайтын контент
          </h1>
          <p className="text-[13px] text-gray-500 mt-0.5">
            Нүүр хуудасны категори болон hero текст. Тоонууд DB-аас live тооцогддог тул засаж болохгүй.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {savedAt && (
            <span className="text-[11px] text-emerald-600 inline-flex items-center gap-1">
              <Check size={11} /> {savedAt.toLocaleTimeString("mn-MN")}-д хадгаласан
            </span>
          )}
          <button onClick={save} disabled={saving || !validation.ok}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-[13px] font-semibold cursor-pointer border-none transition-colors font-sans shadow-sm shadow-blue-200">
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            {saving ? "Хадгалж байна..." : "Хадгалах"}
          </button>
        </div>
      </div>

      {!validation.ok && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-[12px] text-amber-800">
          <div className="font-semibold mb-1 inline-flex items-center gap-1">
            <AlertCircle size={12} /> Хадгалахын өмнө залруулах
          </div>
          <ul className="list-disc list-inside space-y-0.5">
            {validation.issues.map((iss, i) => <li key={i}>{iss}</li>)}
          </ul>
        </div>
      )}

      {err && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-[12px] text-red-700">
          <div className="inline-flex items-start gap-2">
            <AlertCircle size={13} className="mt-0.5 shrink-0" /> {err}
          </div>
          {serverErrors.length > 0 && (
            <ul className="mt-2 list-disc list-inside space-y-0.5 ml-1">
              {serverErrors.map((m, i) => <li key={i}>{m}</li>)}
            </ul>
          )}
        </div>
      )}

      {/* ── Categories ────────────────────────────────────────────── */}
      <section className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[14px] font-semibold text-gray-900">
            Категори жагсаалт <span className="text-[11px] text-gray-400 font-normal">({content.categories.length})</span>
          </h2>
          <button type="button" onClick={addCategory}
            className="inline-flex items-center gap-1 text-[12px] text-blue-700 hover:text-blue-800 bg-transparent border-none cursor-pointer font-semibold">
            <Plus size={12} /> Категори нэмэх
          </button>
        </div>

        <div className="space-y-2">
          {content.categories.map((cat, idx) => (
            <div key={idx} className="rounded-xl border border-gray-100 bg-gray-50/40 p-2">
            <div className="grid grid-cols-[28px_2fr_2fr_1fr_60px_72px_80px_70px_64px] gap-1.5 items-center">
              {/* Reorder */}
              <div className="flex flex-col items-center justify-center gap-px">
                <button type="button" onClick={() => moveCategory(idx, -1)} disabled={idx === 0}
                  className="w-5 h-4 flex items-center justify-center text-gray-400 hover:text-blue-700 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer bg-transparent border-none transition-colors">
                  <ArrowUp size={12} />
                </button>
                <button type="button" onClick={() => moveCategory(idx, 1)} disabled={idx === content.categories.length - 1}
                  className="w-5 h-4 flex items-center justify-center text-gray-400 hover:text-blue-700 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer bg-transparent border-none transition-colors">
                  <ArrowDown size={12} />
                </button>
              </div>

              <input value={cat.id}
                onChange={(e) => updateCategory(idx, { id: e.target.value.toLowerCase() })}
                placeholder="id (brake)" className="bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-2 text-[12px] font-mono focus:bg-white focus:border-blue-500 outline-none transition-colors" />

              <input value={cat.name}
                onChange={(e) => updateCategory(idx, { name: e.target.value })}
                placeholder="Дэлгэцэн нэр" className="bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-2 text-[12px] focus:bg-white focus:border-blue-500 outline-none transition-colors" />

              <input value={cat.iconPath}
                onChange={(e) => updateCategory(idx, { iconPath: e.target.value })}
                placeholder="SVG path d…" className="bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-2 text-[11px] font-mono focus:bg-white focus:border-blue-500 outline-none transition-colors truncate" />

              {/* Icon preview */}
              <div className="flex items-center justify-center bg-blue-50 rounded-lg h-9">
                {cat.iconPath ? (
                  <svg className="w-4 h-4 fill-blue-600" viewBox="0 0 24 24"><path d={cat.iconPath} /></svg>
                ) : <span className="text-[10px] text-gray-400">—</span>}
              </div>

              {/* Live count */}
              <div className="text-center bg-slate-50 rounded-lg h-9 flex items-center justify-center text-[12px] font-semibold text-slate-700">
                {counts[cat.id] ?? 0}
              </div>

              {/* Visibility toggle */}
              <button type="button" onClick={() => updateCategory(idx, { visible: !cat.visible })}
                className={`inline-flex items-center justify-center h-9 rounded-lg text-[11px] font-semibold cursor-pointer border transition-colors font-sans ${
                  cat.visible
                    ? "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
                    : "bg-gray-100 text-gray-500 border-gray-200 hover:bg-gray-200"
                }`}>
                {cat.visible ? <Eye size={12} /> : <EyeOff size={12} />}
                <span className="ml-1">{cat.visible ? "Ил" : "Нуу"}</span>
              </button>

              {/* Attribute schema expand toggle */}
              <button type="button" onClick={() => toggleExpanded(idx)}
                className={`inline-flex items-center justify-center h-9 rounded-lg text-[11px] cursor-pointer border transition-colors font-sans gap-1 ${
                  expanded.has(idx)
                    ? "bg-blue-50 text-blue-700 border-blue-200"
                    : "bg-white text-gray-600 border-gray-200 hover:border-blue-300"
                }`}
                title="Шинж чанар тохируулах">
                <Sliders size={11} />
                <span>{(cat.attributesSchema || []).length}</span>
                {expanded.has(idx) ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
              </button>

              <button type="button" onClick={() => removeCategory(idx)}
                className="inline-flex items-center justify-center h-9 rounded-lg text-[11px] text-red-500 hover:text-red-700 hover:bg-red-50 cursor-pointer bg-transparent border border-transparent hover:border-red-200 transition-colors">
                <Trash2 size={12} /> <span className="ml-1">Устга</span>
              </button>
            </div>

            {/* Expandable attributesSchema builder */}
            {expanded.has(idx) && (
              <AttributeSchemaEditor
                category={cat}
                catIdx={idx}
                onAddAttribute={() => addAttribute(idx)}
                onUpdateAttribute={(ai, p) => updateAttribute(idx, ai, p)}
                onRemoveAttribute={(ai) => removeAttribute(idx, ai)}
              />
            )}
          </div>
          ))}
        </div>

        <p className="mt-3 text-[10px] text-gray-400 leading-snug">
          Тоо (live count) нь DB-аас тооцогддог — Mongo дахь approved бараагаар автомат шинэчлэгдэнэ.
          Шинэ категори нэмэхэд эхлээд тоо 0 байх ба сэллэр энэ category-д бараа байршуулангуут өсөх болно.
        </p>
      </section>

      {/* ── Hero text ────────────────────────────────────────────── */}
      <section className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-5">
        <h2 className="text-[14px] font-semibold text-gray-900 mb-3">Hero текст (нүүр хуудас)</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          {HERO_FIELDS.map((f) => (
            <div key={f.key} className={f.multiline ? "sm:col-span-2" : ""}>
              <label className="block text-[11px] font-medium text-gray-600 mb-1">{f.label}</label>
              {f.multiline ? (
                <textarea
                  value={String(content.hero[f.key] || "")}
                  onChange={(e) => updateHero(f.key, e.target.value)}
                  rows={3} placeholder={f.placeholder}
                  className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-[12px] focus:bg-white focus:border-blue-500 outline-none transition-colors font-sans resize-none" />
              ) : (
                <input
                  value={String(content.hero[f.key] || "")}
                  onChange={(e) => updateHero(f.key, e.target.value)}
                  placeholder={f.placeholder}
                  className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-[12px] focus:bg-white focus:border-blue-500 outline-none transition-colors font-sans" />
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

/**
 * No-code attributes-schema form-builder for ONE category.
 *
 * Each row collects: key (machine identifier), label (display),
 * type (text/number/select), options (CSV when type=select),
 * required toggle. Rendered inside the category's expanded panel.
 */
function AttributeSchemaEditor({
  category, catIdx,
  onAddAttribute, onUpdateAttribute, onRemoveAttribute,
}: {
  category: SiteCategory;
  catIdx: number;
  onAddAttribute: () => void;
  onUpdateAttribute: (attrIdx: number, patch: Partial<AttributeDef>) => void;
  onRemoveAttribute: (attrIdx: number) => void;
}) {
  const attrs = category.attributesSchema || [];
  return (
    <div className="mt-2 border-t border-gray-100 pt-3 pl-9 pr-1 pb-1">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-[12px] font-semibold text-gray-700 inline-flex items-center gap-1.5">
          <Sliders size={11} className="text-blue-600" />
          Шинж чанар <span className="text-[10px] font-normal text-gray-400">({attrs.length})</span>
        </h4>
        <button type="button" onClick={onAddAttribute}
          className="inline-flex items-center gap-1 text-[11px] text-blue-700 hover:text-blue-800 bg-transparent border-none cursor-pointer font-semibold">
          <Plus size={11} /> Шинж чанар нэмэх
        </button>
      </div>

      {attrs.length === 0 && (
        <div className="text-[11px] text-gray-400 bg-white border border-dashed border-gray-200 rounded-lg px-3 py-3 text-center">
          Энэ категорид нэмэлт талбар алга. Шинэ шинж чанар нэмбэл seller-ийн "Шинэ бараа" форм автоматаар харуулна.
        </div>
      )}

      {attrs.length > 0 && (
        <div className="space-y-1.5">
          {attrs.map((attr, attrIdx) => (
            <div key={attrIdx} className="grid grid-cols-[2fr_2fr_100px_2fr_70px_28px] gap-1.5 items-center">
              <input value={attr.key}
                onChange={(e) => onUpdateAttribute(attrIdx, { key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") })}
                placeholder="key (wheelSize)" maxLength={40}
                className="bg-white border border-gray-200 rounded-lg px-2 py-1.5 text-[11px] font-mono focus:border-blue-500 outline-none" />

              <input value={attr.label}
                onChange={(e) => onUpdateAttribute(attrIdx, { label: e.target.value })}
                placeholder="Display label" maxLength={100}
                className="bg-white border border-gray-200 rounded-lg px-2 py-1.5 text-[11px] focus:border-blue-500 outline-none" />

              <select value={attr.type}
                onChange={(e) => onUpdateAttribute(attrIdx, {
                  type: e.target.value as AttributeDef["type"],
                  // Selecting a non-select type wipes obsolete options.
                  options: e.target.value === "select" ? attr.options : [],
                })}
                className="bg-white border border-gray-200 rounded-lg px-2 py-1.5 text-[11px] focus:border-blue-500 outline-none">
                {(["text","number","select"] as const).map((t) => (
                  <option key={t} value={t}>{ATTR_TYPE_LABELS[t]}</option>
                ))}
              </select>

              {/* Options input — only meaningful for select. Disabled otherwise so
                  the admin can see why it's there but not accidentally use it. */}
              <input value={(attr.options || []).join(", ")}
                onChange={(e) => onUpdateAttribute(attrIdx, {
                  options: e.target.value
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean)
                    .slice(0, 30),
                })}
                disabled={attr.type !== "select"}
                placeholder={attr.type === "select" ? "Option1, Option2, ..." : "(зөвхөн select-д)"}
                className="bg-white border border-gray-200 rounded-lg px-2 py-1.5 text-[11px] focus:border-blue-500 outline-none disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed" />

              <button type="button" onClick={() => onUpdateAttribute(attrIdx, { required: !attr.required })}
                className={`inline-flex items-center justify-center h-7 rounded-lg text-[10px] font-semibold cursor-pointer border transition-colors ${
                  attr.required
                    ? "bg-rose-50 text-rose-700 border-rose-200"
                    : "bg-gray-100 text-gray-500 border-gray-200"
                }`}>
                {attr.required ? "Заавал" : "Сонгох"}
              </button>

              <button type="button" onClick={() => onRemoveAttribute(attrIdx)}
                className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-red-500 rounded-lg cursor-pointer bg-transparent border-none transition-colors">
                <Trash2 size={11} />
              </button>
            </div>
          ))}
          <p className="mt-2 text-[10px] text-gray-400 leading-snug">
            <strong>key</strong>: жижиг үсэг/тоо/_, заавал үсэгээр эхлэх. <strong>label</strong>: seller-д харагдах нэр.
            <strong>type</strong>=select бол options-ыг таслалаар тусгаарла. <strong>Заавал</strong>: бараа үүсгэхэд хоосон бол алдаа гарна.
          </p>
        </div>
      )}
    </div>
  );
}
