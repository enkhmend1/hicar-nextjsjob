import express from "express";
import {
  listGarage, createGarageEntry, updateGarageEntry, deleteGarageEntry,
} from "../Controller/garage.controller.js";
import { protect } from "../Middleware/auth.middleware.js";

const router = express.Router();
router.use(protect);

router.get("/", listGarage);
router.post("/", createGarageEntry);
router.put("/:id", updateGarageEntry);
router.delete("/:id", deleteGarageEntry);

export default router;
