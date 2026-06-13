"use client";

/**
 * Seller multi-step product form.
 *
 * Architecture
 *   • A single `useForm` instance holds the whole product. Each "step"
 *     trigger-validates a STRICT subset of paths so the user can't
 *     advance until that step is clean.
 *   • The layout is fixed-height per region (stepper / content /
 *     footer) so transitions between steps don't shift the viewport.
 *   • Category-specific attributes mount dynamically from a registry
 *     keyed by `category` — adding a new category means adding one
 *     row to `CATEGORY_ATTRIBUTE_SCHEMAS` (in productSchema.ts) and
 *     one entry in `ATTRIBUTE_FIELDS` below.
 *   • Images go through the existing /api/upload Cloudinary endpoint
 *     (via api.uploadImage). The form holds only the resulting URLs,
 *     so the JSON POST payload stays small.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import Image from "next/image";
import {
  useForm, useFieldArray,
  type SubmitHandler, type FieldPath, type UseFormReturn,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { api, ApiError } from "@/lib/api";
import { useCategories, type AttributeDefinition } from "@/app/lib/useCategories";
import { tOption } from "@/app/lib/optionLabels";
import {
  productCreateSchema,
  step3PricingSchema,
  CATEGORY_LABELS,
  type ProductCreateInput,
  type KnownCategory,
} from "@/app/lib/productSchema";
import {
  AlertCircle, Check, CheckCircle2, ChevronLeft, ChevronRight, CornerDownRight,
  FolderTree, Loader2, Plus, Search, Trash2, Upload, X, ArrowLeft, PackagePlus,
} from "lucide-react";
import Link from "next/link";
import PageHeader from "@/app/seller/_components/PageHeader";

// Shared form-API type so child components and the parent agree on the
// exact UseFormReturn shape. Using a named alias avoids TS surfacing the
// "two different types with this name exist" diagnostic that triggers
// when generic inference produces structurally-equal-but-nominally-
// distinct shapes across function boundaries.
type ProductForm = UseFormReturn<ProductCreateInput>;

// ── Step metadata ─────────────────────────────────────────────────────
type StepDef = {
  id: "basics" | "fitment" | "pricing";
  title: string;
  /** Zod schema applied via trigger() before the user can advance. */
  paths: ReadonlyArray<FieldPath<ProductCreateInput>>;
};

const STEPS: ReadonlyArray<StepDef> = [
  { id: "basics",  title: "Үндсэн мэдээлэл",
    paths: ["name", "brand", "oem", "category"] as const },
  { id: "fitment", title: "Тохироо & Шинж",
    paths: ["fitments", "attributes"] as const },
  { id: "pricing", title: "Үнэ, нөөц, зураг",
    paths: ["price", "originalPrice", "stockQty", "images", "description"] as const },
];

const DEFAULT_VALUES: Partial<ProductCreateInput> = {
  name: "",
  brand: "",
  oem: "",
  category: "",
  source: "local",
  price: 0,
  stockQty: 100,
  description: "",
  tags: [],
  images: [],
  fitments: [],
  attributes: {},
};

// ── Page ──────────────────────────────────────────────────────────────
export default function NewProductPage() {
  const router = useRouter();
  const [stepIndex, setStepIndex] = useState(0);
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const form: ProductForm = useForm<ProductCreateInput>({
    resolver: zodResolver(productCreateSchema) as never,
    defaultValues: DEFAULT_VALUES,
    mode: "onTouched",
  });
  const { control, register, handleSubmit, trigger, watch, formState: { errors } } = form;

  const goNext = async () => {
    const step = STEPS[stepIndex];
    // Per-step trigger validates only that step's paths. The composed
    // submit at the end still runs the full schema as a backstop.
    const ok = await trigger(step.paths as FieldPath<ProductCreateInput>[], { shouldFocus: true });
    if (!ok) return;
    setStepIndex((i) => Math.min(i + 1, STEPS.length - 1));
  };
  const goBack = () => setStepIndex((i) => Math.max(i - 1, 0));

  const onSubmit: SubmitHandler<ProductCreateInput> = async (data) => {
    setSubmitError("");
    setSubmitting(true);
    try {
      await api.post("/products", data);
      router.push("/seller/products");
    } catch (e) {
      const err = e as ApiError;
      // Server-side Zod errors arrive as { errors: [{ path, message }] }.
      // Map them back to RHF so the user sees the offending field.
      const list = (err.data as { errors?: { path: string; message: string }[] })?.errors;
      if (Array.isArray(list) && list.length > 0) {
        for (const issue of list) {
          form.setError(issue.path as FieldPath<ProductCreateInput>, {
            type: "server", message: issue.message,
          });
        }
        // Jump back to the first step that owns the failing path.
        const firstStep = STEPS.findIndex((s) =>
          s.paths.some((p) => list.some((iss) => iss.path.startsWith(String(p)))));
        if (firstStep !== -1) setStepIndex(firstStep);
      }
      setSubmitError(err.message || "Хадгалж чадсангүй");
    } finally {
      setSubmitting(false);
    }
  };

  const onInvalid = () => {
    // If full-submit validation fails, jump to the FIRST step with errors.
    const failing = STEPS.findIndex((s) =>
      s.paths.some((p) => Boolean((errors as Record<string, unknown>)[p as string])));
    if (failing !== -1) setStepIndex(failing);
  };

  return (
    <div className="max-w-3xl mx-auto py-6 px-4">
      <PageHeader
        title="Шинэ бараа нэмэх"
        subtitle="3 алхамт форм — алхам бүрт автомат шалгана."
        icon={PackagePlus}
        actions={
          <Link href="/seller/products"
            className="inline-flex items-center gap-1.5 border border-gray-200 hover:border-blue-400 hover:bg-blue-50 text-gray-700 rounded-lg px-3 py-2 text-[13px] font-semibold cursor-pointer bg-white transition-all">
            <ArrowLeft size={14} /> Жагсаалт руу
          </Link>
        }
      />


      {/* ── Stepper (fixed height) ───────────────────────────────── */}
      <nav className="mt-5 mb-5 flex items-center" aria-label="Progress">
        {STEPS.map((s, i) => {
          const active = i === stepIndex;
          const done   = i < stepIndex;
          return (
            <div key={s.id} className="flex items-center flex-1 last:flex-none">
              <div className="flex items-center gap-2 shrink-0">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[12px] font-semibold border transition-colors ${
                  done   ? "bg-emerald-500 text-white border-emerald-500"
                  : active ? "bg-blue-600 text-white border-blue-600"
                  :          "bg-white text-gray-400 border-gray-300"
                }`}>
                  {done ? <CheckCircle2 size={14} /> : i + 1}
                </div>
                <span className={`text-[12px] font-medium whitespace-nowrap ${
                  active ? "text-blue-700" : done ? "text-emerald-700" : "text-gray-500"
                }`}>{s.title}</span>
              </div>
              {i < STEPS.length - 1 && (
                <div className={`flex-1 h-px mx-3 ${done ? "bg-emerald-300" : "bg-gray-200"}`} />
              )}
            </div>
          );
        })}
      </nav>

      {/* ── Form content (min-height locks layout) ──────────────── */}
      <form onSubmit={handleSubmit(onSubmit, onInvalid)} noValidate>
        <main className="bg-white border border-gray-200 rounded-2xl p-5 sm:p-6 min-h-[520px]">
          {stepIndex === 0 && <Step1Basics form={form} />}
          {stepIndex === 1 && (
            <Step2Fitment
              form={form}
              category={watch("category")}
            />
          )}
          {stepIndex === 2 && <Step3Pricing form={form} />}
        </main>

        {submitError && (
          <div className="mt-3 flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-[13px]">
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
            <span>{submitError}</span>
          </div>
        )}

        {/* ── Footer (fixed) ───────────────────────────────────── */}
        <footer className="mt-4 flex items-center justify-between gap-2">
          <button type="button" onClick={goBack} disabled={stepIndex === 0}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-gray-200 bg-white text-[13px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors font-sans">
            <ChevronLeft size={14} /> Буцах
          </button>

          {stepIndex < STEPS.length - 1 ? (
            <button type="button" onClick={goNext}
              className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-[13px] font-semibold text-white cursor-pointer border-none transition-colors font-sans">
              Дараах <ChevronRight size={14} />
            </button>
          ) : (
            <button type="submit" disabled={submitting}
              className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-[13px] font-semibold text-white cursor-pointer border-none transition-colors font-sans">
              {submitting && <Loader2 size={14} className="animate-spin" />}
              {submitting ? "Хадгалж байна…" : "Бараа хадгалах"}
            </button>
          )}
        </footer>
      </form>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Step 1 — basics
// ─────────────────────────────────────────────────────────────────────
function Step1Basics({ form }: { form: ProductForm }) {
  const { register, setValue, watch, formState: { errors } } = form;
  // Live category tree from /api/site-content/categories (same source as the
  // homepage + admin editor). Admin-added categories — and their sub-parts —
  // are available here instantly, no code change.
  const { categories, loading: catsLoading } = useCategories();
  const category = watch("category") || "";

  const mains = categories.filter((c) => !c.parentId);
  const known = categories.find((c) => c.id === category);

  // Step-by-step picker. pickedMain = the main the seller drilled into;
  // manualOn = the free-text "Бусад / гараас бичих" path. The active view is
  // derived so returning to this step (category already chosen) restores it.
  const [pickedMain, setPickedMain] = useState("");
  const [manualOn, setManualOn] = useState(false);
  const [subQuery, setSubQuery] = useState("");
  const [manualText, setManualText] = useState(() => category);

  const activeMain = pickedMain || (known ? (known.parentId || known.id) : "");
  const activeMainCat = categories.find((c) => c.id === activeMain);
  const manualActive = manualOn || (!!category && !known && !catsLoading);
  const subs = activeMain ? categories.filter((c) => c.parentId === activeMain) : [];
  const sq = subQuery.trim().toLowerCase();
  const filteredSubs = sq
    ? subs.filter((s) => s.name.toLowerCase().includes(sq) || s.id.includes(sq))
    : subs;

  const slugify = (s: string) =>
    s.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
  const choose = (id: string) => {
    setManualOn(false);
    setValue("category", id, { shouldValidate: true, shouldDirty: true });
  };
  // "Өөрчлөх" clears the selection and returns to the main grid.
  const resetPick = () => {
    setPickedMain(""); setManualOn(false); setSubQuery("");
    setValue("category", "", { shouldDirty: true });
  };

  const inputCls = "w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-[16px] md:text-[13px] focus:border-blue-500 focus:bg-white outline-none transition-colors font-sans";

  return (
    <div className="space-y-4">
      <Field label="Нэр" hint="Каталоги дээр харагдах гарчиг" error={errors.name?.message}>
        <input {...register("name")} className={inputCls}
          placeholder="Жнь: Toyota Crown 2010 бамперын фар" />
      </Field>

      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Брэнд" error={errors.brand?.message}>
          <input {...register("brand")} className={inputCls} placeholder="Toyota OEM, Bosch, …" />
        </Field>
        <Field label="OEM код" hint="Заавал биш" error={errors.oem?.message}>
          <input {...register("oem")} className={`${inputCls} font-mono`} placeholder="04465-0E010" />
        </Field>
      </div>

      {/* ── Step-by-step category picker ───────────────────────── */}
      <div>
        <label className="block text-[12px] font-medium text-gray-700 mb-1.5">
          Категори <span className="text-red-500">*</span>
        </label>

        {catsLoading ? (
          <div className="text-[12px] text-gray-400 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3">
            Категори ачаалж байна…
          </div>
        ) : (!activeMain && !manualActive) ? (
          /* Stage A — choose a MAIN category */
          <div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {mains.map((m) => {
                const subCount = categories.filter((c) => c.parentId === m.id).length;
                return (
                  <button key={m.id} type="button" onClick={() => setPickedMain(m.id)}
                    className="flex items-center gap-2 text-left bg-white border border-gray-200 hover:border-blue-400 hover:bg-blue-50/50 rounded-xl p-3 cursor-pointer transition-colors group">
                    <span className="w-9 h-9 shrink-0 rounded-lg bg-blue-50 group-hover:bg-blue-100 flex items-center justify-center overflow-hidden">
                      {m.imageUrl
                        ? <Image src={m.imageUrl} alt={m.name} width={36} height={36} className="w-full h-full object-cover" />
                        : m.iconPath
                          ? <svg className="w-4 h-4 fill-blue-600" viewBox="0 0 24 24"><path d={m.iconPath} /></svg>
                          : <FolderTree size={16} className="text-blue-600" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[13px] font-semibold text-gray-900 truncate">{m.name}</span>
                      <span className="block text-[10px] text-gray-400">{subCount > 0 ? `${subCount} дэд төрөл` : "Шууд сонгох"}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            <button type="button" onClick={() => { setManualText(""); setManualOn(true); }}
              className="mt-2 inline-flex items-center gap-1 text-[12px] text-gray-500 hover:text-blue-700 bg-transparent border-none cursor-pointer font-sans">
              <Plus size={12} /> Бусад / гараас бичих
            </button>
          </div>
        ) : (
          /* Stage B — drilled into a main (or manual entry) */
          <div className="border border-gray-200 rounded-xl p-3 bg-gray-50/40">
            <div className="flex items-center justify-between mb-2.5">
              <div className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-gray-700 min-w-0">
                <FolderTree size={13} className="text-blue-600 shrink-0" />
                <span className="truncate">{manualActive ? "Гараас бичих" : activeMainCat?.name || "Категори"}</span>
              </div>
              <button type="button" onClick={resetPick}
                className="inline-flex items-center gap-1 text-[11px] text-blue-700 hover:text-blue-800 bg-transparent border-none cursor-pointer font-semibold shrink-0">
                <ChevronLeft size={12} /> Өөрчлөх
              </button>
            </div>

            {manualActive ? (
              <input
                value={manualText}
                onChange={(e) => { setManualText(e.target.value); setValue("category", slugify(e.target.value), { shouldValidate: true, shouldDirty: true }); }}
                placeholder="Сэлбэгийн төрлөө бичнэ үү (Жнь: Турбо хоолой)"
                className={inputCls} autoFocus />
            ) : (
              <>
                {subs.length > 6 && (
                  <div className="relative mb-2">
                    <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input value={subQuery} onChange={(e) => setSubQuery(e.target.value)}
                      placeholder="Дэд төрөл хайх…"
                      className="w-full pl-8 pr-3 py-2 text-[12px] bg-white border border-gray-200 rounded-lg focus:border-blue-500 outline-none transition-colors" />
                  </div>
                )}

                {subs.length === 0 ? (
                  <button type="button" onClick={() => choose(activeMain)}
                    className={`w-full text-left rounded-lg px-3 py-2.5 text-[13px] border cursor-pointer transition-colors ${
                      category === activeMain ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-700 border-gray-200 hover:border-blue-400"
                    }`}>
                    {category === activeMain && <Check size={13} className="inline mr-1.5" />}
                    «{activeMainCat?.name}»-г сонгох
                    <span className="block text-[10px] opacity-70 mt-0.5">Энэ категорид дэд төрөл алга.</span>
                  </button>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-64 overflow-y-auto pr-0.5">
                    {filteredSubs.map((s) => {
                      const sel = category === s.id;
                      return (
                        <button key={s.id} type="button" onClick={() => choose(s.id)}
                          className={`flex items-center gap-2 text-left rounded-lg px-3 py-2 text-[12px] border cursor-pointer transition-colors ${
                            sel ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-700 border-gray-200 hover:border-blue-400 hover:bg-blue-50/50"
                          }`}>
                          {sel
                            ? <Check size={13} className="shrink-0" />
                            : <CornerDownRight size={13} className="shrink-0 text-gray-300" />}
                          <span className="truncate flex-1">{s.name}</span>
                        </button>
                      );
                    })}
                    {filteredSubs.length === 0 && (
                      <p className="col-span-full text-[11px] text-gray-400 italic px-1 py-2">Илэрц алга.</p>
                    )}
                  </div>
                )}

                <button type="button" onClick={() => { setManualText(""); setManualOn(true); }}
                  className="mt-2 inline-flex items-center gap-1 text-[11px] text-gray-500 hover:text-blue-700 bg-transparent border-none cursor-pointer font-sans">
                  <Plus size={12} /> Жагсаалтад алга — гараас бичих
                </button>
              </>
            )}
          </div>
        )}

        {/* selected summary + error */}
        {category && (
          <div className="mt-2 inline-flex items-center gap-1.5 text-[12px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1">
            <Check size={12} /> Сонгосон: <strong>{known?.name || category}</strong>
          </div>
        )}
        {errors.category?.message && (
          <p className="mt-1 text-[10px] text-red-500 inline-flex items-center gap-1">
            <AlertCircle size={10} /> {errors.category.message}
          </p>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Step 2 — fitment + dynamic attributes
// ─────────────────────────────────────────────────────────────────────
function Step2Fitment({
  form, category,
}: {
  form: ProductForm;
  category: string;
}) {
  const { control, register, formState: { errors } } = form;
  const { fields, append, remove } = useFieldArray({ control, name: "fitments" });
  const { categories } = useCategories();
  // Pretty label: prefer the admin-edited display name from site-content,
  // fall back to built-in CATEGORY_LABELS for the static schema keys,
  // then "Бусад" for anything totally unknown.
  const liveLabel =
    categories.find((c) => c.id === category)?.name
    ?? CATEGORY_LABELS[category as KnownCategory]
    ?? (category ? "Бусад" : "Категори сонгоогүй");

  return (
    <div className="space-y-6">
      {/* ── Fitments table ────────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-[14px] font-semibold text-gray-900">Машины тохироо (Fitment)</h2>
          <button type="button"
            onClick={() => append({ make: "", model: "", generation: "", yearStart: undefined, yearEnd: undefined })}
            className="inline-flex items-center gap-1 text-[12px] text-blue-700 hover:text-blue-800 bg-transparent border-none cursor-pointer font-semibold font-sans">
            <Plus size={13} /> Мөр нэмэх
          </button>
        </div>

        {fields.length === 0 && (
          <div className="text-[12px] text-gray-400 bg-gray-50 border border-dashed border-gray-200 rounded-xl p-3 text-center">
            Универсал бараа бол хоосон үлдээж болно. Тодорхой машинд тохирох бол &ldquo;Мөр нэмэх&rdquo;.
          </div>
        )}

        <div className="space-y-2">
          {fields.map((field, idx) => {
            const rowErr = errors.fitments?.[idx];
            return (
              <div key={field.id} className="grid grid-cols-[1fr_1fr_1fr_80px_80px_28px] gap-1.5 items-start">
                <input {...register(`fitments.${idx}.make`)}
                  placeholder="Make"
                  className="bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-2 text-[12px] focus:border-blue-500 outline-none font-sans" />
                <input {...register(`fitments.${idx}.model`)}
                  placeholder="Model"
                  className="bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-2 text-[12px] focus:border-blue-500 outline-none font-sans" />
                <input {...register(`fitments.${idx}.generation`)}
                  placeholder="Generation (заавал биш)"
                  className="bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-2 text-[12px] focus:border-blue-500 outline-none font-sans" />
                <input type="number" {...register(`fitments.${idx}.yearStart`, { valueAsNumber: true })}
                  placeholder="2010"
                  className="bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-2 text-[12px] focus:border-blue-500 outline-none font-sans" />
                <input type="number" {...register(`fitments.${idx}.yearEnd`, { valueAsNumber: true })}
                  placeholder="2015"
                  className={`bg-gray-50 border rounded-lg px-2.5 py-2 text-[12px] focus:border-blue-500 outline-none font-sans ${
                    rowErr?.yearEnd ? "border-red-300" : "border-gray-200"
                  }`} />
                <button type="button" onClick={() => remove(idx)}
                  className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-red-500 rounded-lg cursor-pointer bg-transparent border-none transition-colors">
                  <Trash2 size={13} />
                </button>
                {rowErr?.yearEnd?.message && (
                  <div className="col-span-6 text-[10px] text-red-500">{rowErr.yearEnd.message}</div>
                )}
                {(rowErr?.make?.message || rowErr?.model?.message) && (
                  <div className="col-span-6 text-[10px] text-red-500">
                    {rowErr.make?.message || rowErr.model?.message}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Dynamic attributes ────────────────────────────────── */}
      <section>
        <h2 className="text-[14px] font-semibold text-gray-900 mb-2">
          Категори тусгай үзүүлэлт
          <span className="ml-2 text-[11px] font-normal text-gray-400">({liveLabel})</span>
        </h2>
        <AttributesFor category={category} form={form} />
      </section>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Step 3 — pricing + images
// ─────────────────────────────────────────────────────────────────────
function Step3Pricing({ form }: { form: ProductForm }) {
  const { register, control, formState: { errors }, watch, setValue } = form;
  const images = watch("images") || [];

  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState("");

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true); setUploadErr("");
    try {
      const uploaded: string[] = [];
      for (const file of Array.from(files).slice(0, 10 - images.length)) {
        const { url } = await api.uploadImage(file);
        if (url) uploaded.push(url);
      }
      setValue("images", [...images, ...uploaded], { shouldValidate: true, shouldDirty: true });
    } catch (e) {
      setUploadErr((e as Error).message || "Зураг хадгалж чадсангүй");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-3 gap-4">
        <Field label="Үнэ (₮)" error={errors.price?.message}>
          <input type="number" {...register("price", { valueAsNumber: true })} min={0}
            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-[16px] md:text-[13px] focus:border-blue-500 focus:bg-white outline-none transition-colors font-sans" />
        </Field>
        <Field label="Хямдралын өмнөх үнэ (₮)" hint="Заавал биш" error={errors.originalPrice?.message}>
          <input type="number" {...register("originalPrice", { valueAsNumber: true, setValueAs: (v) => v === "" || v == null ? undefined : Number(v) })} min={0}
            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-[16px] md:text-[13px] focus:border-blue-500 focus:bg-white outline-none transition-colors font-sans" />
        </Field>
        <Field label="Нөөц (ширхэг)" error={errors.stockQty?.message}>
          <input type="number" {...register("stockQty", { valueAsNumber: true })} min={0}
            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-[16px] md:text-[13px] focus:border-blue-500 focus:bg-white outline-none transition-colors font-sans" />
        </Field>
      </div>

      <Field label="Тайлбар" hint="Дэлгэрэнгүй техникийн мэдээлэл, нөхцөл, баталгаа" error={errors.description?.message}>
        <textarea {...register("description")} rows={4}
          className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-[16px] md:text-[13px] focus:border-blue-500 focus:bg-white outline-none transition-colors font-sans resize-none" />
      </Field>

      <div>
        <label className="block text-[12px] font-medium text-gray-700 mb-1.5">Зураг ({images.length}/10)</label>
        <div className="flex flex-wrap gap-2">
          {images.map((url, i) => (
            <div key={url} className="relative w-20 h-20 rounded-lg overflow-hidden border border-gray-200 group">
              <Image src={url} alt="" fill sizes="80px" className="object-cover" unoptimized />
              <button type="button"
                onClick={() => setValue("images", images.filter((_, idx) => idx !== i), { shouldValidate: true, shouldDirty: true })}
                className="absolute top-1 right-1 w-5 h-5 bg-black/60 text-white rounded-full flex items-center justify-center cursor-pointer border-none">
                <X size={10} />
              </button>
            </div>
          ))}
          {images.length < 10 && (
            <label className={`w-20 h-20 border-2 border-dashed rounded-lg flex flex-col items-center justify-center cursor-pointer transition-colors ${
              uploading ? "border-blue-300 bg-blue-50" : "border-gray-300 hover:border-blue-400"
            }`}>
              <input type="file" accept="image/*" multiple className="hidden"
                onChange={(e) => onFiles(e.target.files)} disabled={uploading} />
              {uploading
                ? <Loader2 size={16} className="animate-spin text-blue-500" />
                : <Upload size={16} className="text-gray-400" />}
              <span className="text-[10px] text-gray-400 mt-1">{uploading ? "Хадгалж…" : "Нэмэх"}</span>
            </label>
          )}
        </div>
        {uploadErr && (
          <div className="mt-1.5 text-[11px] text-red-500 inline-flex items-center gap-1">
            <AlertCircle size={11} /> {uploadErr}
          </div>
        )}
        {errors.images?.message && (
          <div className="mt-1.5 text-[11px] text-red-500">{errors.images.message}</div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Dynamic attribute renderer
// ─────────────────────────────────────────────────────────────────────
type AttrField =
  | { kind: "enum"; key: string; label: string; options: { value: string; label: string }[]; required?: boolean }
  | { kind: "text"; key: string; label: string; placeholder?: string; required?: boolean }
  | { kind: "number"; key: string; label: string; min?: number; max?: number; step?: number; required?: boolean };

const ATTRIBUTE_FIELDS: Record<KnownCategory, AttrField[]> = {
  body: [
    { kind: "enum", key: "side", label: "Тал", required: true, options: [
      { value: "left", label: "Зүүн" }, { value: "right", label: "Баруун" },
      { value: "front", label: "Урд" }, { value: "rear", label: "Хойд" },
      { value: "top", label: "Дээд" }, { value: "bottom", label: "Доод" },
      { value: "n/a", label: "Хамаагүй" },
    ]},
    { kind: "text",   key: "color",    label: "Өнгө",      placeholder: "Pearl White 070" },
    { kind: "enum",   key: "material", label: "Материал",  options: [
      { value: "plastic", label: "Хуванцар" }, { value: "steel", label: "Ган" },
      { value: "aluminum", label: "Хөнгөн цагаан" }, { value: "fiberglass", label: "Шилэн ширхэгт" },
      { value: "carbon", label: "Карбон" }, { value: "rubber", label: "Резин" },
      { value: "glass", label: "Шил" }, { value: "other", label: "Бусад" },
    ]},
    { kind: "enum", key: "finish", label: "Гадаргуу", options: [
      { value: "", label: "—" }, { value: "painted", label: "Будсан" },
      { value: "primed", label: "Праймертай" }, { value: "bare", label: "Хайруу" },
      { value: "polished", label: "Зүлгэсэн" },
    ]},
  ],
  oils: [
    { kind: "text", key: "viscosity", label: "Зуурамтгайн зэрэг", required: true, placeholder: "5W-30" },
    { kind: "number", key: "volume", label: "Эзлэхүүн (л)", required: true, min: 0.1, max: 200, step: 0.1 },
    { kind: "enum", key: "oilType", label: "Тосны төрөл", required: true, options: [
      { value: "synthetic", label: "Бүрэн синтетик" },
      { value: "semi-synthetic", label: "Хагас синтетик" },
      { value: "mineral", label: "Минерал" },
      { value: "racing", label: "Racing" },
    ]},
    { kind: "text", key: "api",  label: "API ангилал",  placeholder: "SN, SP, CK-4" },
    { kind: "text", key: "acea", label: "ACEA ангилал", placeholder: "A3/B4, C3" },
  ],
  brake: [
    { kind: "enum", key: "partType", label: "Эд анги", required: true, options: [
      { value: "pad", label: "Накладка" }, { value: "disc", label: "Диск" },
      { value: "drum", label: "Тоормосны бөмбөг" }, { value: "shoe", label: "Гутал" },
      { value: "caliper", label: "Супорт" }, { value: "fluid", label: "Шингэн" },
      { value: "hose", label: "Шланг" },
    ]},
    { kind: "enum", key: "frictionGrade", label: "Үрэлтийн материал", options: [
      { value: "", label: "—" }, { value: "organic", label: "Органик" },
      { value: "ceramic", label: "Керамик" }, { value: "semi-metallic", label: "Хагас металл" },
      { value: "low-metallic", label: "Бага металл" },
    ]},
    { kind: "enum", key: "axle", label: "Тэнхлэг", options: [
      { value: "front", label: "Урд" }, { value: "rear", label: "Хойд" },
      { value: "n/a", label: "Хамаагүй" },
    ]},
  ],
  engine: [
    { kind: "enum", key: "componentType", label: "Эд анги", required: true, options: [
      { value: "piston", label: "Поршень" }, { value: "valve", label: "Клапан" },
      { value: "gasket", label: "Жийрэг" }, { value: "filter", label: "Шүүлтүүр" },
      { value: "belt", label: "Бүс" }, { value: "spark-plug", label: "Свеч" },
      { value: "injector", label: "Форсунка" }, { value: "pump", label: "Насос" },
      { value: "other", label: "Бусад" },
    ]},
    { kind: "text", key: "engineSpec", label: "Хөдөлгүүрийн спец.", placeholder: "1.8L 2ZR-FE" },
  ],
  electric: [
    { kind: "enum", key: "componentType", label: "Эд анги", required: true, options: [
      { value: "battery", label: "Аккумулятор" }, { value: "alternator", label: "Генератор" },
      { value: "starter", label: "Стартер" }, { value: "sensor", label: "Мэдрэгч" },
      { value: "wiring", label: "Утас" }, { value: "fuse", label: "Predohranitel" },
      { value: "relay", label: "Релэ" }, { value: "ecu", label: "ECU" },
    ]},
    { kind: "enum", key: "voltage", label: "Хүчдэл", options: [
      { value: "12", label: "12V" }, { value: "24", label: "24V" },
    ]},
    { kind: "number", key: "capacityAh", label: "Багтаамж (Ah)", min: 1, max: 2000 },
  ],
};

/**
 * Convert an admin-edited AttributeDefinition into the AttrField shape
 * the legacy renderer uses. Lets the same widget code render both
 * static and dynamic schemas without branching the JSX.
 */
const dynamicToAttrField = (def: AttributeDefinition): AttrField => {
  if (def.type === "number") {
    return { kind: "number", key: def.key, label: def.label, required: def.required };
  }
  if (def.type === "select") {
    return {
      kind: "enum",
      key: def.key,
      label: def.label,
      required: def.required,
      // Stored value stays as the admin-set English key; display goes
      // through tOption() so the seller sees a Mongolian label without
      // changing what we persist or send to the API.
      options: (def.options || []).map((o) => ({ value: o, label: tOption(o, def.key) })),
    };
  }
  return { kind: "text", key: def.key, label: def.label, required: def.required };
};

function AttributesFor({
  category, form,
}: {
  category: string;
  form: ProductForm;
}) {
  const { categories } = useCategories();
  const { register, formState: { errors } } = form;
  // Pull the attributes sub-error map.
  const attrErrors = (errors.attributes as Record<string, { message?: string } | undefined>) || {};

  // Priority:
  //   ① Admin-edited attributesSchema from SiteContent (no-code dynamic)
  //   ② Legacy hardcoded ATTRIBUTE_FIELDS for the built-in categories
  //   ③ Empty → "no extra fields" notice
  // Whichever source wins, we convert to the SAME AttrField shape and
  // hand it to the existing renderer below.
  const dynamicDefs = categories.find((c) => c.id === category)?.attributesSchema;
  const fields: AttrField[] | undefined =
    dynamicDefs && dynamicDefs.length > 0
      ? dynamicDefs.map(dynamicToAttrField)
      : (ATTRIBUTE_FIELDS as Record<string, AttrField[]>)[category];

  if (!fields || fields.length === 0) {
    return (
      <div className="text-[12px] text-gray-400 bg-gray-50 border border-dashed border-gray-200 rounded-xl p-3">
        Энэ категорид нэмэлт талбар алга. 3-р алхам руу үргэлжлүүлнэ үү.
      </div>
    );
  }

  return (
    <div className="grid sm:grid-cols-2 gap-3">
      {fields.map((f) => {
        const path = `attributes.${f.key}` as const;
        const err = attrErrors[f.key]?.message;
        const label = f.label + (f.required ? " *" : "");
        const cls = `w-full bg-gray-50 border rounded-xl px-3 py-2 text-[16px] md:text-[13px] focus:border-blue-500 focus:bg-white outline-none transition-colors font-sans ${
          err ? "border-red-300" : "border-gray-200"
        }`;

        if (f.kind === "enum") {
          return (
            <Field key={f.key} label={label} error={err}>
              <select {...register(path as FieldPath<ProductCreateInput>)} className={cls}>
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </Field>
          );
        }
        if (f.kind === "number") {
          return (
            <Field key={f.key} label={label} error={err}>
              <input type="number" min={f.min} max={f.max} step={f.step}
                {...register(path as FieldPath<ProductCreateInput>, {
                  setValueAs: (v) => v === "" || v == null ? undefined : Number(v),
                })}
                className={cls} />
            </Field>
          );
        }
        return (
          <Field key={f.key} label={label} error={err}>
            <input {...register(path as FieldPath<ProductCreateInput>)}
              placeholder={f.placeholder} className={cls} />
          </Field>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Reusable field wrapper
// ─────────────────────────────────────────────────────────────────────
function Field({
  label, hint, error, children,
}: {
  label: string; hint?: string; error?: string; children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-[12px] font-medium text-gray-700 mb-1">{label}</label>
      {children}
      {hint && !error && <p className="mt-1 text-[10px] text-gray-400">{hint}</p>}
      {error && (
        <p className="mt-1 text-[10px] text-red-500 inline-flex items-center gap-1">
          <AlertCircle size={10} /> {error}
        </p>
      )}
    </div>
  );
}
