/**
 * User garage controller — CRUD over the current user's saved vehicles.
 *
 * Each operation is scoped by req.user._id; admins use the same routes
 * as regular users (they only see their own garage). Admin moderation
 * over other users' garages is out of scope.
 */

import Garage from "../Model/garage.model.js";

export const listGarage = async (req, res) => {
  const vehicles = await Garage.find({ user: req.user._id })
    .sort({ isDefault: -1, createdAt: -1 })
    .lean();
  return res.json({ vehicles });
};

export const createGarageEntry = async (req, res) => {
  try {
    const { plate, vin, make, model, year, engine, chassis, color, isDefault, vehicleRef } = req.body;
    if (!make || !model || !year) {
      return res.status(400).json({ message: "make/model/year заавал" });
    }
    if (isDefault) {
      await Garage.updateMany({ user: req.user._id }, { isDefault: false });
    }
    const v = await Garage.create({
      user: req.user._id,
      plate: plate || "", vin: vin || "",
      make, model, year,
      engine: engine || "", chassis: chassis || "", color: color || "",
      isDefault: !!isDefault,
      vehicleRef: vehicleRef || null,
    });
    return res.status(201).json({ vehicle: v });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: "Энэ улсын дугаартай машин аль хэдийн бүртгэлтэй байна" });
    }
    return res.status(400).json({ message: err.message });
  }
};

export const updateGarageEntry = async (req, res) => {
  try {
    const v = await Garage.findOne({ _id: req.params.id, user: req.user._id });
    if (!v) return res.status(404).json({ message: "Машин олдсонгүй" });
    if (req.body.isDefault) {
      await Garage.updateMany({ user: req.user._id, _id: { $ne: v._id } }, { isDefault: false });
    }
    Object.assign(v, req.body);
    await v.save();
    return res.json({ vehicle: v });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

export const deleteGarageEntry = async (req, res) => {
  const v = await Garage.findOneAndDelete({ _id: req.params.id, user: req.user._id });
  if (!v) return res.status(404).json({ message: "Машин олдсонгүй" });
  return res.json({ ok: true });
};
