import express from "express";
import {
  listLogs, zeroResultSummary,
  listMappings, createMapping, updateMapping, deleteMapping, createMappingFromQuery,
} from "../Controller/training.controller.js";
import { protect, adminOnly } from "../Middleware/auth.middleware.js";

const router = express.Router();
router.use(protect, adminOnly);

// Search logs
router.get("/logs", listLogs);
router.get("/zero-results", zeroResultSummary);

// OEM mappings
router.get("/mappings", listMappings);
router.post("/mappings", createMapping);
router.post("/mappings/from-query", createMappingFromQuery);
router.put("/mappings/:id", updateMapping);
router.delete("/mappings/:id", deleteMapping);

export default router;
