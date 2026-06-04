/**
 * Search route — mounted at /api/v1/search.
 */

import { Router } from "express";
import { getSearch } from "./search.controller.js";

export const searchRouter = Router();
searchRouter.get("/", getSearch);
