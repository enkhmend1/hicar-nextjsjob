/**
 * Smart search controller.
 *
 * One public endpoint:
 *
 *   POST /api/search/smart
 *
 * Body (one of `vehicleId` | `plate` must be supplied):
 *   {
 *     vehicleId?: string,    // preferred — uses cached Vehicle doc
 *     plate?:     string,    // alternative — triggers a lookup first
 *     query:      string,    // "урд наклад"
 *     limit?:     number,    // default 24
 *     freshAi?:   boolean,   // bypass AI cache
 *     freshParts?: boolean,  // bypass external parts API cache
 *   }
 *
 * Response: see smartSearch.service.js for the exact shape. Admin callers
 * additionally see `external.proxyUsed`.
 */

import Vehicle from "../Model/vehicle.model.js";
import { fetchByPlate, isPlateValid, normalizePlate } from "../Service/garage.service.js";
import { normalizeAndPersist } from "../Service/vehicleNormalizer.service.js";
import { smartSearch } from "../Service/smartSearch.service.js";

const errorCodeToStatus = {
  PLATE_INVALID: 400,
  NOT_FOUND:     404,
  TIMEOUT:       504,
  RATE_LIMITED:  429,
  UPSTREAM_5XX:  502,
  CIRCUIT_OPEN:  503,
};

/**
 * Resolve a Vehicle doc from either vehicleId or plate. Plate path will
 * fetch upstream and persist if not yet cached.
 */
const resolveVehicle = async (body, userId) => {
  if (body.vehicleId) {
    const v = await Vehicle.findById(body.vehicleId);
    if (!v) { const e = new Error("Машин олдсонгүй"); e.code = "NOT_FOUND"; throw e; }
    return v;
  }
  if (body.plate) {
    if (!isPlateValid(body.plate)) {
      const e = new Error("Plate буруу формат"); e.code = "PLATE_INVALID"; throw e;
    }
    const norm = normalizePlate(body.plate);
    let v = await Vehicle.findOne({ plate: norm });
    if (!v) {
      const lookup = await fetchByPlate(norm);
      const persisted = await normalizeAndPersist(lookup, { userId });
      v = persisted.vehicle;
    }
    return v;
  }
  const e = new Error("vehicleId эсвэл plate шаардлагатай"); e.code = "PLATE_INVALID"; throw e;
};

export const smartSearchHandler = async (req, res) => {
  try {
    const { query, vehicleId, plate, limit, freshAi, freshParts } = req.body || {};
    if (!query || typeof query !== "string" || query.trim().length < 2) {
      return res.status(400).json({ message: "query шаардлагатай (≥2 тэмдэгт)" });
    }

    const vehicle = await resolveVehicle({ vehicleId, plate }, req.user?._id || null);
    const result = await smartSearch({
      vehicle,
      query: query.trim(),
      limit,
      freshAi,
      freshParts,
    });

    // Strip proxyUsed for non-admin callers (already cred-redacted but still
    // an implementation detail we don't broadcast)
    if (req.user?.role !== "admin") delete result.external.proxyUsed;

    return res.json(result);
  } catch (err) {
    const code = err.code || "UPSTREAM_ERROR";
    const status = errorCodeToStatus[code] ?? 500;
    return res.status(status).json({ message: err.message, code });
  }
};
