#!/usr/bin/env node
/**
 * Backfill the structured `product.compatibility` block for EXISTING products.
 *
 * New create/update/import paths now populate `compatibility.*` via
 * compatibilityResolver.service.js, but products created before that ship with
 * an empty block — so the compatibility engine can only reach them through the
 * free-text tier or an exact OEM. This one-off migration derives the structured
 * block from whatever each product already has:
 *
 *   1. structured `fitments[]`  ({make, model})           — preferred
 *   2. else free-text `compatible[]` ("Toyota Camry 2012-2018")
 *      parsed best-effort as  token0 = make, token1 = model
 *   3. plus `oem` → expanded OEM bag (picks up cross-references)
 *
 * Resolution is find-only against the canonical taxonomy, so messy free text
 * simply resolves to nothing (no junk written) — the free-text search tier
 * still covers those.
 *
 * Usage:
 *   node scripts/backfill-compatibility.js            # backfill empty ones
 *   node scripts/backfill-compatibility.js --dry      # preview, write nothing
 *   node scripts/backfill-compatibility.js --force    # recompute ALL products
 *   node scripts/backfill-compatibility.js --limit 50 # cap (testing)
 *
 * Idempotent: safe to re-run. Without --force it skips products that already
 * have a populated compatibility block.
 *
 * Exits: 0 success · 1 failure.
 */

import "dotenv/config";
import mongoose from "mongoose";
import Product from "../Model/product.model.js";
import { resolveCompatibility } from "../Service/compatibilityResolver.service.js";

// ── CLI flags (zero-dep) ────────────────────────────────────────────────
const args = process.argv.slice(2);
const has = (k) => args.includes(k);
const valOf = (k) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};
const DRY = has("--dry");
const FORCE = has("--force");
const LIMIT = Number(valOf("--limit")) || 0;

// "Toyota Camry 2012-2018" → { make: "Toyota", model: "Camry" }
// "TOYOTA" → { make: "TOYOTA", model: "" }. Find-only resolution downstream
// drops anything that isn't a known manufacturer/model, so loose parsing is safe.
const parseCompatible = (s) => {
  const tokens = String(s || "").trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  return { make: tokens[0], model: tokens[1] || "" };
};

const compatibilityIsEmpty = (c = {}) =>
  !((c.manufacturers?.length) || (c.models?.length) || (c.engines?.length) ||
    (c.engineCodes?.length) || (c.oemBag?.length));

const hasContent = (c) =>
  (c.manufacturers.length || c.models.length || c.engines.length ||
   c.engineCodes.length || c.oemBag.length) > 0;

const run = async () => {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is not set");
  console.log(`Connecting to ${(process.env.MONGO_URI).replace(/\/\/[^@]+@/, "//***@")}…`);
  await mongoose.connect(process.env.MONGO_URI);

  const stats = { scanned: 0, updated: 0, skippedExisting: 0, skippedEmpty: 0, failed: 0 };
  const cursor = Product.find({}).cursor();

  for (let p = await cursor.next(); p; p = await cursor.next()) {
    if (LIMIT && stats.scanned >= LIMIT) break;
    stats.scanned++;

    try {
      if (!FORCE && !compatibilityIsEmpty(p.compatibility)) { stats.skippedExisting++; continue; }

      // Source fitments: prefer structured, else parse the free-text list.
      let fitments = [];
      if (Array.isArray(p.fitments) && p.fitments.length) {
        fitments = p.fitments.map((f) => ({ make: f.make, model: f.model }));
      } else if (Array.isArray(p.compatible) && p.compatible.length) {
        fitments = p.compatible.map(parseCompatible).filter(Boolean);
      }

      const compatibility = await resolveCompatibility({ fitments, oem: p.oem });
      if (!hasContent(compatibility)) { stats.skippedEmpty++; continue; }

      if (!DRY) {
        p.compatibility = compatibility;
        await p.save();
      }
      stats.updated++;

      if (stats.updated % 50 === 0) console.log(`  …${stats.updated} updated (${stats.scanned} scanned)`);
    } catch (e) {
      stats.failed++;
      console.warn(`  ! ${p._id}: ${e.message}`);
    }
  }

  console.log(`\n${DRY ? "[DRY RUN] " : ""}Done:`, stats);
  await mongoose.disconnect();
};

run()
  .then(() => process.exit(0))
  .catch((err) => { console.error("backfill failed:", err.message); process.exit(1); });
