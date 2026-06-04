/**
 * STAGE 4 — VEHICLE. Parses brand / model / generation from the cleaned text.
 * Chassis/generation codes are matched FIRST (most specific): "prius30",
 * "xw30", "zvw30" → Toyota Prius XW30. Falls back to model, then brand.
 *
 * This is a compact starter table. The richer chassis map in the legacy
 * `vehicleKnowledge.service` can be merged in later; the structure here is
 * deliberately data-driven so that merge is a data change, not a code change.
 */

import type { PipelineContext } from "../pipeline.types.js";

const VP = "vehicleParser" as const;

interface ChassisRule { kw: string[]; brand: string; model: string; gen: string; }
interface ModelRule { kw: string[]; brand: string; model: string; }
interface BrandRule { kw: string[]; brand: string; }

const CHASSIS: ChassisRule[] = [
  { kw: ["prius30", "xw30", "zvw30"], brand: "Toyota", model: "Prius", gen: "XW30" },
  { kw: ["prius50", "xw50", "zvw50"], brand: "Toyota", model: "Prius", gen: "XW50" },
  { kw: ["prius20", "xw20", "nhw20"], brand: "Toyota", model: "Prius", gen: "XW20" },
  { kw: ["landcruiser200", "uzj200", "urj202"], brand: "Toyota", model: "Land Cruiser", gen: "200" },
  { kw: ["xtrail32", "t32"], brand: "Nissan", model: "X-Trail", gen: "T32" },
];

const MODELS: ModelRule[] = [
  { kw: ["prius"], brand: "Toyota", model: "Prius" },
  { kw: ["camry"], brand: "Toyota", model: "Camry" },
  { kw: ["corolla"], brand: "Toyota", model: "Corolla" },
  { kw: ["rav4", "rav 4"], brand: "Toyota", model: "RAV4" },
  { kw: ["land cruiser", "landcruiser"], brand: "Toyota", model: "Land Cruiser" },
  { kw: ["x-trail", "xtrail", "x trail"], brand: "Nissan", model: "X-Trail" },
  { kw: ["fit"], brand: "Honda", model: "Fit" },
  { kw: ["crv", "cr-v"], brand: "Honda", model: "CR-V" },
];

const BRANDS: BrandRule[] = [
  { kw: ["toyota"], brand: "Toyota" },
  { kw: ["nissan"], brand: "Nissan" },
  { kw: ["honda"], brand: "Honda" },
  { kw: ["mitsubishi"], brand: "Mitsubishi" },
  { kw: ["hyundai"], brand: "Hyundai" },
  { kw: ["lexus"], brand: "Lexus" },
];

export function stageVehicle(ctx: PipelineContext): void {
  const text = ctx.cleanedText;
  const has = (kw: string[]): string | undefined => kw.find((k) => text.includes(k));

  for (const c of CHASSIS) {
    const hit = has(c.kw);
    if (hit) {
      ctx.fields.canonicalBrand = { value: c.brand, confidence: 0.85, source: VP, evidence: hit };
      ctx.fields.canonicalModel = { value: c.model, confidence: 0.85, source: VP, evidence: hit };
      ctx.fields.generation = { value: c.gen, confidence: 0.85, source: VP, evidence: hit };
      return; // chassis is the most specific signal — done.
    }
  }

  for (const m of MODELS) {
    const hit = has(m.kw);
    if (hit) {
      ctx.fields.canonicalBrand = { value: m.brand, confidence: 0.8, source: VP, evidence: hit };
      ctx.fields.canonicalModel = { value: m.model, confidence: 0.8, source: VP, evidence: hit };
      return;
    }
  }

  for (const b of BRANDS) {
    const hit = has(b.kw);
    if (hit) {
      ctx.fields.canonicalBrand = { value: b.brand, confidence: 0.75, source: VP, evidence: hit };
      return;
    }
  }
}
