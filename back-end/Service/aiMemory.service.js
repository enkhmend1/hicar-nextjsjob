/**
 * AI Memory service — the agent's cross-session brain.
 *
 * This module is the boundary between the AI controller's runtime
 * context and the AiMemory Mongo collection. Every read returns a
 * plain JS object; every write goes through a capped-array helper so
 * the LRU bounds are enforced server-side regardless of caller bugs.
 *
 * Cap policy:
 *   recentVehicles  ≤ 5    (own car + family + work + 2 extras)
 *   recentSearches  ≤ 10   (covers a normal browsing session)
 *   recentProducts  ≤ 10   (recent click-throughs)
 *
 * Update strategy:
 *   We never use $push without a $slice. Every list mutation is a
 *   read-modify-write via findOneAndUpdate so we can compute the LRU
 *   correctly (move-to-front semantics) and still cap the length.
 *   For high-traffic systems we'd switch to a Mongo aggregation
 *   pipeline update for atomicity, but the AI memory write path is
 *   bounded by per-user chat tempo (≤ a few writes/min), so a simple
 *   read-modify-write is correct.
 */

import AiMemory from "../Model/aiMemory.model.js";

const VEHICLE_CAP  = 5;
const SEARCH_CAP   = 10;
const PRODUCT_CAP  = 10;

// ────────────────────────────────────────────────────────────────────
// Read
// ────────────────────────────────────────────────────────────────────

/**
 * Load (and lazily create) the memory doc for one user.
 *
 * Returns a plain lean object — never a hydrated Mongoose document —
 * so callers can't accidentally call .save() on a snapshot that won't
 * include their pending mutations.
 *
 * Anonymous (userId null) → returns an empty memory shape so callers
 * can treat the value uniformly without null checks. Writes for the
 * anonymous case are a no-op (see internal _writeGate below).
 */
export const loadMemory = async (userId) => {
  if (!userId) return _emptyMemory();
  const doc = await AiMemory.findOne({ user: userId }).lean();
  if (doc) return doc;
  // First touch — create the empty shell. Use upsert to dodge race
  // when two parallel requests both miss the cache.
  await AiMemory.updateOne(
    { user: userId },
    { $setOnInsert: { user: userId, lastUpdatedAt: new Date() } },
    { upsert: true },
  );
  return AiMemory.findOne({ user: userId }).lean();
};

// ────────────────────────────────────────────────────────────────────
// Mutation helpers — every write touches lastUpdatedAt (TTL refresh)
// ────────────────────────────────────────────────────────────────────

/**
 * Internal guard — return null update target if userId is missing, so
 * every callable safely no-ops for anonymous users.
 */
const _writeGate = (userId) => {
  if (!userId) return null;
  return { user: userId };
};

/**
 * Set the active vehicle AND prepend it to recentVehicles (move-to-front).
 *
 * `vehicle` shape: { vehicleId, plate, manufacturer, model, generation }
 */
export const setActiveVehicle = async (userId, vehicle) => {
  const filter = _writeGate(userId);
  if (!filter || !vehicle?.vehicleId) return;

  // Load existing recentVehicles so we can dedupe + move-to-front.
  const doc = await AiMemory.findOne(filter).select("recentVehicles").lean();
  const prev = (doc?.recentVehicles || []).filter(
    (v) => String(v.vehicleId) !== String(vehicle.vehicleId),
  );
  const updated = [
    { ...vehicle, seenAt: new Date() },
    ...prev,
  ].slice(0, VEHICLE_CAP);

  await AiMemory.updateOne(filter, {
    $set: {
      activeVehicle:  { ...vehicle, seenAt: new Date() },
      recentVehicles: updated,
      lastUpdatedAt:  new Date(),
    },
  }, { upsert: true });
};

/**
 * Clear the active vehicle WITHOUT touching the recentVehicles history
 * (so the user can re-pick a previous one from the dropdown).
 */
export const clearActiveVehicle = async (userId) => {
  const filter = _writeGate(userId);
  if (!filter) return;
  await AiMemory.updateOne(filter, {
    $set: { activeVehicle: null, lastUpdatedAt: new Date() },
  });
};

/**
 * Record a search the user performed. Capped + move-to-front by query.
 */
export const pushRecentSearch = async (userId, search) => {
  const filter = _writeGate(userId);
  if (!filter || !search?.query) return;

  const doc = await AiMemory.findOne(filter).select("recentSearches").lean();
  const norm = String(search.query).trim().toLowerCase();
  const prev = (doc?.recentSearches || []).filter(
    (s) => String(s.query).trim().toLowerCase() !== norm,
  );
  const updated = [
    {
      query:       String(search.query).trim(),
      category:    search.category || "",
      resultCount: Number(search.resultCount) || 0,
      vehicleId:   search.vehicleId || null,
      at:          new Date(),
    },
    ...prev,
  ].slice(0, SEARCH_CAP);

  await AiMemory.updateOne(filter, {
    $set: { recentSearches: updated, lastUpdatedAt: new Date() },
  }, { upsert: true });
};

/**
 * Record a product the user viewed / the AI surfaced. Capped + dedupe.
 */
export const pushRecentProduct = async (userId, product) => {
  const filter = _writeGate(userId);
  if (!filter || !product?.productId) return;

  const doc = await AiMemory.findOne(filter).select("recentProducts").lean();
  const prev = (doc?.recentProducts || []).filter(
    (p) => String(p.productId) !== String(product.productId),
  );
  const updated = [
    {
      productId: product.productId,
      name:      product.name  || "",
      oem:       product.oem   || "",
      // Phase AK: track price + brand so "the cheap one" follow-ups can
      // be answered from memory without re-fetching the catalogue.
      price:     Number(product.price)  || 0,
      brand:     product.brand || "",
      at:        new Date(),
    },
    ...prev,
  ].slice(0, PRODUCT_CAP);

  await AiMemory.updateOne(filter, {
    $set: { recentProducts: updated, lastUpdatedAt: new Date() },
  }, { upsert: true });
};

/**
 * Begin / refresh a diagnostic flow. Overwrites the single slot —
 * the AI maintains exactly one open diagnostic at a time.
 */
export const setDiagnosticState = async (userId, state) => {
  const filter = _writeGate(userId);
  if (!filter) return;
  await AiMemory.updateOne(filter, {
    $set: {
      diagnosticState: {
        symptom:         String(state?.symptom || ""),
        candidateParts:  Array.isArray(state?.candidateParts) ? state.candidateParts.slice(0, 12) : [],
        lastClarifyingQ: String(state?.lastClarifyingQ || ""),
        startedAt:       state?.startedAt || new Date(),
      },
      lastUpdatedAt: new Date(),
    },
  }, { upsert: true });
};

export const clearDiagnosticState = async (userId) => {
  const filter = _writeGate(userId);
  if (!filter) return;
  await AiMemory.updateOne(filter, {
    $set: { diagnosticState: null, lastUpdatedAt: new Date() },
  });
};

// ────────────────────────────────────────────────────────────────────
// Composition helpers — used by the controller to inject memory into
// the LLM's system prompt.
// ────────────────────────────────────────────────────────────────────

/**
 * Build a compact summary string from memory, suitable for appending
 * to the system prompt. Empty string if memory is empty so we never
 * pollute the prompt with noise.
 *
 * Keep this short — every token here is paid for every turn. We list:
 *   • active vehicle (if any, beyond what frontend sent)
 *   • last 3 searches (subject only, not full args)
 *   • last 3 product OEMs (so the AI can reference them by name)
 *   • open diagnostic (if any)
 */
export const summarizeMemoryForPrompt = (memory, locale = "mn") => {
  if (!memory || (!memory.activeVehicle && !memory.recentSearches?.length
      && !memory.recentProducts?.length && !memory.diagnosticState?.symptom)) {
    return "";
  }
  const lines = [];
  const head = locale === "en" ? "USER MEMORY (cross-session)" : "ХЭРЭГЛЭГЧИЙН ОЙ САНАМЖ (өмнөх сесс)";
  lines.push(head + ":");

  if (memory.activeVehicle) {
    const v = memory.activeVehicle;
    const parts = [v.manufacturer, v.model, v.generation && `[${v.generation}]`].filter(Boolean).join(" ");
    lines.push(`  • Active vehicle: ${parts} (plate ${v.plate})`);
  }

  const searches = (memory.recentSearches || []).slice(0, 3).map((s) => s.query);
  if (searches.length) lines.push(`  • Recent searches: ${searches.join(", ")}`);

  // Phase AK: include the LAST shown products in detail so follow-up
  // turns ("хямд нь юу вэ?", "Aisin-ийг сонгох уу?") can be answered
  // without re-running search_products. We list the top 5 most recent
  // with name + brand + price so the LLM can pick by attribute.
  const products = (memory.recentProducts || []).slice(0, 5).filter((p) => p.oem || p.name);
  if (products.length) {
    const tag = locale === "en" ? "Last shown products" : "Сүүлд харуулсан бараа";
    lines.push(`  • ${tag} (reference these for follow-ups like "the cheap one" / "хямд нь"):`);
    for (const p of products) {
      const bits = [p.name || p.oem];
      if (p.brand) bits.push(p.brand);
      if (p.oem && p.oem !== p.name) bits.push(p.oem);
      if (p.price) bits.push(`₮${Number(p.price).toLocaleString()}`);
      lines.push(`      - ${bits.join(" · ")}`);
    }
  }

  const dx = memory.diagnosticState;
  if (dx?.symptom) {
    lines.push(`  • Open diagnostic: "${dx.symptom}" — candidates: ${dx.candidateParts?.join(", ") || "(none)"}`);
  }

  return lines.join("\n");
};

// ────────────────────────────────────────────────────────────────────
// Internal — empty memory shape returned for anonymous users
// ────────────────────────────────────────────────────────────────────
const _emptyMemory = () => ({
  user: null,
  activeVehicle:  null,
  recentVehicles: [],
  recentSearches: [],
  recentProducts: [],
  diagnosticState: null,
});

export const __internal = Object.freeze({
  VEHICLE_CAP, SEARCH_CAP, PRODUCT_CAP,
  _writeGate, _emptyMemory,
});
