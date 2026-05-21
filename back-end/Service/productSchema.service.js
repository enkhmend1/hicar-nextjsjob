/**
 * Product input validation — single source of truth for both backend and
 * frontend. Uses Zod so the same definitions can be imported in the
 * Next.js form via a mirrored TypeScript file.
 *
 * Architecture:
 *   • `baseProductSchema` — the always-present fields (name, brand, oem,
 *     price, stock, images, category, description, tags, fitments).
 *   • `CATEGORY_ATTRIBUTE_SCHEMAS` — a registry mapping category strings
 *     to category-specific attribute Zod schemas (BODY → side/color/...,
 *     OILS → viscosity/volume/...).
 *   • `productCreateSchema` — composes the base + dynamic attributes via
 *     superRefine: known categories enforce their schema; unknown
 *     categories accept a free record (so sellers aren't blocked from
 *     introducing new categories before we've designed their schema).
 *   • `productUpdateSchema` — partial variant: all fields optional, but
 *     attributes still validated against the (final) category.
 *
 * The Mongoose model stores `attributes` as Mixed — this validator is
 * the ONLY layer enforcing per-category shape. Always run it BEFORE
 * persisting.
 */

import { z } from "zod";

// ────────────────────────────────────────────────────────────────────
// Common building blocks
// ────────────────────────────────────────────────────────────────────

/** Trim + clamp; refuses empty strings (use .optional() if you allow blank). */
const trimmed = (max) => z.string().trim().min(1).max(max);

/** OEM accepts a strict alnum/punctuation pattern. Optional + empty allowed. */
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

export const fitmentSchema = z.object({
  make:       trimmed(60),
  model:      trimmed(60),
  generation: z.string().trim().max(40).optional().default(""),
  yearStart:  z.coerce.number().int().min(VIN_YEAR_MIN).max(VIN_YEAR_MAX).optional(),
  yearEnd:    z.coerce.number().int().min(VIN_YEAR_MIN).max(VIN_YEAR_MAX).optional(),
}).superRefine((row, ctx) => {
  // Inclusive year window must be coherent. Both ends optional, but if
  // both are provided, start ≤ end is enforced.
  if (row.yearStart != null && row.yearEnd != null && row.yearStart > row.yearEnd) {
    ctx.addIssue({
      code: "custom",
      message: "yearStart нь yearEnd-аас илүү байж болохгүй",
      path: ["yearEnd"],
    });
  }
});

// ────────────────────────────────────────────────────────────────────
// Per-category attribute schemas
//
// Each schema is INDEPENDENTLY parseable so the frontend can mount the
// right form widget without conditional union gymnastics. Optional
// fields use .optional() (not .default()) so the UI distinguishes
// "user typed empty" from "field never asked for".
// ────────────────────────────────────────────────────────────────────

export const bodyAttributesSchema = z.object({
  /** Position relative to the vehicle. "n/a" for symmetric parts. */
  side: z.enum(["left", "right", "front", "rear", "top", "bottom", "n/a"]),
  /** Free-text colour name (OEM colour codes too). */
  color: z.string().trim().max(40).optional().default(""),
  /** Catalogue material category — keeps facets clean. */
  material: z.enum([
    "plastic", "steel", "aluminum", "fiberglass", "carbon", "rubber", "glass", "other",
  ]).default("other"),
  /** Painted / primed / bare metal. */
  finish: z.enum(["painted", "primed", "bare", "polished"]).optional(),
});

export const oilsAttributesSchema = z.object({
  /**
   * SAE viscosity grade. Accepts "5W-30", "5W30", "0W20", "10W-40".
   * Captured into a normalised form by `viscosityNormalised` below.
   */
  viscosity: z.string()
    .trim()
    .regex(/^\d{1,2}W\-?\d{2,3}$/i, "Зуурамтгайн зэрэг (жнь 5W-30) форматаар бичнэ үү"),
  /** Bottle volume in LITRES. 0.1L (sample) … 200L (drum). */
  volume: z.coerce.number().min(0.1).max(200),
  /** Base-oil chemistry. */
  oilType: z.enum(["synthetic", "semi-synthetic", "mineral", "racing"]),
  /** Optional API service class — "SN", "SP", "CK-4", etc. */
  api: z.string().trim().max(20).optional().default(""),
  /** Optional ACEA class. */
  acea: z.string().trim().max(20).optional().default(""),
});

export const brakeAttributesSchema = z.object({
  /** Pad / disc / fluid sub-type. */
  partType: z.enum(["pad", "disc", "drum", "shoe", "caliper", "fluid", "hose"]),
  /** Friction material (only meaningful for pad/shoe). */
  frictionGrade: z.enum(["organic", "ceramic", "semi-metallic", "low-metallic"]).optional(),
  /** Axle position. */
  axle: z.enum(["front", "rear", "n/a"]).default("n/a"),
});

export const engineAttributesSchema = z.object({
  /** Engine sub-component category. */
  componentType: z.enum([
    "piston", "valve", "gasket", "filter", "belt", "spark-plug", "injector", "pump", "other",
  ]),
  /** Free-form engine size compatibility note (e.g. "1.8L 2ZR-FE"). */
  engineSpec: z.string().trim().max(80).optional().default(""),
});

export const electricAttributesSchema = z.object({
  /** Electrical sub-type. */
  componentType: z.enum(["battery", "alternator", "starter", "sensor", "wiring", "fuse", "relay", "ecu"]),
  /** Voltage spec — 12 (car) or 24 (commercial). */
  voltage: z.enum(["12", "24"]).default("12"),
  /** Battery capacity in Ah, if applicable. */
  capacityAh: z.coerce.number().min(1).max(2000).optional(),
});

// ────────────────────────────────────────────────────────────────────
// Category registry — drives both validation AND the dynamic frontend
// form. Adding a new category to this map IS the change required to
// surface it in the seller UI.
// ────────────────────────────────────────────────────────────────────

export const CATEGORY_ATTRIBUTE_SCHEMAS = Object.freeze({
  body:       bodyAttributesSchema,
  oils:       oilsAttributesSchema,
  brake:      brakeAttributesSchema,
  engine:     engineAttributesSchema,
  electric:   electricAttributesSchema,
  // Unknown categories fall through to z.record(z.unknown()) — they
  // still get stored but no attribute-shape enforcement happens.
});

export const KNOWN_CATEGORIES = Object.freeze(Object.keys(CATEGORY_ATTRIBUTE_SCHEMAS));

// ────────────────────────────────────────────────────────────────────
// Base product schema — fields common to every category
// ────────────────────────────────────────────────────────────────────

const baseProductSchema = z.object({
  name:          trimmed(200),
  brand:         trimmed(60),
  oem:           oemField,
  category:      z.string().trim().toLowerCase().min(1).max(60),
  source:        z.string().trim().max(60).optional().default("local"),

  price:         z.coerce.number().int().min(0).max(1_000_000_000),
  originalPrice: z.coerce.number().int().min(0).max(1_000_000_000).optional(),
  stockQty:      z.coerce.number().int().min(0).max(1_000_000).default(100),
  lowStockThreshold: z.coerce.number().int().min(-1).max(10_000).optional(),

  description:   z.string().max(4000).optional().default(""),
  badge:         z.string().trim().max(40).optional().default(""),
  tags:          z.array(z.string().trim().toLowerCase().min(1).max(40)).max(20).default([]),

  images:        z.array(z.string().url().max(500)).max(10).default([]),
  iconPath:      z.string().max(500).optional().default(""),

  fitments:      z.array(fitmentSchema).max(50).default([]),

  // Attributes start as an unrestricted record; superRefine below
  // tightens it per category.
  attributes:    z.record(z.string(), z.unknown()).optional().default({}),

  deliveryDays:  z.object({
    fast:   z.coerce.number().int().min(0).max(365).default(7),
    normal: z.coerce.number().int().min(0).max(365).default(14),
    cheap:  z.coerce.number().int().min(0).max(365).default(21),
  }).optional(),
});

/**
 * Apply the per-category attribute schema. If the category has a
 * registered schema, attributes MUST validate against it (missing
 * requireds fail, extras allowed by default but flagged by callers).
 * If the category is unknown, attributes are accepted as-is.
 */
const applyAttributeSchema = (data, ctx) => {
  const schema = CATEGORY_ATTRIBUTE_SCHEMAS[data.category];
  if (!schema) return;
  const result = schema.safeParse(data.attributes ?? {});
  if (!result.success) {
    for (const issue of result.error.issues) {
      ctx.addIssue({
        ...issue,
        path: ["attributes", ...(issue.path || [])],
      });
    }
    return;
  }
  // Replace with the validated (default-applied) attributes so the
  // downstream Mongoose write stores the canonical shape.
  data.attributes = result.data;
};

// ────────────────────────────────────────────────────────────────────
// Final exported schemas
// ────────────────────────────────────────────────────────────────────

export const productCreateSchema = baseProductSchema.superRefine(applyAttributeSchema);

/**
 * Partial-update flavour. Every base field becomes optional, but if
 * `category` AND `attributes` are BOTH present we still cross-validate
 * them. If category is omitted but attributes are present, the caller
 * is expected to have loaded the existing product and pre-merged the
 * category — we can't validate attributes in a vacuum.
 */
export const productUpdateSchema = baseProductSchema
  .partial()
  .superRefine((data, ctx) => {
    if (data.category && data.attributes !== undefined) {
      applyAttributeSchema(data, ctx);
    }
  });

/**
 * Flat error mapper — turns a ZodError into an array of
 * { path, message } objects suitable for direct JSON response.
 */
export const flattenZodErrors = (zodError) =>
  zodError.issues.map((i) => ({
    path: Array.isArray(i.path) ? i.path.join(".") : String(i.path || ""),
    message: i.message,
    code: i.code,
  }));
