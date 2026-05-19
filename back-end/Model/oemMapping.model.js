import mongoose from "mongoose";

/**
 * Admin-curated synonym/translation table that feeds query expansion.
 * The matcher uses the lowercased `keyword` as a substring against the
 * incoming query — first hit wins (longest-first is enforced in the service).
 *
 * Example rows:
 *   { keyword: "тоормосны диск", category: "brake", oemHint: "43512" }
 *   { keyword: "приус мотор",   category: "engine", oemHint: "" }
 *   { keyword: "30 inverter",   category: "electric", oemHint: "G9200" }
 */
const oemMappingSchema = new mongoose.Schema(
  {
    keyword: { type: String, required: true, trim: true, lowercase: true, unique: true },
    category: {
      type: String,
      enum: ["brake", "engine", "lighting", "suspension", "electric", "body", "transmission", "other", ""],
      default: "",
    },
    oemHint: { type: String, trim: true, default: "" },
    note: { type: String, default: "" },
    enabled: { type: Boolean, default: true },
    usageCount: { type: Number, default: 0 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

oemMappingSchema.index({ enabled: 1, keyword: 1 });

export default mongoose.model("OemMapping", oemMappingSchema);
