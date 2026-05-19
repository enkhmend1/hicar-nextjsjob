import mongoose from "mongoose";

/**
 * Canonical vehicle manufacturer (TOYOTA, NISSAN, HONDA, ...).
 * `code` is the normalized uppercase token used as the primary lookup key.
 */
const manufacturerSchema = new mongoose.Schema(
  {
    code:        { type: String, required: true, unique: true, uppercase: true, trim: true, index: true },
    displayName: { type: String, required: true, trim: true },
    country:     { type: String, default: "" },
    aliases:     { type: [String], default: [] }, // ["TOYOTA","TOYOTA MOTOR","TYT"]
    logo:        { type: String, default: "" },
  },
  { timestamps: true },
);

export default mongoose.model("Manufacturer", manufacturerSchema);
