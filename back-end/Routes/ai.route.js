import express from "express";
import { chat } from "../Controller/ai.controller.js";
import { protect } from "../Middleware/auth.middleware.js";

const router = express.Router();

// Optional auth: if token provided, req.user is set. Anonymous chat allowed for product search.
const optionalProtect = (req, res, next) => {
  if (!req.headers.authorization) return next();
  return protect(req, res, next);
};

router.post("/chat", optionalProtect, chat);

export default router;
