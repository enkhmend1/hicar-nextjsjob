/**
 * Vehicle controller — public-facing gateway for plate lookups and
 * compatibility queries. Garage.mn upstream is intentionally hidden;
 * frontend only ever calls /api/vehicle/*.
 */

import Vehicle from "../Model/vehicle.model.js";
import { fetchByPlate, normalizePlate, isPlateValid } from "../Service/garage.service.js";
import { normalizeAndPersist } from "../Service/vehicleNormalizer.service.js";
import { findCompatibleParts } from "../Service/compatibility.service.js";
import { enqueue, getJob, queueEnabled } from "../Service/jobQueue.service.js";
import { VEHICLE_LOOKUP_QUEUE } from "../Queue/vehicleLookup.queue.js";

const errorCodeToStatus = {
  PLATE_INVALID: 400,
  NOT_FOUND:     404,
  TIMEOUT:       504,
  RATE_LIMITED:  429,
  UPSTREAM_5XX:  502,
  CIRCUIT_OPEN:  503,
  UPSTREAM_ERROR: 502,
};

const publicVehicle = (v) => ({
  id:           String(v._id),
  plate:        v.plate,
  manufacturer: v.snapshot?.manuname,
  model:        v.snapshot?.modelname,
  generation:   v.snapshot?.generation,
  engineCode:   v.snapshot?.motorcode,
  engineType:   v.snapshot?.motortype,
  carname:      v.snapshot?.carname,
  displacement: v.snapshot?.displacement,
  lookedUpAt:   v.lookedUpAt,
});

/**
 * POST /api/vehicle/lookup
 * Body: { plate, fresh?, async? }
 *
 * Sync path (default): cache → normalise → return vehicle.
 * Async path (?async=1): enqueue + return job id, frontend polls.
 */
export const lookupByPlate = async (req, res) => {
  const { plate, fresh = false, async: asAsync = false } = req.body || {};
  if (!plate) return res.status(400).json({ message: "plate шаардлагатай" });
  if (!isPlateValid(plate)) return res.status(400).json({ message: "Улсын дугаарын формат буруу" });

  const normalised = normalizePlate(plate);

  // Async path: useful when caller wants to fire-and-forget (mobile, bulk import)
  if (asAsync && queueEnabled) {
    const job = await enqueue(VEHICLE_LOOKUP_QUEUE, {
      plate: normalised, userId: req.user?._id || null, fresh,
    });
    return res.status(202).json({ jobId: job.id, status: job.status });
  }

  try {
    // Fast path: hit DB cache directly if we already normalised this plate recently and the
    // caller didn't ask for fresh data.
    if (!fresh) {
      const cached = await Vehicle.findOne({ plate: normalised, expiresAt: { $gt: new Date() } });
      if (cached) {
        return res.json({ vehicle: publicVehicle(cached), source: "db-cache" });
      }
    }

    const lookup = await fetchByPlate(normalised, { fresh });
    const { vehicle } = await normalizeAndPersist(lookup, { userId: req.user?._id || null });
    // proxyUsed is included for admins only (cred-redacted, null on direct/cache hit)
    return res.json({
      vehicle: publicVehicle(vehicle),
      source: lookup.source,                      // adapter name (was hit string before)
      cache:  lookup.hit,                         // "cache" | "network"
      ...(req.user?.role === "admin" ? { proxyUsed: lookup.proxyUsed ?? null } : {}),
    });
  } catch (err) {
    const code = err.code || "UPSTREAM_ERROR";
    const status = errorCodeToStatus[code] ?? 500;
    return res.status(status).json({ message: err.message || "Vehicle lookup failed", code });
  }
};

/**
 * GET /api/vehicle/lookup/job/:id
 * Returns the BullMQ job status. Useful for the async path above.
 */
export const lookupJobStatus = async (req, res) => {
  const job = await getJob(VEHICLE_LOOKUP_QUEUE, req.params.id);
  if (!job) return res.status(404).json({ message: "Job олдсонгүй" });
  return res.json(job);
};

/**
 * GET /api/vehicle/:id
 * Returns a normalised vehicle by Mongo id.
 */
export const getVehicle = async (req, res) => {
  const v = await Vehicle.findById(req.params.id);
  if (!v) return res.status(404).json({ message: "Машин олдсонгүй" });
  return res.json({ vehicle: publicVehicle(v) });
};

/**
 * POST /api/vehicle/compatible
 * Body: { plate?, vehicleId?, category?, limit?, seedOems? }
 *
 * Either `plate` or `vehicleId` must be supplied. Returns the ranked list
 * of compatible products with per-product `_matchScore` + `_matchReason`.
 */
export const compatibleParts = async (req, res) => {
  try {
    const { plate, vehicleId, category, limit, seedOems } = req.body || {};
    let vehicle = null;

    if (vehicleId) {
      vehicle = await Vehicle.findById(vehicleId);
    } else if (plate) {
      if (!isPlateValid(plate)) return res.status(400).json({ message: "plate буруу формат" });
      const normalised = normalizePlate(plate);
      vehicle = await Vehicle.findOne({ plate: normalised });
      if (!vehicle) {
        const lookup = await fetchByPlate(normalised);
        const persisted = await normalizeAndPersist(lookup, { userId: req.user?._id || null });
        vehicle = persisted.vehicle;
      }
    } else {
      return res.status(400).json({ message: "plate эсвэл vehicleId шаардлагатай" });
    }

    if (!vehicle) return res.status(404).json({ message: "Машин олдсонгүй" });

    const result = await findCompatibleParts(vehicle, {
      limit: Math.min(60, Number(limit) || 24),
      category: category || null,
      seedOems: Array.isArray(seedOems) ? seedOems : [],
    });

    return res.json({
      vehicle: publicVehicle(vehicle),
      items: result.items,
      counts: result.counts,
      oemBagSize: result.oemBagSize,
    });
  } catch (err) {
    const code = err.code || "UPSTREAM_ERROR";
    const status = errorCodeToStatus[code] ?? 500;
    return res.status(status).json({ message: err.message, code });
  }
};
