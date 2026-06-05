/**
 * Provider registry — picks the active VehicleProvider adapter by
 * `VEHICLE_PROVIDER` env (default "garage").
 *
 * To add a new provider:
 *   1. Write `<name>.adapter.js` next to this file (see types.js for contract)
 *   2. Add it to the ADAPTERS map below
 *   3. Set VEHICLE_PROVIDER=<name> in .env
 */

import { logger } from "../../Config/logger.js";
import garageAdapter from "./garage.adapter.js";

/** @type {Record<string, import("./types.js").VehicleProvider>} */
const ADAPTERS = {
  [garageAdapter.name]: garageAdapter,
  // newweb: newwebAdapter,   ← future
  // vinDecoder: vinAdapter,  ← future
};

const requested = (process.env.VEHICLE_PROVIDER || "garage").trim().toLowerCase();
const active = ADAPTERS[requested] || garageAdapter;

if (!ADAPTERS[requested]) {
  logger.warn("VEHICLE_PROVIDER not found, falling back", { requested, fallback: active.name });
}
logger.info("Vehicle provider selected", { provider: active.displayName, name: active.name });

/** Currently configured adapter (set at boot via env). */
export const getActiveProvider = () => active;

/** Lookup an adapter by name — used by admin UI / debug endpoints. */
export const getProviderByName = (name) => ADAPTERS[name] || null;

/** All registered adapters — for admin UI listing. */
export const listProviders = () => Object.values(ADAPTERS).map((a) => ({
  name: a.name, displayName: a.displayName,
}));
