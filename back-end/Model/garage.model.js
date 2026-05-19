import mongoose from "mongoose";

/**
 * User garage — saved vehicles a user wants to remember (their personal cars).
 *
 * Distinct from `Vehicle` (which is a system-wide cache of plate→identified-
 * vehicle from the external Garage.mn API). A garage entry is a *user* choice
 * — they may have entered the data manually, or it may have been seeded from
 * a successful plate lookup.
 *
 * Unique on (user, plate) when plate is non-empty.
 */
const garageSchema = new mongoose.Schema(
  {
    user:    { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    plate:   { type: String, trim: true, uppercase: true, default: "" },
    vin:     { type: String, trim: true, uppercase: true, default: "" },
    make:    { type: String, required: true, trim: true },
    model:   { type: String, required: true, trim: true },
    year:    { type: Number, required: true, min: 1980, max: new Date().getFullYear() + 1 },
    engine:  { type: String, trim: true, default: "" },
    chassis: { type: String, trim: true, default: "" },
    color:   { type: String, trim: true, default: "" },
    isDefault: { type: Boolean, default: false },

    /** Optional link to the system-wide normalised Vehicle cache. */
    vehicleRef: { type: mongoose.Schema.Types.ObjectId, ref: "Vehicle", default: null },
  },
  { timestamps: true },
);

garageSchema.index(
  { user: 1, plate: 1 },
  { unique: true, partialFilterExpression: { plate: { $ne: "" } } },
);

export default mongoose.model("UserGarage", garageSchema);
