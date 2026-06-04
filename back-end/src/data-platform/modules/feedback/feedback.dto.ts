/**
 * Feedback DTOs. As with ingestion, `correctedBy` is accepted in the body for
 * the standalone M3 process; in production it comes from the authenticated
 * admin/seller session.
 */

import { z } from "zod";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "ObjectId буруу");

export const correctionDto = z.object({
  normalizedProductId: objectId,
  field: z.enum(["canonicalBrand", "canonicalModel", "generation", "partType", "oem"]),
  newValue: z.string().trim().min(1, "newValue шаардлагатай").max(200),
  rawToken: z.string().trim().min(1).max(100).optional(),
  correctedBy: objectId,
  role: z.enum(["admin", "seller"]).default("admin"),
});

export type CorrectionInput = z.infer<typeof correctionDto>;
