/**
 * VehicleProvider — formal contract every upstream "plate → vehicle" data
 * provider must implement. Centralising the contract here lets the system
 * swap providers (garage.mn → other-website.mn) with zero changes to the
 * downstream normalizer / compatibility engine.
 *
 *
 *  ──────────────────────────────────────────────────────────────────
 *  CONTRACT
 *  ──────────────────────────────────────────────────────────────────
 *
 *  Each adapter is a *plain object* with the following members:
 *
 *  @typedef {object} VehicleProvider
 *
 *  @property {string} name                      Stable machine-friendly id,
 *                                               e.g. "garage" or "newweb".
 *                                               Used in cache keys, logs and
 *                                               `Vehicle.rawSource`.
 *
 *  @property {string} displayName               Human label for admin UI.
 *
 *  @property {number} [cacheTtlSeconds]         Optional override for the
 *                                               default cache TTL (24h).
 *
 *  @property {(plate:string)=>string} normalizePlate
 *                                               Provider-specific plate
 *                                               normalisation (case,
 *                                               whitespace, Cyrillic, etc.)
 *
 *  @property {(plate:string)=>boolean} isPlateValid
 *                                               Format pre-check; rejects
 *                                               obviously bad inputs without
 *                                               an upstream round-trip.
 *
 *  @property {(plate:string)=>{
 *    url:    string,
 *    method?: "GET"|"POST",
 *    headers?: Record<string,string>,
 *    body?:    string
 *  }} buildRequest
 *                                               Compose the HTTP request to
 *                                               send to upstream. Adapter is
 *                                               solely responsible for the
 *                                               URL, auth headers and body.
 *
 *  @property {(json:unknown, ctx:{ status:number })=>CanonicalVehicle} parseResponse
 *                                               Translate upstream-shape JSON
 *                                               into the canonical shape
 *                                               (see below). MUST throw
 *                                               `{ code: "NOT_FOUND" }` if
 *                                               the plate has no result.
 *
 *
 *  ──────────────────────────────────────────────────────────────────
 *  CANONICAL VEHICLE SHAPE (what every adapter MUST return)
 *  ──────────────────────────────────────────────────────────────────
 *
 *  @typedef {object} CanonicalVehicle
 *  @property {number|string|null} externalId    Provider-side primary key.
 *  @property {string} manuname                  Manufacturer (UPPERCASE).
 *  @property {string} modelname                 Raw model name — may include
 *                                               generation in parens, e.g.
 *                                               "CROWN (_S20_)".
 *  @property {string} motorcode                 Engine code (e.g. "2GR-FSE").
 *  @property {string} motortype                 Free text, e.g. "Full Hybrid".
 *  @property {string} carname                   Human label, e.g. "3.5 Hybrid (GWS204)".
 *  @property {string} platenumber               Original (un-normalised) plate.
 *  @property {string[]=} imageUrls              Optional photo URLs.
 *
 *
 *  ──────────────────────────────────────────────────────────────────
 *  ERROR CODES (parseResponse may throw any of these)
 *  ──────────────────────────────────────────────────────────────────
 *    NOT_FOUND       — plate is unknown to the provider
 *    UPSTREAM_ERROR  — bad / unparseable response shape
 *    PROVIDER_AUTH   — provider rejected our credentials
 *
 *
 *  ──────────────────────────────────────────────────────────────────
 *  ADDING A NEW PROVIDER
 *  ──────────────────────────────────────────────────────────────────
 *
 *    1. Create  Service/vehicleProviders/<name>.adapter.js
 *    2. Implement the 5 members above
 *    3. Register it in  Service/vehicleProviders/registry.js
 *    4. Set  VEHICLE_PROVIDER=<name>  in .env
 *
 *    Done — no other file changes needed. The cache key is namespaced by
 *    adapter.name so the two providers can coexist during migration.
 */

export {};
