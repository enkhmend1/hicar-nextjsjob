import mongoose from "mongoose";

/**
 * Vehicle model — a marque under a manufacturer (CROWN, PRIUS, X-TRAIL).
 * Generation (e.g. S20, GWS204, ZVW50) is the model facelift cycle.
 * Compound unique on (manufacturer, code, generation) — same name across
 * manufacturers (e.g. "CROWN" Toyota vs. Atlas) gets its own row.
 */
const vehicleModelSchema = new mongoose.Schema(
  {
    manufacturer: { type: mongoose.Schema.Types.ObjectId, ref: "Manufacturer", required: true, index: true },
    code:        { type: String, required: true, uppercase: true, trim: true, index: true },
    displayName: { type: String, required: true, trim: true },
    generation:  { type: String, default: "", trim: true },  // e.g. "S20", "ZVW50"
    yearFrom:    { type: Number },
    yearTo:      { type: Number },
    aliases:     { type: [String], default: [] },
  },
  { timestamps: true },
);

vehicleModelSchema.index({ manufacturer: 1, code: 1, generation: 1 }, { unique: true });

export default mongoose.model("VehicleModel", vehicleModelSchema);
