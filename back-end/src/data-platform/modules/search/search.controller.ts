/**
 * Search HTTP handler. GET /api/v1/search?q=…&brand=…&inStock=…&page=…
 */

import type { Request, Response, NextFunction } from "express";
import { search } from "./search.service.js";
import { ValidationError } from "../../shared/errors.js";

export async function getSearch(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const q = String(req.query.q ?? "").trim();
    if (!q) throw new ValidationError("q (хайлтын үг) шаардлагатай");

    const result = await search({
      q,
      brand: req.query.brand ? String(req.query.brand) : undefined,
      generation: req.query.generation ? String(req.query.generation) : undefined,
      inStock: req.query.inStock === "true",
      priceMin: req.query.priceMin ? Number(req.query.priceMin) : undefined,
      priceMax: req.query.priceMax ? Number(req.query.priceMax) : undefined,
      page: req.query.page ? Number(req.query.page) : undefined,
      perPage: req.query.perPage ? Number(req.query.perPage) : undefined,
    });

    res.json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
}
