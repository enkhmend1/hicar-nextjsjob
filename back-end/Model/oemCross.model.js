import mongoose from "mongoose";

/**
 * OEM cross-reference table.
 *
 * One row stores a group of equivalent part numbers across brands.
 *  E.g. an oil filter:
 *    { primaryOem: "90915-YZZD1", brand: "Toyota Genuine",
 *      equivalents: [
 *        { oem: "0986AF1063", brand: "Bosch" },
 *        { oem: "150A0-9TC07", brand: "Denso" },
 *      ],
 *      partName: "Тосны шүүр",
 *      category: "engine"
 *    }
 *
 * Lookup pattern: any `oem` (primary or equivalent) returns the whole row.
 * The compatibility engine then surfaces marketplace products whose OEM
 * matches *any* member of the equivalence class.
 */
const equivalentSchema = new mongoose.Schema(
  {
    brand: { type: String, required: true, trim: true },
    oem:   { type: String, required: true, trim: true, uppercase: true },
    note:  { type: String, default: "" },
  },
  { _id: false },
);

const oemCrossSchema = new mongoose.Schema(
  {
    primaryOem:  { type: String, required: true, trim: true, uppercase: true, unique: true, index: true },
    primaryBrand:{ type: String, required: true, trim: true },
    partName:    { type: String, default: "" },
    category:    { type: String, default: "", index: true },
    equivalents: { type: [equivalentSchema], default: [] },
    source:      { type: String, default: "manual", enum: ["manual", "tecdoc", "vin-decoder", "import", "auto"] },
    addedBy:     { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

// Lookup by any equivalent OEM — searchable
oemCrossSchema.index({ "equivalents.oem": 1 });

export default mongoose.model("OemCross", oemCrossSchema);
