/**
 * Vehicle normalizer — provider-agnostic.
 *
 * Accepts the result envelope from `fetchByPlate(...)`:
 *
 *   {
 *     raw,         // upstream-shape JSON (kept for forensics)
 *     normalized,  // CanonicalVehicle shape (see vehicleProviders/types.js)
 *     source,      // adapter.name — "garage", "newweb", "vinDecoder", …
 *   }
 *
 * Pipeline:
 *   1. Further parse semi-structured strings from the canonical payload:
 *        modelname "CROWN (_S20_)"        → model "CROWN" + generation "S20"
 *        carname   "3.5 Hybrid (GWS204)"  → displacement "3.5" + chassis "GWS204"
 *   2. Upsert Manufacturer / VehicleModel / Engine canonical docs
 *   3. Upsert a Vehicle doc keyed by plate (acts as cache)
 *
 * The function also accepts a legacy bare `raw` argument (without the
 * envelope) so older callers continue to work — in that case we assume
 * garage.mn shape (`raw.data.X`) and tag source as "garage".
 *
 * Output:
 *   { vehicle, manufacturer, model, engine, normalized }
 *
 * Idempotent — calling it twice for the same plate yields identical refs.
 */

import Manufacturer from "../Model/manufacturer.model.js";
import VehicleModel from "../Model/vehicleModel.model.js";
import Engine from "../Model/engine.model.js";
import Vehicle from "../Model/vehicle.model.js";

// ── String parsers ────────────────────────────────────────────────────
// "CROWN (_S20_)" → { model: "CROWN", generation: "S20" }
// "PRIUS"         → { model: "PRIUS", generation: "" }
const splitModel = (modelname = "") => {
  const m = String(modelname).match(/^(.*?)\s*\(_?([^_)]+)_?\)\s*$/);
  if (m) return { model: m[1].trim(), generation: m[2].trim() };
  return { model: String(modelname).trim(), generation: "" };
};

// "3.5 Hybrid (GWS204)" → { displacement: "3.5", chassis: "GWS204" }
// "2.0 Diesel"          → { displacement: "2.0", chassis: "" }
const parseCarName = (carname = "") => {
  const dispMatch    = String(carname).match(/(\d+(?:\.\d+)?)/);
  const chassisMatch = String(carname).match(/\(([^)]+)\)/);
  return {
    displacement: dispMatch?.[1] || "",
    chassis:      chassisMatch?.[1]?.trim() || "",
  };
};

// ── Input normalisation ───────────────────────────────────────────────
// Accept either:
//   (a) full envelope { raw, normalized, source }
//   (b) legacy bare raw (garage.mn shape) — we transparently wrap it
const acceptEnvelope = (input) => {
  if (input && typeof input === "object" && input.normalized) return input;
  // Legacy path — assume garage shape
  const d = input?.data || input || {};
  return {
    raw: input,
    source: "garage",
    normalized: {
      externalId:  d.carid ?? null,
      manuname:    String(d.manuname || "").trim().toUpperCase(),
      modelname:   String(d.modelname || "").trim(),
      motorcode:   String(d.motorcode || "").trim().toUpperCase(),
      motortype:   String(d.motortype || "").trim(),
      carname:     String(d.carname || "").trim(),
      platenumber: String(d.platenumber || "").trim(),
    },
  };
};

// Take the canonical payload, derive the extra structured fields we store
// on the Vehicle.snapshot subdoc.
const enrich = (n) => {
  const { model, generation } = splitModel(n.modelname);
  const { displacement, chassis } = parseCarName(n.carname);
  return {
    manuname:     n.manuname,
    modelname:    model.toUpperCase(),
    generation:   generation || chassis || "",
    motorcode:    n.motorcode,
    motortype:    n.motortype,
    carname:      n.carname,
    displacement: displacement || "",
    plate:        String(n.platenumber || "").toUpperCase().replace(/\s+/g, ""),
    carExternalId: n.externalId,
  };
};

// ── Canonical upserts ─────────────────────────────────────────────────
const upsertCanonical = async (e) => {
  const manufacturer = await Manufacturer.findOneAndUpdate(
    { code: e.manuname },
    { $setOnInsert: { code: e.manuname, displayName: e.manuname } },
    { returnDocument: "after", upsert: true },
  );

  const model = e.modelname
    ? await VehicleModel.findOneAndUpdate(
        { manufacturer: manufacturer._id, code: e.modelname, generation: e.generation || "" },
        { $setOnInsert: { manufacturer: manufacturer._id, code: e.modelname, generation: e.generation || "", displayName: e.modelname } },
        { returnDocument: "after", upsert: true },
      )
    : null;

  const engine = e.motorcode
    ? await Engine.findOneAndUpdate(
        { code: e.motorcode },
        {
          $setOnInsert: {
            code: e.motorcode,
            manufacturer: manufacturer._id,
            type: e.motortype,
            displacementLabel: e.displacement,
            fuel: /hybrid/i.test(e.motortype) ? "hybrid"
              : /diesel/i.test(e.motortype) ? "diesel"
              : /petrol|gasoline/i.test(e.motortype) ? "petrol" : "",
          },
        },
        { returnDocument: "after", upsert: true },
      )
    : null;

  return { manufacturer, model, engine };
};

/**
 * Normalise + upsert canonical refs + upsert/refresh the Vehicle doc.
 *
 * @param {object} input     Either the full envelope from fetchByPlate (preferred)
 *                           OR a bare raw upstream JSON (legacy path).
 * @param {{ userId?: string|null }} opts
 */
export const normalizeAndPersist = async (input, { userId = null } = {}) => {
  const env = acceptEnvelope(input);
  const e = enrich(env.normalized);
  const { manufacturer, model, engine } = await upsertCanonical(e);

  const vehicle = await Vehicle.findOneAndUpdate(
    { plate: e.plate },
    {
      $set: {
        carExternalId: e.carExternalId,
        manufacturer:  manufacturer?._id || null,
        model:         model?._id || null,
        engine:        engine?._id || null,
        snapshot: {
          manuname:     e.manuname,
          modelname:    e.modelname,
          motorcode:    e.motorcode,
          motortype:    e.motortype,
          carname:      e.carname,
          displacement: e.displacement,
          generation:   e.generation,
        },
        raw:        env.raw,
        rawSource:  env.source,            // adapter.name ("garage" / "newweb" / …)
        lookedUpAt: new Date(),
        expiresAt:  new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
      $setOnInsert: { user: userId },
    },
    { returnDocument: "after", upsert: true },
  );

  return { vehicle, manufacturer, model, engine, normalized: e };
};
