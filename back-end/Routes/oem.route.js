import express from "express";
import { lookup, expand, list, create, update, remove } from "../Controller/oemCross.controller.js";
import { protect, adminOnly } from "../Middleware/auth.middleware.js";

const router = express.Router();

// Read endpoints (no auth required — public catalogue data)
router.get("/cross/:oem", lookup);
router.post("/expand", expand);

// Admin CRUD
router.get("/cross",         protect, adminOnly, list);
router.post("/cross",        protect, adminOnly, create);
router.put("/cross/:id",     protect, adminOnly, update);
router.delete("/cross/:id",  protect, adminOnly, remove);

export default router;
