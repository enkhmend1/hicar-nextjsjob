import express from "express";
import { createOrderInvoice, checkOrderPayment, callback } from "../Controller/qpay.controller.js";
import { protect } from "../Middleware/auth.middleware.js";

const router = express.Router();

// User-facing
router.post("/invoice", protect, createOrderInvoice);
router.get("/check/:orderId", protect, checkOrderPayment);

// Public callback from QPay (NO auth — verify by re-checking with QPay)
router.post("/callback", callback);
router.get("/callback", callback); // some integrations send GET

export default router;
