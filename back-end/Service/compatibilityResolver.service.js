/**
 * Compatibility resolver.
 *
 * Turns a product's free-text fitments (+ OEM) into the STRUCTURED
 * `product.compatibility` block the compatibility engine queries:
 *
 *   { manufacturers[], models[], engines[], engineCodes[], oemBag[] }
 *
 * Crucially it reuses the SAME canonical taxonomy docs that
 * `vehicleNormalizer.service.js` upserts from plate lookups — keyed by
 *   Manufacturer.code   = MAKE  (UPPER)
 *   VehicleModel.code   = MODEL (UPPER)  (per manufacturer, any generation)
 *   Engine.code         = ENGINE CODE (UPPER)
 * so a resolved product ref EQUALS the ref on the buyer's Vehicle doc and
 * the engine matches by manufacturer / model / engine, not only exact OEM.
 *
 * Find-only — it never creates taxonomy rows. A fitment for a make/model
 * nobody has ever looked up has nothing to match against anyway, and the
 * free-text tier in compatibility.service.js still catches it.
 */

import Manufacturer from "../Model/manufacturer.model.js";
import VehicleModel from "../Model/vehicleModel.model.js";
import Engine from "../Model/engine.model.js";
import { expandOemBag } from "./oemCross.service.js";

const up = (s) => String(s || "").trim().toUpperCase();

/**
 * @param {{ fitments?: Array<{ make?: string, model?: string, engine?: string }>, oem?: string }} input
 *   `fitments` accepts both the seller `fitments[]` shape ({make, model})
 *   and the bulk-import `compatible_vehicles[]` shape ({make, model, engine}).
 * @returns {Promise<{ manufacturers: string[], models: string[], engines: string[], engineCodes: string[], oemBag: string[] }>}
 */
export const resolveCompatibility = async ({ fitments = [], oem = "" } = {}) => {
  const manufacturers = new Set();
  const models = new Set();
  const engines = new Set();
  const engineCodes = new Set();

  for (const f of Array.isArray(fitments) ? fitments : []) {
    const make = up(f?.make);
    const model = up(f?.model);
    const engCode = up(f?.engine);

    if (engCode) {
      engineCodes.add(engCode);
      const eng = await Engine.findOne({ code: engCode }).select("_id").lean();
      if (eng) engines.add(String(eng._id));
    }

    if (!make) continue;
    const mfg = await Manufacturer.findOne({ code: make }).select("_id").lean();
    if (!mfg) continue;
    manufacturers.add(String(mfg._id));

    if (model) {
      // Include every generation of this make+model so a generation-specific
      // vehicle ref still matches the broader fitment.
      const ms = await VehicleModel.find({ manufacturer: mfg._id, code: model }).select("_id").lean();
      for (const m of ms) models.add(String(m._id));
    }
  }

  const oemBag = await expandOemBag([oem].filter(Boolean));

  return {
    manufacturers: [...manufacturers],
    models: [...models],
    engines: [...engines],
    engineCodes: [...engineCodes],
    oemBag,
  };
};
