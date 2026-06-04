/**
 * Feedback routes — the human-in-the-loop surface.
 *   /review/queue           confidence-ranked items awaiting review
 *   /feedback/corrections   apply a correction / read a product's correction log
 *   /changelog/:entity/:id  hash-chained version history
 */

import { Router } from "express";
import {
  getReviewQueue,
  postCorrection,
  getCorrections,
  getChangeLog,
} from "./feedback.controller.js";

export const reviewRouter = Router();
reviewRouter.get("/queue", getReviewQueue);

export const feedbackRouter = Router();
feedbackRouter.post("/corrections", postCorrection);
feedbackRouter.get("/corrections/:normalizedProductId", getCorrections);

export const changelogRouter = Router();
changelogRouter.get("/:entity/:entityId", getChangeLog);
