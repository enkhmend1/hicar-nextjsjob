/**
 * GET /api/v1/stats — platform overview for the admin dashboard widget.
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { getPlatformStats } from "./stats.service.js";

export const statsRouter = Router();

statsRouter.get("/", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const stats = await getPlatformStats();
    res.json({ ok: true, stats });
  } catch (err) {
    next(err);
  }
});
