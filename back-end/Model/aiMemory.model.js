import mongoose from "mongoose";

/**
 * Per-user AI memory — what the HiCar agent remembers about a user
 * across chat sessions.
 *
 * Why a dedicated collection (not user.aiMemory subdoc):
 *   • Cleaner TTL semantics — memory can age out without touching the
 *     User document, and a single TTL index handles cleanup.
 *   • Cheaper writes — every chat turn updates memory; we don't want
 *     to bloat the User doc index churn or trigger user save hooks.
 *   • Schema can evolve aggressively without User-model coupling — we
 *     expect to add summarisation slots, voice prefs, etc. later.
 *
 * Shape rationale:
 *   • activeVehicle is the CURRENT car the user is shopping for. The
 *     vehicleContext sent by the frontend is the source of truth IF
 *     present; this field is the fallback for chat opens with no
 *     plate-lookup in the same session.
 *   • recentVehicles is a capped LRU (5) so "switch car" UI has
 *     instant history — own car + family + work + 2 extras covers
 *     virtually every Mongolian household pattern.
 *   • recentSearches / recentProducts power "you previously asked
 *     about brakes" and cross-session product memory.
 *   • diagnosticState carries the last unresolved diagnostic so a user
 *     can return ("the noise is louder now") without re-explaining.
 *   • lastUpdatedAt drives the 90-day TTL — if a user is inactive for
 *     90 days, their memory rolls off and they get a fresh slate.
 *
 * All array fields are CAPPED in JS during writes (see
 * aiMemory.service.js); Mongoose enforces type but not bounds.
 */

const recentVehicleSchema = new mongoose.Schema(
  {
    vehicleId:    { type: mongoose.Schema.Types.ObjectId, ref: "Vehicle", required: true },
    plate:        { type: String, required: true, uppercase: true, trim: true },
    manufacturer: { type: String, default: "" },
    model:        { type: String, default: "" },
    generation:   { type: String, default: "" },
    seenAt:       { type: Date,   default: Date.now },
  },
  { _id: false },
);

const recentSearchSchema = new mongoose.Schema(
  {
    query:        { type: String, required: true, trim: true, maxlength: 200 },
    category:     { type: String, default: "" },
    resultCount:  { type: Number, default: 0 },
    vehicleId:    { type: mongoose.Schema.Types.ObjectId, ref: "Vehicle", default: null },
    at:           { type: Date,   default: Date.now },
  },
  { _id: false },
);

const recentProductSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    name:      { type: String, default: "" },
    oem:       { type: String, default: "" },
    at:        { type: Date,   default: Date.now },
  },
  { _id: false },
);

const diagnosticStateSchema = new mongoose.Schema(
  {
    /**
     * What the user is investigating. Free-form so the AI can use any
     * phrasing the user gave us ("тог тог дуу", "vibration on accel").
     */
    symptom:            { type: String, default: "" },
    /**
     * Candidate parts the AI has already enumerated. Lets follow-up
     * turns refine ("it's louder at higher speeds → likely wheel
     * bearing, not CV joint") without re-listing everything.
     */
    candidateParts:     { type: [String], default: [] },
    /**
     * Last clarifying question we asked — so we don't repeat it.
     */
    lastClarifyingQ:    { type: String, default: "" },
    /**
     * When the diagnostic started. Used to age out stale state — if
     * the symptom is from 30 days ago, it's probably already fixed.
     */
    startedAt:          { type: Date,   default: null },
  },
  { _id: false },
);

const aiMemorySchema = new mongoose.Schema(
  {
    /** Owner — one-to-one with User. The user._id IS the memory's _id-style key. */
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref:  "User",
      required: true,
      unique: true,
      index: true,
    },

    /** Currently-active vehicle context. */
    activeVehicle: { type: recentVehicleSchema, default: null },

    /** Capped LRU. Maintained at <=5 by service write helpers. */
    recentVehicles: { type: [recentVehicleSchema], default: [] },

    /** Capped LRU of last 10 product searches the user issued. */
    recentSearches: { type: [recentSearchSchema], default: [] },

    /** Capped LRU of last 10 product detail-views or AI suggestions
        the user clicked through. */
    recentProducts: { type: [recentProductSchema], default: [] },

    /** Unresolved diagnostic flow state (single slot for now). */
    diagnosticState: { type: diagnosticStateSchema, default: null },

    /** Rolling timestamp used by the TTL index. Every save bumps it. */
    lastUpdatedAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true },
);

// ── TTL: 90 days from last touch ──────────────────────────────────
// Mongo deletes the doc when lastUpdatedAt is older than 90 days,
// scoping the AI's memory to active users only. The TTL is calculated
// against `lastUpdatedAt`, NOT `updatedAt`, so changes made via
// findOneAndUpdate (which doesn't always touch updatedAt the way we
// want) still count.
aiMemorySchema.index({ lastUpdatedAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

export default mongoose.model("AiMemory", aiMemorySchema);
