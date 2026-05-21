import express from "express";
import { listAudit, getAuditRow, verifyAudit } from "../Controller/audit.controller.js";
import { protect, adminOnly } from "../Middleware/auth.middleware.js";

const router = express.Router();

// Admin-only — financial audit log access is highly sensitive.
router.use(protect, adminOnly);

router.get("/",       listAudit);
router.get("/verify", verifyAudit);
router.get("/:id",    getAuditRow);

export default router;
