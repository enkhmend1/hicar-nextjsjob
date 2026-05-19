/**
 * Dispute controller — thin transport layer.
 *
 * Every meaningful state change goes through dispute.service. This file
 * only deals with HTTP plumbing: parsing params, mapping errors to status
 * codes, and choosing which list to return based on the caller's role.
 */

import Dispute from "../Model/dispute.model.js";
import * as DisputeService from "../Service/dispute.service.js";

const wrap = (handler) => async (req, res) => {
  try {
    await handler(req, res);
  } catch (err) {
    const status = err.status || 400;
    return res.status(status).json({ message: err.message });
  }
};

/* ────────── Listing ────────── */

/** Buyer: list my disputes. */
export const myDisputes = wrap(async (req, res) => {
  const disputes = await Dispute.find({ buyer: req.user._id })
    .populate("order", "total status paymentStatus")
    .populate("seller", "name sellerProfile.shopName")
    .sort({ createdAt: -1 });
  res.json({ disputes });
});

/** Seller: list disputes filed against me. */
export const sellerDisputes = wrap(async (req, res) => {
  const { status } = req.query;
  const filter = { seller: req.user._id };
  if (status && status !== "all") filter.status = status;
  const disputes = await Dispute.find(filter)
    .populate("order", "total status paymentStatus")
    .populate("buyer", "name email")
    .sort({ createdAt: -1 });
  res.json({ disputes });
});

/** Admin: all disputes with optional status filter. */
export const allDisputes = wrap(async (req, res) => {
  const { status } = req.query;
  const filter = {};
  if (status && status !== "all") filter.status = status;
  const disputes = await Dispute.find(filter)
    .populate("order", "total status paymentStatus escrowAmount refundedAmount")
    .populate("buyer", "name email")
    .populate("seller", "name email sellerProfile.shopName")
    .sort({ createdAt: -1 });
  res.json({ disputes });
});

/** Single dispute (any party who's involved + admin). */
export const getDispute = wrap(async (req, res) => {
  const dispute = await Dispute.findById(req.params.id)
    .populate("order")
    .populate("buyer", "name email")
    .populate("seller", "name email sellerProfile.shopName");
  if (!dispute) return res.status(404).json({ message: "Маргаан олдсонгүй" });

  const me = String(req.user._id);
  const isAdmin = req.user.role === "admin";
  const involved = me === String(dispute.buyer._id) || me === String(dispute.seller._id);
  if (!isAdmin && !involved) return res.status(403).json({ message: "Эрхгүй" });

  res.json({ dispute });
});

/* ────────── Mutations ────────── */

/** Buyer creates a dispute. Body: { orderId, reason, description, requestedRefundAmount, itemProductIds?, evidenceImages? } */
export const create = wrap(async (req, res) => {
  const { orderId, ...payload } = req.body;
  const dispute = await DisputeService.createDispute(req.user._id, orderId, payload);
  res.status(201).json({ dispute });
});

/** Seller submits their response. Body: { action, offeredAmount?, message? } */
export const sellerRespond = wrap(async (req, res) => {
  const dispute = await DisputeService.submitSellerResponse(
    req.params.id, req.user._id, req.body,
  );
  res.json({ dispute });
});

/** Buyer accepts the seller's offer. */
export const buyerAccept = wrap(async (req, res) => {
  const dispute = await DisputeService.buyerAcceptOffer(req.params.id, req.user._id);
  res.json({ dispute });
});

/** Buyer rejects the seller's offer (escalates). */
export const buyerReject = wrap(async (req, res) => {
  const dispute = await DisputeService.buyerRejectOffer(
    req.params.id, req.user._id, req.body?.message,
  );
  res.json({ dispute });
});

/** Buyer withdraws an open dispute. */
export const withdraw = wrap(async (req, res) => {
  const dispute = await DisputeService.withdrawDispute(req.params.id, req.user._id);
  res.json({ dispute });
});

/** Append a message to the dispute thread. */
export const postMessage = wrap(async (req, res) => {
  const dispute = await Dispute.findById(req.params.id).select("buyer seller status");
  if (!dispute) return res.status(404).json({ message: "Маргаан олдсонгүй" });

  const me = String(req.user._id);
  let author;
  if (req.user.role === "admin") author = "admin";
  else if (String(dispute.buyer) === me) author = "buyer";
  else if (String(dispute.seller) === me) author = "seller";
  else return res.status(403).json({ message: "Эрхгүй" });

  const updated = await DisputeService.addMessage(req.params.id, {
    author,
    authorId: req.user._id,
    text: req.body.text,
    images: req.body.images,
  });
  res.json({ dispute: updated });
});

/** Admin final resolution. Body: { action, amount?, notes? } */
export const adminResolve = wrap(async (req, res) => {
  const dispute = await DisputeService.adminResolve(
    req.params.id, req.user._id, req.body,
  );
  res.json({ dispute });
});
