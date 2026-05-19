import express from "express";
import { listMine, markRead, markAllRead, remove } from "../Controller/notification.controller.js";
import { protect } from "../Middleware/auth.middleware.js";

const router = express.Router();
router.use(protect);

router.get("/", listMine);
router.patch("/read-all", markAllRead);
router.patch("/:id/read", markRead);
router.delete("/:id", remove);

export default router;
