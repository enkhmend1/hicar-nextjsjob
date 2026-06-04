import SiteContent from "../Model/siteContent.model.js";
import Product from "../Model/product.model.js";
import { validateAttributeDefinition } from "./productSchema.service.js";

/**
 * Default seed used when no SiteContent doc exists yet (fresh install).
 * Categories mirror the historical hardcoded list — admin can edit
 * later. SVG paths are inlined so the homepage has no extra fetch.
 */
const DEFAULT_CATEGORIES = [
  { id: "brake",        name: "Тоормос",      iconPath: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm0-12.5c-2.49 0-4.5 2.01-4.5 4.5S9.51 16.5 12 16.5s4.5-2.01 4.5-4.5S14.49 7.5 12 7.5z", order: 1, visible: true },
  { id: "engine",       name: "Хөдөлгүүр",    iconPath: "M13 2v8h8c0-4.42-3.58-8-8-8zm-2 0C6.48 2.05 3 5.56 3 10c0 4.97 4.03 9 9 9s9-4.03 9-9h-9V2z", order: 2, visible: true },
  { id: "lighting",     name: "Гэрэлтүүлэг",  iconPath: "M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7z", order: 3, visible: true },
  { id: "suspension",   name: "Амортизатор",  iconPath: "M17 8C8 10 5.9 16.17 3.82 21.34L5.71 22l1-2.3A4.49 4.49 0 008 20c3 0 3-2 6-2s3 2 6 2v-2c-3 0-3-2-6-2-.52 0-.96.03-1.39.08C13.77 13.23 15.71 10.72 17 8zm0-4v3l3-3H17z", order: 4, visible: true },
  { id: "electric",     name: "Цахилгаан",    iconPath: "M15.67 4H14V2h-4v2H8.33C7.6 4 7 4.6 7 5.33v15.33C7 21.4 7.6 22 8.33 22h7.33c.74 0 1.34-.6 1.34-1.33V5.33C17 4.6 16.4 4 15.67 4z", order: 5, visible: true },
  { id: "body",         name: "Бие, дарц",    iconPath: "M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99z", order: 6, visible: true },
  { id: "transmission", name: "Дамжуулга",    iconPath: "M22 9V7h-2V5c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-2h2v-2h-2v-2h2v-2h-2V9h2zm-4 10H4V5h14v14z", order: 7, visible: true },
  { id: "oils",         name: "Тос & Тосологоо", iconPath: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z", order: 8, visible: true },
];

const DEFAULT_HERO = {
  badge:    "AI-driven автомашины сэлбэг",
  title1:   "Автомашины сэлбэгээ",
  title2:   "Шинэ хэлбэрээр",
  titleAi:  "AI",
  title3:   "-тай",
  title4:   "хайж захиалаарай.",
  subtitle: "Vehicle plate, OEM код, эсвэл зургаар хайж улсын дугаар, машины загвараа автоматаар тааруулна.",
};

/**
 * Load (and lazily seed) the singleton SiteContent document. The seed
 * write is conditional via `upsert: true` so concurrent first reads
 * don't trip a duplicate-key error.
 *
 * Lean-returned for performance — callers don't need a hydrated Mongoose
 * document for read-only paths.
 */
export const loadSiteContent = async () => {
  const doc = await SiteContent.findById("main").lean();
  if (doc) return doc;
  // Upsert seed. Use updateOne with $setOnInsert so a concurrent caller
  // racing to seed doesn't overwrite the existing one.
  await SiteContent.updateOne(
    { _id: "main" },
    {
      $setOnInsert: {
        _id: "main",
        categories: DEFAULT_CATEGORIES,
        hero: DEFAULT_HERO,
        version: 1,
      },
    },
    { upsert: true },
  );
  return SiteContent.findById("main").lean();
};

/**
 * Compose the categories-with-counts payload the public homepage needs.
 * Joins admin-editable display metadata (name, icon, order, visible)
 * with the live MongoDB aggregate count of approved products.
 *
 * Hidden categories are omitted from the response.
 */
export const getCategoriesWithCounts = async () => {
  const [content, agg] = await Promise.all([
    loadSiteContent(),
    Product.aggregate([
      { $match: { status: "approved" } },
      { $group: { _id: "$category", count: { $sum: 1 } } },
    ]),
  ]);

  const countById = new Map(agg.map((r) => [r._id, r.count]));
  return content.categories
    .filter((c) => c.visible !== false)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((c) => ({
      id: c.id,
      name: c.name,
      iconPath: c.iconPath || "",
      imageUrl: c.imageUrl || "",
      count: countById.get(c.id) ?? 0,
      // Surface the attribute schema so seller forms can render dynamic
      // fields directly from this payload (no second round-trip).
      attributesSchema: Array.isArray(c.attributesSchema) ? c.attributesSchema : [],
    }));
};

/**
 * Admin write. Whole-document replace for categories + hero. Returns
 * the fresh saved document. Caller is responsible for adminOnly auth.
 */
export const updateSiteContent = async ({ categories, hero, updatedBy }) => {
  const doc = (await SiteContent.findById("main")) || new SiteContent({ _id: "main" });

  if (Array.isArray(categories)) {
    // Two-pass validation:
    //   1) Normalise each row and run validateAttributeDefinition on
    //      every attributesSchema entry. Collect ALL errors before
    //      throwing so the admin sees the full list, not just the
    //      first issue.
    //   2) Dedupe by id (case-insensitive lower) so the admin can't
    //      break the homepage with duplicate ids.
    const errors = [];
    const seen = new Set();
    const normalised = [];

    categories.forEach((c, idx) => {
      const id = String(c?.id || "").trim().toLowerCase();
      const name = String(c?.name || "").trim();
      const iconPath = String(c?.iconPath || "").trim();
      const imageUrl = String(c?.imageUrl || "").trim();
      if (!id || !name) {
        // Skip silently — frontend already inline-validates required
        // fields. Bad rows are non-fatal here so a typo in one row
        // doesn't reject the entire save.
        return;
      }
      if (seen.has(id)) {
        errors.push(`Категори "${id}" давхардаж байна`);
        return;
      }
      seen.add(id);

      // Validate attributesSchema rows. Reject the whole save on any
      // malformed row so persisted data is always parseable.
      const rawAttrs = Array.isArray(c.attributesSchema) ? c.attributesSchema : [];
      const attrSeen = new Set();
      const cleanedAttrs = [];
      rawAttrs.forEach((def, defIdx) => {
        const reason = validateAttributeDefinition(def);
        if (reason) {
          errors.push(`Категори "${id}", шинж #${defIdx + 1}: ${reason}`);
          return;
        }
        const key = String(def.key).trim().toLowerCase();
        if (attrSeen.has(key)) {
          errors.push(`Категори "${id}", шинж "${key}": давхардсан key`);
          return;
        }
        attrSeen.add(key);
        cleanedAttrs.push({
          key,
          label: String(def.label).trim(),
          type: def.type,
          options: def.type === "select"
            ? def.options.map((o) => String(o).trim()).filter(Boolean)
            : [],
          required: Boolean(def.required),
        });
      });

      normalised.push({
        id, name, iconPath, imageUrl,
        order: Number.isFinite(Number(c.order)) ? Number(c.order) : 0,
        visible: c.visible !== false,
        attributesSchema: cleanedAttrs,
      });
    });

    if (errors.length) {
      const err = new Error(errors.join("; "));
      err.code = "ATTRIBUTE_SCHEMA_INVALID";
      err.details = errors;
      throw err;
    }
    doc.categories = normalised;
  }

  if (hero && typeof hero === "object") {
    doc.hero = { ...(doc.hero?.toObject?.() ?? doc.hero ?? {}), ...hero };
  }

  if (updatedBy) doc.updatedBy = updatedBy;
  await doc.save();
  return doc.toObject();
};
