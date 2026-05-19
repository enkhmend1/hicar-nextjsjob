import express from "express";
import { listProxies, probe } from "../Controller/proxy.controller.js";
import { protect, adminOnly } from "../Middleware/auth.middleware.js";

const router = express.Router();
router.use(protect, adminOnly);

router.get("/", listProxies);
router.post("/probe", probe);

export default router;
