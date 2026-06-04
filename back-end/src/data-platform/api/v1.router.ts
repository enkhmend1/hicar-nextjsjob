/**
 * /api/v1 aggregate router for the data platform.
 *   /ingest      → manual + bulk product intake (LAYER 1)
 *   /raw         → inspect raw products
 *   /normalized  → inspect interpretations (LAYER 2)
 *   /review      → confidence-ranked review queue (M3)
 *   /feedback    → apply corrections / read correction log (M3)
 *   /changelog   → hash-chained version history (M3)
 */

import { Router } from "express";
import {
  ingestionRouter,
  rawRouter,
  normalizedRouter,
} from "../modules/ingestion/ingestion.routes.js";
import {
  reviewRouter,
  feedbackRouter,
  changelogRouter,
} from "../modules/feedback/feedback.routes.js";
import { searchRouter } from "../modules/search/search.routes.js";
import { statsRouter } from "../modules/stats/stats.routes.js";
import { imagesRouter } from "../modules/images/images.routes.js";

export const v1Router = Router();

v1Router.use("/ingest", ingestionRouter);
v1Router.use("/raw", rawRouter);
v1Router.use("/normalized", normalizedRouter);
v1Router.use("/review", reviewRouter);
v1Router.use("/feedback", feedbackRouter);
v1Router.use("/changelog", changelogRouter);
v1Router.use("/search", searchRouter);
v1Router.use("/stats", statsRouter);
v1Router.use("/images", imagesRouter);
