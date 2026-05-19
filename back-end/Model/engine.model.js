import mongoose from "mongoose";

/**
 * Engine — keyed by `code` (e.g. "2GR-FSE", "1NZ-FE").
 * One engine can belong to many models across manufacturers (rare but
 * happens with platform sharing), so manufacturer is a soft link.
 */
const engineSchema = new mongoose.Schema(
  {
    code:         { type: String, required: true, uppercase: true, trim: true, unique: true, index: true },
    manufacturer: { type: mongoose.Schema.Types.ObjectId, ref: "Manufacturer", required: true, index: true },
    type:         { type: String, default: "" },         // "Full Hybrid", "Diesel", "Gasoline"
    displacementCc: { type: Number },                    // 3456
    displacementLabel: { type: String, default: "" },    // "3.5"
    cylinders:    { type: Number },
    fuel:         { type: String, default: "" },         // "petrol", "hybrid", "diesel"
    aliases:      { type: [String], default: [] },
  },
  { timestamps: true },
);

export default mongoose.model("Engine", engineSchema);
