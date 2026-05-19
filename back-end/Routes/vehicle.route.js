import express from "express";
import {
  lookupByPlate, lookupJobStatus, getVehicle, compatibleParts,
} from "../Controller/vehicle.controller.js";
import { protect } from "../Middleware/auth.middleware.js";
import { ipLimit, userLimit } from "../Middleware/rateLimit.middleware.js";

const router = express.Router();

// Optional auth — anonymous lookups allowed, but logged-in users get
// generous personal quotas
const optionalProtect = (req, res, next) => {
  if (!req.headers.authorization) return next();
  return protect(req, res, next);
};

router.post("/lookup",
  optionalProtect,
  ipLimit(20, 60),      // 20 lookups / minute per IP
  userLimit(60, 60),    // 60 / minute per user
  lookupByPlate,
);

router.get("/lookup/job/:id", optionalProtect, lookupJobStatus);
router.get("/:id", optionalProtect, getVehicle);

router.post("/compatible",
  optionalProtect,
  ipLimit(30, 60),
  userLimit(120, 60),
  compatibleParts,
);

export default router;
