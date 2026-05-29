"use client";

/**
 * Category icon + tone registry — Phase O.5.
 *
 * Replaces the hand-curated SVG path-d icons stored in MongoDB
 * (SiteContent.categories[].iconPath) with a richer Lucide-based
 * visual treatment per category id. Rationale:
 *
 *   • The path-d icons are inconsistent in stroke weight, geometry, and
 *     visual weight (some are 80% bigger than others). The catalogue
 *     grid looked like an "assorted icons" zoo instead of a unified
 *     design system.
 *   • Lucide is already a dependency, every icon shares the same stroke
 *     grammar, and the Stripe / Linear / Vercel-style modern feel
 *     matches the rest of the new blue+amber palette (Phase N).
 *   • Real photographic icons would either need licensed stock photos
 *     or a 34-image illustration budget. Lucide is free, instant, and
 *     scales perfectly on any DPR.
 *
 * Category id → { Icon, tone } mapping. Tone drives the background
 * gradient + icon color so each "family" of parts is visually grouped
 * (powertrain blue, safety red, electrical amber, etc).
 *
 * When a category id isn't in CATEGORY_VISUAL, the renderer falls back
 * to the legacy MongoDB iconPath so existing categories without a
 * mapping still display (just less polished). Add new categories to
 * the map as they're seeded — no DB migration required.
 */

import type { LucideIcon } from "lucide-react";
import {
  // Powertrain
  Cog, GitMerge, ArrowRight,
  // Safety / chassis control
  Disc, ArrowDownUp, Compass, Radar,
  // Electrical
  Zap, Lightbulb, Battery, Power, Cpu,
  // Body / interior
  Car, Armchair, ScanLine,
  // Hardware
  CircleDot, Hexagon, Lock,
  // Fluids / cooling
  Droplets, Fuel, Snowflake, Thermometer, Grid3x3,
  // Maintenance
  Filter, Workflow, Layers, CloudRain,
  // Misc
  Flame, Wind, Wrench, Sparkles, Package,
} from "lucide-react";

/** Tone tokens. Each maps to a {bg-gradient, icon-text, group-hover}
 *  triple so adding a new tone is a single-line change. */
const TONES = {
  blue: {
    bg:        "bg-gradient-to-br from-blue-50 to-blue-100",
    hover:     "group-hover:from-blue-100 group-hover:to-blue-200",
    icon:      "text-blue-700",
    ring:      "ring-blue-200/50",
  },
  red: {
    bg:        "bg-gradient-to-br from-red-50 to-red-100",
    hover:     "group-hover:from-red-100 group-hover:to-red-200",
    icon:      "text-red-700",
    ring:      "ring-red-200/50",
  },
  amber: {
    bg:        "bg-gradient-to-br from-amber-50 to-amber-100",
    hover:     "group-hover:from-amber-100 group-hover:to-amber-200",
    icon:      "text-amber-700",
    ring:      "ring-amber-200/50",
  },
  indigo: {
    bg:        "bg-gradient-to-br from-indigo-50 to-indigo-100",
    hover:     "group-hover:from-indigo-100 group-hover:to-indigo-200",
    icon:      "text-indigo-700",
    ring:      "ring-indigo-200/50",
  },
  slate: {
    bg:        "bg-gradient-to-br from-slate-50 to-slate-100",
    hover:     "group-hover:from-slate-100 group-hover:to-slate-200",
    icon:      "text-slate-700",
    ring:      "ring-slate-200/50",
  },
  cyan: {
    bg:        "bg-gradient-to-br from-cyan-50 to-cyan-100",
    hover:     "group-hover:from-cyan-100 group-hover:to-cyan-200",
    icon:      "text-cyan-700",
    ring:      "ring-cyan-200/50",
  },
  emerald: {
    bg:        "bg-gradient-to-br from-emerald-50 to-emerald-100",
    hover:     "group-hover:from-emerald-100 group-hover:to-emerald-200",
    icon:      "text-emerald-700",
    ring:      "ring-emerald-200/50",
  },
  gray: {
    bg:        "bg-gradient-to-br from-gray-50 to-gray-100",
    hover:     "group-hover:from-gray-100 group-hover:to-gray-200",
    icon:      "text-gray-700",
    ring:      "ring-gray-200/50",
  },
} as const;
export type CategoryTone = keyof typeof TONES;

interface CategoryVisual {
  Icon: LucideIcon;
  tone: CategoryTone;
}

/** Per-category id → icon + tone. Grouped by "family" so a glance
 *  at the homepage grid hints at the part hierarchy:
 *     blue   — powertrain    (engine, gearbox, driveshaft)
 *     red    — safety/chassis (brake, suspension, steering, sensors)
 *     amber  — electrical    (electric, lighting, battery, ECU, starter)
 *     indigo — body/interior (body, interior, mirrors)
 *     slate  — hardware      (wheels, fasteners, bearings, locks)
 *     cyan   — fluids/HVAC   (oils, fuel, cooling, A/C, radiator)
 *     emerald— maintenance   (filters, belts, gaskets, wipers)
 *     gray   — misc / shop   (workshop tools, care, ignition, intake) */
export const CATEGORY_VISUAL: Record<string, CategoryVisual> = {
  // Powertrain (blue)
  engine:               { Icon: Cog,         tone: "blue" },
  gearbox_transmission: { Icon: GitMerge,    tone: "blue" },
  drive_shafts:         { Icon: ArrowRight,  tone: "blue" },

  // Safety / chassis control (red)
  brake:                { Icon: Disc,        tone: "red" },
  suspension:           { Icon: ArrowDownUp, tone: "red" },
  steering:             { Icon: Compass,     tone: "red" },
  sensors:              { Icon: Radar,       tone: "red" },

  // Electrical (amber)
  electric:             { Icon: Zap,         tone: "amber" },
  lighting:             { Icon: Lightbulb,   tone: "amber" },
  battery:              { Icon: Battery,     tone: "amber" },
  starter_alternator:   { Icon: Power,       tone: "amber" },
  ecu_electronics:      { Icon: Cpu,         tone: "amber" },
  ignition_system:      { Icon: Flame,       tone: "amber" },

  // Body / interior (indigo)
  body:                 { Icon: Car,         tone: "indigo" },
  interior:             { Icon: Armchair,    tone: "indigo" },
  mirrors_glass:        { Icon: ScanLine,    tone: "indigo" },

  // Hardware (slate)
  wheels_tires:         { Icon: CircleDot,   tone: "slate" },
  fasteners:            { Icon: Hexagon,     tone: "slate" },
  bearings:             { Icon: CircleDot,   tone: "slate" },
  lock_systems:         { Icon: Lock,        tone: "slate" },

  // Fluids / cooling / HVAC (cyan)
  oils:                 { Icon: Droplets,    tone: "cyan" },
  fuel_system:          { Icon: Fuel,        tone: "cyan" },
  cooling_system:       { Icon: Snowflake,   tone: "cyan" },
  ac_heating:           { Icon: Thermometer, tone: "cyan" },
  radiator:             { Icon: Grid3x3,     tone: "cyan" },

  // Maintenance (emerald)
  filters:              { Icon: Filter,      tone: "emerald" },
  belts_hoses:          { Icon: Workflow,    tone: "emerald" },
  gaskets_seals:        { Icon: Layers,      tone: "emerald" },
  wipers:               { Icon: CloudRain,   tone: "emerald" },

  // Misc / shop (gray)
  exhaust_system:       { Icon: Wind,        tone: "gray" },
  air_intake:           { Icon: Wind,        tone: "gray" },
  workshop_tools:       { Icon: Wrench,      tone: "gray" },
  car_care:             { Icon: Sparkles,    tone: "gray" },
  service_materials:    { Icon: Package,     tone: "gray" },
};

/** Look up the visual for a category id. Returns undefined for
 *  unknown ids so the caller can fall back to the legacy iconPath. */
export const visualFor = (id: string): CategoryVisual | undefined =>
  CATEGORY_VISUAL[id];

/** Tone styles for a given tone key. Exported separately so CategoryCard
 *  can compose tone classes without re-exporting the whole TONES table. */
export const toneStyles = (tone: CategoryTone) => TONES[tone];
