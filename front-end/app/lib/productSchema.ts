/**
 * Product input schema — mirror of `back-end/Service/productSchema.service.js`.
 *
 * Why a TypeScript copy instead of importing the JS file directly?
 * The backend lives in a separate package (`back-end/`) that's not part
 * of the Next.js bundle. Cross-package imports require a monorepo setup
 * (turborepo / pnpm workspaces) — until then, this file is the
 * client-side source of truth.
 *
 * KEEPING THESE IN SYNC:
 *   When you add/remove/change fields here, update the backend file too.
 *   Both files use identical Zod expressions so a smoke test confirming
 *   "parsing the same input yields the same result" is the canonical
 *   contract check.
 */

import { z } from "zod";

const VIN_YEAR_MIN = 1950;
const VIN_YEAR_MAX = 2100;

const trimmed = (max: number) => z.string().trim().min(1).max(max);

const oemField = z
  .string()
  .trim()
  .max(40)
  .regex(/^[A-Za-z0-9._\-/ ]*$/, "OEM код буруу форматтай байна")
  .default("");

// ── Fitment ──────────────────────────────────────────────────────────
export const fitmentSchema = z
  .object({
    make: trimmed(60),
    model: trimmed(60),
    generation: z.string().trim().max(40).optional().default(""),
    yearStart: z.coerce.number().int().min(VIN_YEAR_MIN).max(VIN_YEAR_MAX).optional(),
    yearEnd: z.coerce.number().int().min(VIN_YEAR_MIN).max(VIN_YEAR_MAX).optional(),
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
export type Fitment = z.infer<typeof fitmentSchema>;

// ── Per-category attribute schemas ───────────────────────────────────
export const bodyAttributesSchema = z.object({
  side: z.enum(["left", "right", "front", "rear", "top", "bottom", "n/a"]),
  color: z.string().trim().max(40).optional().default(""),
  material: z.enum([
    "plastic", "steel", "aluminum", "fiberglass", "carbon", "rubber", "glass", "other",
  ]).default("other"),
  finish: z.enum(["painted", "primed", "bare", "polished"]).optional(),
});
export type BodyAttributes = z.infer<typeof bodyAttributesSchema>;

export const oilsAttributesSchema = z.object({
  viscosity: z
    .string()
    .trim()
    .regex(/^\d{1,2}W-?\d{2,3}$/i, "Зуурамтгайн зэрэг (жнь 5W-30) форматаар бичнэ үү"),
  volume: z.coerce.number().min(0.1).max(200),
  oilType: z.enum(["synthetic", "semi-synthetic", "mineral", "racing"]),
  api: z.string().trim().max(20).optional().default(""),
  acea: z.string().trim().max(20).optional().default(""),
});
export type OilsAttributes = z.infer<typeof oilsAttributesSchema>;

export const brakeAttributesSchema = z.object({
  partType: z.enum(["pad", "disc", "drum", "shoe", "caliper", "fluid", "hose"]),
  frictionGrade: z.enum(["organic", "ceramic", "semi-metallic", "low-metallic"]).optional(),
  axle: z.enum(["front", "rear", "n/a"]).default("n/a"),
});
export type BrakeAttributes = z.infer<typeof brakeAttributesSchema>;

export const engineAttributesSchema = z.object({
  componentType: z.enum([
    "piston", "valve", "gasket", "filter", "belt", "spark-plug", "injector", "pump", "other",
  ]),
  engineSpec: z.string().trim().max(80).optional().default(""),
});
export type EngineAttributes = z.infer<typeof engineAttributesSchema>;

export const electricAttributesSchema = z.object({
  componentType: z.enum(["battery", "alternator", "starter", "sensor", "wiring", "fuse", "relay", "ecu"]),
  voltage: z.enum(["12", "24"]).default("12"),
  capacityAh: z.coerce.number().min(1).max(2000).optional(),
});
export type ElectricAttributes = z.infer<typeof electricAttributesSchema>;

// ── Category registry ───────────────────────────────────────────────
export const CATEGORY_ATTRIBUTE_SCHEMAS = {
  body: bodyAttributesSchema,
  oils: oilsAttributesSchema,
  brake: brakeAttributesSchema,
  engine: engineAttributesSchema,
  electric: electricAttributesSchema,
} as const;
export type KnownCategory = keyof typeof CATEGORY_ATTRIBUTE_SCHEMAS;
export const KNOWN_CATEGORIES = Object.keys(CATEGORY_ATTRIBUTE_SCHEMAS) as KnownCategory[];

/** Human-readable labels for the category picker. */
export const CATEGORY_LABELS: Record<KnownCategory | "other", string> = {
  body:     "Их бие (Body)",
  oils:     "Тос & Тосологоо",
  brake:    "Тоормосны систем",
  engine:   "Хөдөлгүүр",
  electric: "Цахилгаан",
  other:    "Бусад",
};

// ── Base + composed schemas ─────────────────────────────────────────
export const baseProductSchema = z.object({
  name: trimmed(200),
  brand: trimmed(60),
  oem: oemField,
  category: z.string().trim().toLowerCase().min(1).max(60),
  source: z.string().trim().max(60).optional().default("local"),

  price: z.coerce.number().int().min(0).max(1_000_000_000),
  originalPrice: z.coerce.number().int().min(0).max(1_000_000_000).optional(),
  stockQty: z.coerce.number().int().min(0).max(1_000_000).default(100),
  lowStockThreshold: z.coerce.number().int().min(-1).max(10_000).optional(),

  description: z.string().max(4000).optional().default(""),
  badge: z.string().trim().max(40).optional().default(""),
  tags: z.array(z.string().trim().toLowerCase().min(1).max(40)).max(20).default([]),

  images: z.array(z.string().url().max(500)).max(10).default([]),
  iconPath: z.string().max(500).optional().default(""),

  fitments: z.array(fitmentSchema).max(50).default([]),
  attributes: z.record(z.string(), z.unknown()).optional().default({}),
});

const applyAttributeSchema = (
  data: { category?: string; attributes?: Record<string, unknown> },
  ctx: z.RefinementCtx,
) => {
  const schema = (CATEGORY_ATTRIBUTE_SCHEMAS as Record<string, z.ZodTypeAny>)[
    data.category as KnownCategory
  ];
  if (!schema) return;
  const result = schema.safeParse(data.attributes ?? {});
  if (!result.success) {
    for (const issue of result.error.issues) {
      ctx.addIssue({
        ...issue,
        path: ["attributes", ...((issue.path as (string | number)[]) || [])],
      });
    }
    return;
  }
  // `result.data` is the category-specific output; we widen it back to
  // Record<string, unknown> for storage compatibility. The runtime shape
  // is still correct — only the static type is relaxed.
  data.attributes = result.data as Record<string, unknown>;
};

export const productCreateSchema = baseProductSchema.superRefine(applyAttributeSchema);
export type ProductCreateInput = z.infer<typeof productCreateSchema>;

// ── Per-step partial schemas (used by the multi-step form to gate
// "Next" without fully validating the whole document yet).
// ────────────────────────────────────────────────────────────────────
export const step1BasicsSchema = z.object({
  name: trimmed(200),
  brand: trimmed(60),
  oem: oemField,
  category: z.string().trim().toLowerCase().min(1).max(60),
});

export const step2FitmentSchema = z
  .object({
    category: z.string().trim().toLowerCase().min(1).max(60),
    fitments: z.array(fitmentSchema).max(50).default([]),
    attributes: z.record(z.string(), z.unknown()).optional().default({}),
  })
  .superRefine(applyAttributeSchema);

export const step3PricingSchema = z.object({
  price: z.coerce.number().int().min(0).max(1_000_000_000),
  originalPrice: z.coerce.number().int().min(0).max(1_000_000_000).optional(),
  stockQty: z.coerce.number().int().min(0).max(1_000_000),
  images: z.array(z.string().url().max(500)).max(10).default([]),
  description: z.string().max(4000).optional().default(""),
});
