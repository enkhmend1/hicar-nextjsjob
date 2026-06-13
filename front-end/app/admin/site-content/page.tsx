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

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { api, ApiError } from "@/lib/api";
import { invalidateCategoriesCache } from "@/app/lib/useCategories";
import {
  AlertCircle, Check, ChevronDown, ChevronRight, CornerDownRight, Eye, EyeOff,
  FolderTree, ImagePlus, LayoutTemplate, Loader2, Plus, Save, Search, Sliders, Trash2, X,
} from "lucide-react";
import {
  PageHeader, CardSkeletons, ErrorBanner, btn,
} from "@/app/admin/_components/ui";

interface AttributeDef {
  key: string;
  label: string;
  type: "text" | "number" | "select";
  options: string[];
  required: boolean;
}
interface SiteCategory {
  id: string;
  /** Parent category id for nesting. "" = top-level (main) category. */
  parentId: string;
  name: string;
  iconPath: string;
  imageUrl: string;
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
  imageUrl?: string;
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
  id: "", parentId: "", name: "", iconPath: "", imageUrl: "", order: 999, visible: true, attributesSchema: [],
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
  // Category tree search — filters mains + subs by id/name.
  const [catQuery, setCatQuery] = useState("");
  // Collapsed main categories in the tree (default: all expanded).
  const [catCollapsed, setCatCollapsed] = useState<Set<string>>(new Set());
  const toggleMain = (id: string) => setCatCollapsed((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  // Per-row image upload state: index → uploading boolean
  const [uploadingIdx, setUploadingIdx] = useState<Set<number>>(new Set());
  const fileInputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const toggleExpanded = (idx: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  };

  const uploadCategoryImage = async (idx: number, file: File) => {
    setUploadingIdx((prev) => new Set(prev).add(idx));
    try {
      const r = await api.uploadImage(file);
      updateCategory(idx, { imageUrl: r.url });
    } catch (e) {
      const msg = (e as ApiError)?.message;
      setErr(msg ? `Зураг upload хийж чадсангүй: ${msg}` : "Зураг upload хийж чадсангүй");
    } finally {
      setUploadingIdx((prev) => { const next = new Set(prev); next.delete(idx); return next; });
    }
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

  // Add a top-level (main) category at the end.
  const addCategory = () => {
    setContent((c) => c ? {
      ...c,
      categories: [
        ...c.categories,
        { ...EMPTY_CATEGORY, parentId: "", order: c.categories.length + 1 },
      ],
    } : c);
  };

  // Add a sub-category under a given parent. The new row inherits parentId
  // so the tree groups it immediately; the admin then fills id + name.
  const addSubCategory = (parentId: string) => {
    setContent((c) => c ? {
      ...c,
      categories: [
        ...c.categories,
        { ...EMPTY_CATEGORY, parentId, order: c.categories.length + 1 },
      ],
    } : c);
  };

  // Delete a row by array index. If it's a MAIN with children, the children
  // are promoted to top-level (parentId="") rather than orphaned — deleting
  // a parent should never silently swallow its sub-parts.
  const removeCategory = (idx: number) => {
    setContent((c) => {
      if (!c) return c;
      const removedId = c.categories[idx]?.id;
      const kept = c.categories
        .filter((_, i) => i !== idx)
        .map((cat) => (removedId && cat.parentId === removedId ? { ...cat, parentId: "" } : cat))
        .map((cat, i) => ({ ...cat, order: i + 1 }));
      return { ...c, categories: kept };
    });
  };

  const updateHero = (key: keyof SiteHero, value: string) => {
    setContent((c) => c ? { ...c, hero: { ...c.hero, [key]: value } } : c);
  };

  // ── Shared category row controls ──────────────────────────────────
  // Inline editor cells reused by BOTH main and sub rows in the tree:
  // image/icon tile + upload, name, id, live count, visibility, attribute
  // toggle, delete. The attributesSchema editor itself renders separately
  // (below the row) keyed by the same array index.
  const rowControls = (cat: SiteCategory) => {
    const idx = content ? content.categories.indexOf(cat) : -1;
    return (
      <>
        {/* image / icon tile + upload */}
        <div className="relative shrink-0">
          <input
            ref={(el) => { fileInputRefs.current[idx] = el; }}
            type="file" accept="image/*" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadCategoryImage(idx, f); e.target.value = ""; }}
          />
          {cat.imageUrl ? (
            <div className="relative w-9 h-9 rounded-lg overflow-hidden border border-gray-200 group/img">
              <Image src={cat.imageUrl} alt={cat.name || "category"} fill className="object-cover" sizes="36px" />
              <button type="button" onClick={() => updateCategory(idx, { imageUrl: "" })}
                className="absolute inset-0 bg-black/50 hidden group-hover/img:flex items-center justify-center cursor-pointer border-none">
                <X size={12} className="text-white" />
              </button>
            </div>
          ) : (
            <button type="button" disabled={uploadingIdx.has(idx)} onClick={() => fileInputRefs.current[idx]?.click()}
              title="Зураг оруулах"
              className="w-9 h-9 flex items-center justify-center rounded-lg text-blue-600 hover:bg-blue-50 cursor-pointer bg-white border border-dashed border-blue-300 transition-colors disabled:opacity-50">
              {uploadingIdx.has(idx)
                ? <Loader2 size={13} className="animate-spin" />
                : cat.iconPath
                  ? <svg className="w-4 h-4 fill-blue-600" viewBox="0 0 24 24"><path d={cat.iconPath} /></svg>
                  : <ImagePlus size={13} />}
            </button>
          )}
        </div>

        {/* display name */}
        <input value={cat.name}
          onChange={(e) => updateCategory(idx, { name: e.target.value })}
          placeholder="Нэр (Жнь: Духны ремень)"
          className="flex-1 min-w-0 bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-2 text-[16px] md:text-[12px] focus:bg-white focus:border-blue-500 outline-none transition-colors" />

        {/* stable id */}
        <input value={cat.id}
          onChange={(e) => updateCategory(idx, { id: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") })}
          placeholder="id"
          className="w-24 shrink-0 bg-gray-50 border border-gray-200 rounded-lg px-2 py-2 text-[16px] md:text-[11px] font-mono focus:bg-white focus:border-blue-500 outline-none transition-colors" />

        {/* live count */}
        <div className="shrink-0 w-10 text-center bg-slate-50 rounded-lg h-9 flex items-center justify-center text-[12px] font-semibold text-slate-700"
          title="Approved барааны тоо">
          {counts[cat.id] ?? 0}
        </div>

        {/* visibility */}
        <button type="button" onClick={() => updateCategory(idx, { visible: !cat.visible })}
          title={cat.visible ? "Ил байна" : "Нуугдсан"}
          className={`shrink-0 w-9 h-9 flex items-center justify-center rounded-lg border cursor-pointer transition-colors ${
            cat.visible ? "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
                        : "bg-gray-100 text-gray-400 border-gray-200 hover:bg-gray-200"
          }`}>
          {cat.visible ? <Eye size={13} /> : <EyeOff size={13} />}
        </button>

        {/* attributesSchema toggle */}
        <button type="button" onClick={() => toggleExpanded(idx)}
          title="Шинж чанар тохируулах"
          className={`shrink-0 h-9 px-2 inline-flex items-center gap-1 rounded-lg border text-[11px] cursor-pointer transition-colors ${
            expanded.has(idx) ? "bg-blue-50 text-blue-700 border-blue-200"
                              : "bg-white text-gray-500 border-gray-200 hover:border-blue-300"
          }`}>
          <Sliders size={11} /><span>{(cat.attributesSchema || []).length}</span>
        </button>

        {/* delete */}
        <button type="button" onClick={() => removeCategory(idx)}
          title="Устгах"
          className="shrink-0 w-9 h-9 flex items-center justify-center rounded-lg text-red-500 hover:bg-red-50 cursor-pointer bg-transparent border border-transparent hover:border-red-200 transition-colors">
          <Trash2 size={13} />
        </button>
      </>
    );
  };

  // attributesSchema editor block for a category at array index `idx`.
  const attrEditorFor = (cat: SiteCategory, idx: number) =>
    expanded.has(idx) ? (
      <AttributeSchemaEditor
        category={cat}
        catIdx={idx}
        onAddAttribute={() => addAttribute(idx)}
        onUpdateAttribute={(ai, p) => updateAttribute(idx, ai, p)}
        onRemoveAttribute={(ai) => removeAttribute(idx, ai)}
      />
    ) : null;

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
      if (!id)     issues.push(`Мөр ${i + 1}: id хоосон`);
      if (!c.name) issues.push(`Мөр ${i + 1}: нэр хоосон`);
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
    return (
      <div className="space-y-6">
        <PageHeader
          title="Сайтын контент"
          icon={LayoutTemplate}
          subtitle="Нүүр хуудасны категори болон hero текст. Тоонууд DB-аас live тооцогддог тул засаж болохгүй."
        />
        <CardSkeletons count={3} height="h-40" />
      </div>
    );
  }
  if (!content) {
    return (
      <div className="space-y-6">
        <PageHeader title="Сайтын контент" icon={LayoutTemplate} />
        <ErrorBanner>Контент ачаалж чадсангүй</ErrorBanner>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Сайтын контент"
        icon={LayoutTemplate}
        subtitle="Нүүр хуудасны категори болон hero текст. Тоонууд DB-аас live тооцогддог тул засаж болохгүй."
        actions={
          <>
            {savedAt && (
              <span className="text-[11px] text-emerald-600 inline-flex items-center gap-1">
                <Check size={11} /> {savedAt.toLocaleTimeString("mn-MN")}-д хадгаласан
              </span>
            )}
            <button onClick={save} disabled={saving || !validation.ok} className={btn.primary}>
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
              {saving ? "Хадгалж байна..." : "Хадгалах"}
            </button>
          </>
        }
      />

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
        <ErrorBanner>
          <div>{err}</div>
          {serverErrors.length > 0 && (
            <ul className="mt-2 list-disc list-inside space-y-0.5 ml-1">
              {serverErrors.map((m, i) => <li key={i}>{m}</li>)}
            </ul>
          )}
        </ErrorBanner>
      )}

      {/* ── Categories — nested tree (Main → Sub) ───────────────── */}
      <section className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <h2 className="text-[14px] font-semibold text-gray-900 inline-flex items-center gap-1.5">
            <FolderTree size={15} className="text-blue-600" /> Категори бүтэц
            <span className="text-[11px] text-gray-400 font-normal">({content.categories.length})</span>
          </h2>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={catQuery} onChange={(e) => setCatQuery(e.target.value)} placeholder="Хайх…"
                className="w-40 pl-8 pr-2.5 py-1.5 text-[16px] md:text-[12px] bg-gray-50 border border-gray-200 rounded-lg focus:bg-white focus:border-blue-500 outline-none transition-colors" />
            </div>
            <button type="button" onClick={addCategory}
              className="inline-flex items-center gap-1 text-[12px] text-white bg-blue-600 hover:bg-blue-700 rounded-lg px-3 py-1.5 cursor-pointer border-none font-semibold transition-colors shadow-sm shadow-blue-200">
              <Plus size={13} /> Үндсэн категори
            </button>
          </div>
        </div>

        {(() => {
          const cats = content.categories;
          const q = catQuery.trim().toLowerCase();
          const byOrder = (a: SiteCategory, b: SiteCategory) => (a.order ?? 0) - (b.order ?? 0);
          const mains = cats.filter((c) => !c.parentId).sort(byOrder);
          const subsOf = (id: string) => cats.filter((c) => c.parentId === id).sort(byOrder);
          const nameOfId = (id: string) => cats.find((c) => c.id === id)?.name || id;

          // ── Search view: flat list of matches with parent context ──
          if (q) {
            const hits = cats.filter((c) => c.id.toLowerCase().includes(q) || c.name.toLowerCase().includes(q));
            if (hits.length === 0) {
              return <p className="text-[12px] text-gray-400 py-6 text-center">&ldquo;{catQuery}&rdquo; — илэрц алга.</p>;
            }
            return (
              <div className="space-y-1.5">
                {hits.map((cat) => {
                  const idx = cats.indexOf(cat);
                  return (
                    <div key={`h-${idx}`} className="rounded-xl border border-gray-200 bg-white">
                      {cat.parentId && (
                        <div className="px-3 pt-1.5 text-[10px] text-gray-400 truncate">{nameOfId(cat.parentId)} →</div>
                      )}
                      <div className="flex items-center gap-1.5 p-2">{rowControls(cat)}</div>
                      <div className="px-2 pb-2 empty:hidden">{attrEditorFor(cat, idx)}</div>
                    </div>
                  );
                })}
              </div>
            );
          }

          // ── Tree view ──
          if (mains.length === 0) {
            return (
              <p className="text-[12px] text-gray-400 py-6 text-center">
                Үндсэн категори алга. Дээрх &ldquo;Үндсэн категори&rdquo; товчоор эхэл.
              </p>
            );
          }

          return (
            <div className="space-y-2.5">
              {mains.map((main) => {
                const mIdx = cats.indexOf(main);
                const subs = subsOf(main.id);
                const open = !catCollapsed.has(main.id);
                return (
                  <div key={`m-${mIdx}`} className="rounded-xl border border-gray-200 bg-white overflow-hidden">
                    {/* main header row */}
                    <div className="flex items-center gap-1.5 p-2 bg-gray-50/70">
                      <button type="button" onClick={() => toggleMain(main.id)} disabled={!main.id}
                        title={open ? "Хумих" : "Дэлгэх"}
                        className="shrink-0 w-6 h-9 flex items-center justify-center text-gray-400 hover:text-blue-700 cursor-pointer bg-transparent border-none disabled:opacity-30 disabled:cursor-not-allowed">
                        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                      </button>
                      {rowControls(main)}
                    </div>
                    <div className="px-2 pb-2 border-t border-gray-100 empty:hidden">{attrEditorFor(main, mIdx)}</div>

                    {/* sub categories */}
                    {open && (
                      <div className="border-t border-gray-100 px-3 py-2 space-y-1.5">
                        {subs.map((sub) => {
                          const sIdx = cats.indexOf(sub);
                          return (
                            <div key={`s-${sIdx}`}>
                              <div className="flex items-center gap-1.5 rounded-lg bg-gray-50/40 border border-gray-100 px-2 py-1.5">
                                <CornerDownRight size={13} className="shrink-0 text-gray-300" />
                                {rowControls(sub)}
                              </div>
                              <div className="mt-1 ml-5 empty:hidden">{attrEditorFor(sub, sIdx)}</div>
                            </div>
                          );
                        })}
                        {subs.length === 0 && (
                          <p className="text-[11px] text-gray-400 italic px-1">Дэд категори алга — доороос нэмнэ үү.</p>
                        )}
                        <button type="button" onClick={() => main.id && addSubCategory(main.id)} disabled={!main.id}
                          title={!main.id ? "Эхлээд үндсэн категорийн id бөглөнө үү" : ""}
                          className="inline-flex items-center gap-1 text-[11px] text-blue-700 hover:text-blue-800 bg-transparent border-none cursor-pointer font-semibold disabled:opacity-40 disabled:cursor-not-allowed">
                          <Plus size={12} /> Дэд категори нэмэх
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })()}

        <p className="mt-3 text-[10px] text-gray-400 leading-snug">
          Үндсэн категори (Жнь: <strong>Хөдөлгүүр</strong>) дотор дэд категори (сэлбэгийн нэр — Духны ремень, Турбо…) нэмнэ.
          Тоо нь approved бараагаар автоматаар бодогдоно; үндсэн категорийн тоо нь дэд категориудынхаа нийлбэр.
          <strong>id</strong> давхардахгүй, жижиг үсэг/тоо/_ зөвшөөрнө.
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
                  className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-[16px] md:text-[12px] focus:bg-white focus:border-blue-500 outline-none transition-colors font-sans resize-none" />
              ) : (
                <input
                  value={String(content.hero[f.key] || "")}
                  onChange={(e) => updateHero(f.key, e.target.value)}
                  placeholder={f.placeholder}
                  className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-[16px] md:text-[12px] focus:bg-white focus:border-blue-500 outline-none transition-colors font-sans" />
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
          Энэ категорид нэмэлт талбар алга. Шинэ шинж чанар нэмбэл seller-ийн &ldquo;Шинэ бараа&rdquo; форм автоматаар харуулна.
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
