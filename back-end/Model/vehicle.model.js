import mongoose from "mongoose";

/**
 * A real-world identified vehicle. Acts as a cache of (plate → vehicle).
 *
 * The doc stores:
 *   • normalized refs (manufacturer / model / engine)
 *   • the raw external API payload for forensics
 *   • the owning user (if any — anonymous lookups have user=null)
 *
 * Indexes: plate is the natural unique key. carExternalId is the
 * Garage.mn carid; useful to deduplicate when a customer looks up the
 * same plate from multiple accounts.
 */
const vehicleSchema = new mongoose.Schema(
  {
    plate:         { type: String, required: true, uppercase: true, trim: true, unique: true, index: true },
    carExternalId: { type: Number, index: true, default: null },

    manufacturer: { type: mongoose.Schema.Types.ObjectId, ref: "Manufacturer", default: null, index: true },
    model:        { type: mongoose.Schema.Types.ObjectId, ref: "VehicleModel", default: null, index: true },
    engine:       { type: mongoose.Schema.Types.ObjectId, ref: "Engine", default: null, index: true },

    // Denormalised snapshot for fast read & for cases where normalization fails
    snapshot: {
      manuname:    String,
      modelname:   String,
      motorcode:   String,
      motortype:   String,
      carname:     String,
      displacement: String,
      generation:  String,
    },

    raw: { type: mongoose.Schema.Types.Mixed }, // exact response from external API
    rawSource: { type: String, default: "garage.mn" },

    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },

    // for invalidation / refresh policy
    lookedUpAt: { type: Date, default: Date.now },
    expiresAt:  { type: Date, index: true },
  },
  { timestamps: true },
);

vehicleSchema.virtual("engineCode").get(function () {
  return this.snapshot?.motorcode || "";
});

export default mongoose.model("Vehicle", vehicleSchema);
