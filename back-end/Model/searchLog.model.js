import mongoose from "mongoose";

/**
 * Every product search the platform performs (AI tool calls + the shop's own
 * fulltext search) is logged here. The admin training UI surfaces queries
 * with low result counts so a human can curate OEM mappings or seed products.
 */
const searchLogSchema = new mongoose.Schema(
  {
    query: { type: String, required: true, trim: true, index: "text" },
    expandedQuery: { type: String, default: "" },
    category: { type: String, default: "" },
    resultCount: { type: Number, default: 0, index: true },
    source: { type: String, enum: ["ai", "shop", "voice", "image"], default: "ai" },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    locale: { type: String, default: "mn" },
  },
  { timestamps: true },
);

searchLogSchema.index({ createdAt: -1 });
searchLogSchema.index({ resultCount: 1, createdAt: -1 });

export default mongoose.model("SearchLog", searchLogSchema);
