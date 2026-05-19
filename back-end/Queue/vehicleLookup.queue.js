/**
 * Vehicle-lookup queue.
 *
 * Job payload: { plate, userId?, fresh? }
 *
 * The worker hits the external Garage API (via the resilient client),
 * normalises the response and persists into the canonical collections.
 * Returns { plate, vehicleId, source: "cache"|"network" } on success.
 *
 * Use cases:
 *   • single API request → enqueue + poll (avoids tying up HTTP workers
 *     during slow upstream calls)
 *   • bulk imports (admin uploads N plates) → fan-out via enqueue, then
 *     poll the queue's aggregate state
 */

import { register } from "../Service/jobQueue.service.js";
import { fetchByPlate } from "../Service/garage.service.js";
import { normalizeAndPersist } from "../Service/vehicleNormalizer.service.js";

export const VEHICLE_LOOKUP_QUEUE = "vehicle-lookup";

register(VEHICLE_LOOKUP_QUEUE, async (job) => {
  const { plate, userId = null, fresh = false } = job.data;
  const lookup = await fetchByPlate(plate, { fresh });
  const { vehicle } = await normalizeAndPersist(lookup, { userId });
  return { plate, vehicleId: String(vehicle._id), source: lookup.source, hit: lookup.hit };
}, { concurrency: 3 });
