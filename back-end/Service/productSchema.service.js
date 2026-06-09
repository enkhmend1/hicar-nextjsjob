/**
 * Product input validation — single source of truth for both backend and
 * frontend.
 *
 * Architecture (No-Code Dynamic Schema):
 *
 *   • `baseProductSchema` — always-present fields (name, brand, oem,
 *     price, stock, images, category, description, tags, fitments).
 *   • `buildDynamicAttributesSchema(defs)` — pure compiler that turns an
 *     admin-edited `attributesSchema` definition array (from
 *     SiteContent.categories[].attributesSchema) into a runtime
 *     `z.object()`. Handles text / number / select types with required
 *     toggle and select-options validation.
 *   • `resolveCategoryAttributeSchema(categoryId)` — async lookup that
 *     returns the Zod object for a given category id with priority:
 *       ① SiteContent.categories[id].attributesSchema  (dynamic, admin-managed)
 *       ② STATIC_CATEGORY_SCHEMAS[id]                  (legacy fallback)
 *       ③ null                                         (caller accepts free record)
 *   • `validateProductCreate(input)` / `validateProductUpdate(input,
 *     existingCategory?)` — the async entrypoints the controller uses.
 *     Returns `{ success, data | error }` so callers can map to HTTP
 *     status without try/catch.
 *
 * The legacy hardcoded schemas (body/oils/brake/engine/electric) remain
 * exported so the migration is incremental — operators can move
 * categories one by one to dynamic admin-managed schemas without a
 * code change. New categories ALWAYS go through the dynamic path.
 *
 * The Mongoose Product.attributes field is Mixed at the DB layer; this
 * validator is the ONLY layer enforcing per-category shape. Always run
 * it BEFORE persisting.
 */

import { z } from "zod";
import { logger } from "../Config/logger.js";

// ────────────────────────────────────────────────────────────────────
// Common building blocks
// ────────────────────────────────────────────────────────────────────

const trimmed = (max) => z.string().trim().min(1).max(max);

const oemField = z
  .string()
  .trim()
  .max(40)
  .regex(/^[A-Za-z0-9._\-/ ]*$/, "OEM код буруу форматтай байна")
  .default("");

const VIN_YEAR_MIN = 1950;
const VIN_YEAR_MAX = 2100;

// ────────────────────────────────────────────────────────────────────
// Fitment row — make / model / generation / year range
// ────────────────────────────────────────────────────────────────────

export const fitmentSchema = z
  .object({
    make:       trimmed(60),
    model:      trimmed(60),
    generation: z.string().trim().max(40).optional().default(""),
    yearStart:  z.coerce.number().int().min(VIN_YEAR_MIN).max(VIN_YEAR_MAX).optional(),
    yearEnd:    z.coerce.number().int().min(VIN_YEAR_MIN).max(VIN_YEAR_MAX).optional(),
  })
  .superRefine((row, ctx) => {
    if (row.yearStart != null && row.yearEnd != null && row.yearStart > row.yearEnd) {
      ctx.addIssue({
        code: "custom",
        message: "yearStart нь yearEnd-аас илүү байж болохгүй",
        path: ["yearEnd"],
      });
    }
  });

// ────────────────────────────────────────────────────────────────────
// LEGACY hardcoded per-category schemas (kept as fallback)
//
// These exist for the 5 categories the platform shipped with. New
// categories admins create are validated via buildDynamicAttributesSchema
// — they don't need to live here. Migrating a legacy category to the
// dynamic path is a no-op on the seller side: write equivalent
// definitions into SiteContent.categories[id].attributesSchema and
// resolveCategoryAttributeSchema will prefer them automatically.
// ────────────────────────────────────────────────────────────────────

export const bodyAttributesSchema = z.object({
  side: z.enum(["left", "right", "front", "rear", "top", "bottom", "n/a"]),
  color: z.string().trim().max(40).optional().default(""),
  material: z.enum([
    "plastic", "steel", "aluminum", "fiberglass", "carbon", "rubber", "glass", "other",
  ]).default("other"),
  finish: z.enum(["painted", "primed", "bare", "polished"]).optional(),
});

export const oilsAttributesSchema = z.object({
  viscosity: z.string()
    .trim()
    .regex(/^\d{1,2}W-?\d{2,3}$/i, "Зуурамтгайн зэрэг (жнь 5W-30) форматаар бичнэ үү"),
  volume: z.coerce.number().min(0.1).max(200),
  oilType: z.enum(["synthetic", "semi-synthetic", "mineral", "racing"]),
  api: z.string().trim().max(20).optional().default(""),
  acea: z.string().trim().max(20).optional().default(""),
});

export const brakeAttributesSchema = z.object({
  partType: z.enum(["pad", "disc", "drum", "shoe", "caliper", "fluid", "hose"]),
  frictionGrade: z.enum(["organic", "ceramic", "semi-metallic", "low-metallic"]).optional(),
  axle: z.enum(["front", "rear", "n/a"]).default("n/a"),
});

export const engineAttributesSchema = z.object({
  componentType: z.enum([
    "piston", "valve", "gasket", "filter", "belt", "spark-plug", "injector", "pump", "other",
  ]),
  engineSpec: z.string().trim().max(80).optional().default(""),
});

export const electricAttributesSchema = z.object({
  componentType: z.enum(["battery", "alternator", "starter", "sensor", "wiring", "fuse", "relay", "ecu"]),
  voltage: z.enum(["12", "24"]).default("12"),
  capacityAh: z.coerce.number().min(1).max(2000).optional(),
});

export const STATIC_CATEGORY_SCHEMAS = Object.freeze({
  body:     bodyAttributesSchema,
  oils:     oilsAttributesSchema,
  brake:    brakeAttributesSchema,
  engine:   engineAttributesSchema,
  electric: electricAttributesSchema,
});

/** @deprecated use STATIC_CATEGORY_SCHEMAS. Preserved for older imports. */
export const CATEGORY_ATTRIBUTE_SCHEMAS = STATIC_CATEGORY_SCHEMAS;
export const KNOWN_CATEGORIES = Object.freeze(Object.keys(STATIC_CATEGORY_SCHEMAS));

// ────────────────────────────────────────────────────────────────────
// Dynamic schema compiler — turns admin-edited definitions into Zod.
// ────────────────────────────────────────────────────────────────────

/**
 * Validate ONE attribute-definition row. Returns null if valid, or a
 * string describing why the row is malformed. Used by the admin save
 * path AND defensively at request time.
 */
export const validateAttributeDefinition = (def) => {
  if (!def || typeof def !== "object") return "Definition object байх ёстой";
  const key = String(def.key || "").trim();
  if (!key)                                       return "key талбар хоосон байж болохгүй";
  if (!/^[a-z][a-z0-9_]{0,39}$/i.test(key))       return `key "${key}" нь үсэг/тоо/доогуур зураас, max 40 тэмдэгт`;
  const label = String(def.label || "").trim();
  if (!label)                                     return `${key}: label хоосон байж болохгүй`;
  if (label.length > 100)                         return `${key}: label 100 тэмдэгтээс ихгүй`;
  if (!["text", "number", "select"].includes(def.type)) {
    return `${key}: type зөвхөн text/number/select байж болно`;
  }
  if (def.type === "select") {
    const opts = Array.isArray(def.options) ? def.options : [];
    if (opts.length === 0)                        return `${key}: select төрөл нь option-уудтай байх ёстой`;
    if (opts.length > 30)                         return `${key}: 30-аас цөөн option`;
    if (opts.some((o) => !o || String(o).trim().length === 0)) {
      return `${key}: хоосон option`;
    }
  }
  return null;
};

/**
 * Pure compiler: definitions array → Zod object. Bad rows are SILENTLY
 * dropped (caller is responsible for using validateAttributeDefinition
 * at the admin write boundary, so the persisted data is already clean).
 */
export const buildDynamicAttributesSchema = (definitions) => {
  const shape = {};
  if (!Array.isArray(definitions) || definitions.length === 0) {
    // Empty schema → accepts an empty object only. Caller's job to fall
    // through to the free-record case when no rules exist.
    return z.object({});
  }
  for (const def of definitions) {
    if (validateAttributeDefinition(def) !== null) continue; // skip malformed rows defensively

    let field;
    if (def.type === "number") {
      field = z.coerce.number().finite();
    } else if (def.type === "select") {
      field = z.enum(def.options);
    } else {
      // text
      field = z.string().trim().max(500);
    }

    if (def.required) {
      // For required text fields, also enforce non-empty.
      if (def.type === "text") field = field.min(1, `${def.label} шаардлагатай`);
    } else {
      field = field.optional();
    }

    shape[def.key] = field;
  }
  return z.object(shape);
};

/**
 * Resolve which Zod schema validates a given category's attributes.
 * Priority order:
 *
 *   ① Admin-edited dynamic schemas in SiteContent.categories[id]
 *   ② Legacy hardcoded STATIC_CATEGORY_SCHEMAS[id]
 *   ③ null  (caller falls back to accepting any record)
 */
export const resolveCategoryAttributeSchema = async (categoryId) => {
  if (!categoryId) return null;
  const id = String(categoryId).toLowerCase();

  // Lazy import to dodge a circular load (siteContent.service may itself
  // import from places that pull this module).
  try {
    const { loadSiteContent } = await import("./siteContent.service.js");
    const content = await loadSiteContent();
    const cat = content.categories?.find?.((c) => c.id === id);
    const defs = cat?.attributesSchema;
    if (Array.isArray(defs) && defs.length > 0) {
      return buildDynamicAttributesSchema(defs);
    }
  } catch (err) {
    // SiteContent unreadable (DB outage during boot, etc.) → fall through
    // to legacy. Log loudly so the operator notices.
    logger.warn("productSchema SiteContent lookup failed", { err, id });
  }

  return STATIC_CATEGORY_SCHEMAS[id] || null;
};

// ────────────────────────────────────────────────────────────────────
// Base product schema — fields common to every category
// ────────────────────────────────────────────────────────────────────

export const baseProductSchema = z.object({
  name:              trimmed(200),
  brand:             trimmed(60),
  oem:               oemField,
  category:          z.string().trim().toLowerCase().min(1).max(60),
  source:            z.string().trim().max(60).optional().default("local"),

  price:             z.coerce.number().int().min(0).max(1_000_000_000),
  originalPrice:     z.coerce.number().int().min(0).max(1_000_000_000).optional(),
  stockQty:          z.coerce.number().int().min(0).max(1_000_000).default(100),
  lowStockThreshold: z.coerce.number().int().min(-1).max(10_000).optional(),

  description:       z.string().max(4000).optional().default(""),
  badge:             z.string().trim().max(40).optional().default(""),
  tags:              z.array(z.string().trim().toLowerCase().min(1).max(40)).max(20).default([]),

  images:            z.array(z.string().url().max(500)).max(10).default([]),
  iconPath:          z.string().max(500).optional().default(""),

  fitments:          z.array(fitmentSchema).max(50).default([]),
  attributes:        z.record(z.string(), z.unknown()).optional().default({}),

  deliveryDays:      z.object({
    fast:   z.coerce.number().int().min(0).max(365).default(7),
    normal: z.coerce.number().int().min(0).max(365).default(14),
    cheap:  z.coerce.number().int().min(0).max(365).default(21),
  }).optional(),
});

// ────────────────────────────────────────────────────────────────────
// Public async validators — controller entry points
// ────────────────────────────────────────────────────────────────────

/**
 * Apply category-specific attribute validation against an already
 * base-validated payload. Mutates `data.attributes` to the parsed
 * (default-applied) shape on success. Returns ZodError on failure.
 */
const applyDynamicAttributeSchema = async (data) => {
  const attrSchema = await resolveCategoryAttributeSchema(data.category);
  if (!attrSchema) return null; // free-form accepted as-is
  const parsed = attrSchema.safeParse(data.attributes ?? {});
  if (!parsed.success) {
    // Re-path errors under "attributes.X" so the response carries the
    // full client-readable JSONPath.
    const issues = parsed.error.issues.map((iss) => ({
      ...iss,
      path: ["attributes", ...(iss.path || [])],
    }));
    return new z.ZodError(issues);
  }
  data.attributes = parsed.data;
  return null;
};

/**
 * Validate a CREATE payload. Async because it reads the category's
 * dynamic schema from MongoDB. Returns:
 *   { success: true,  data: ParsedProduct }
 *   { success: false, error: ZodError      }
 */
export const validateProductCreate = async (input) => {
  const base = baseProductSchema.safeParse(input);
  if (!base.success) return { success: false, error: base.error };

  const attrError = await applyDynamicAttributeSchema(base.data);
  if (attrError) return { success: false, error: attrError };

  return { success: true, data: base.data };
};

/**
 * Validate a partial UPDATE. Every base field becomes optional, but if
 * `attributes` is touched we cross-validate against either the
 * explicit `category` in the body OR the supplied `fallbackCategory`
 * (the existing product's category — the controller passes it in).
 */
export const validateProductUpdate = async (input, fallbackCategory) => {
  const base = baseProductSchema.partial().safeParse(input);
  if (!base.success) return { success: false, error: base.error };
  const data = base.data;

  if (data.attributes !== undefined) {
    const category = data.category ?? fallbackCategory;
    if (!category) {
      const err = new z.ZodError([{
        code: "custom",
        path: ["attributes"],
        message: "attributes-ийг шинэчлэхэд category шаардлагатай",
      }]);
      return { success: false, error: err };
    }
    // Make resolveCategoryAttributeSchema see the right category.
    data.category = category;
    const attrError = await applyDynamicAttributeSchema(data);
    if (attrError) return { success: false, error: attrError };
    // If caller didn't actually want to change the category, drop the
    // synthesised value so we don't write it.
    if (input.category === undefined) delete data.category;
  }

  return { success: true, data };
};

// ────────────────────────────────────────────────────────────────────
// Back-compat exports — older callers import these directly. We
// preserve them as thin wrappers around the new async validators so
// the migration is silent.
// ────────────────────────────────────────────────────────────────────

/**
 * @deprecated Use validateProductCreate(input) — this sync path can't
 * resolve admin-managed dynamic schemas and only honours the legacy
 * STATIC_CATEGORY_SCHEMAS. Left in place for tests and a graceful
 * upgrade window.
 */
export const productCreateSchema = baseProductSchema.superRefine((data, ctx) => {
  const schema = STATIC_CATEGORY_SCHEMAS[data.category];
  if (!schema) return;
  const r = schema.safeParse(data.attributes ?? {});
  if (!r.success) {
    for (const issue of r.error.issues) {
      ctx.addIssue({ ...issue, path: ["attributes", ...(issue.path || [])] });
    }
    return;
  }
  data.attributes = r.data;
});

/** @deprecated Use validateProductUpdate(input, fallbackCategory). */
export const productUpdateSchema = baseProductSchema
  .partial()
  .superRefine((data, ctx) => {
    if (data.category && data.attributes !== undefined) {
      const schema = STATIC_CATEGORY_SCHEMAS[data.category];
      if (!schema) return;
      const r = schema.safeParse(data.attributes ?? {});
      if (!r.success) {
        for (const issue of r.error.issues) {
          ctx.addIssue({ ...issue, path: ["attributes", ...(issue.path || [])] });
        }
        return;
      }
      data.attributes = r.data;
    }
  });

/** Flat error mapper — turns a ZodError into [{path, message, code}]. */
export const flattenZodErrors = (zodError) =>
  zodError.issues.map((i) => ({
    path: Array.isArray(i.path) ? i.path.join(".") : String(i.path || ""),
    message: i.message,
    code: i.code,
  }));
