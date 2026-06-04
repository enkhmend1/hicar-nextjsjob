/**
 * Ingestion DTOs. Deliberately PERMISSIVE — dirty data is the use case. We
 * accept almost anything (most fields optional, price as string-or-number)
 * and let the normalization pipeline make sense of it. Hard rejects only for
 * a missing seller or an entirely empty title.
 *
 * NOTE: in production `sellerId` should come from the authenticated session
 * (the legacy backend's JWT), not the request body. It is accepted in the body
 * here so the data-platform process can run standalone in M1.
 */

import { z } from "zod";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "sellerId буруу (ObjectId биш)");

export const manualProductDto = z.object({
  sellerId: objectId,
  rawTitle: z.string().trim().min(1, "rawTitle шаардлагатай").max(2000),
  rawDescription: z.string().max(20000).optional(),
  rawBrand: z.string().max(500).optional(),
  rawCategory: z.string().max(500).optional(),
  rawPrice: z.union([z.string().max(100), z.number()]).optional(),
  rawOem: z.string().max(200).optional(),
  rawAttributes: z.record(z.string(), z.string()).optional(),
  images: z.array(z.string().url()).max(20).optional(),
  price: z.number().nonnegative().optional(),
  stockQty: z.number().int().nonnegative().optional(),
});

export type ManualProductInput = z.infer<typeof manualProductDto>;
