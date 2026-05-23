#!/usr/bin/env node
/**
 * seed-categories.js — production migration that replaces
 * SiteContent.categories with a curated 34-category automotive catalog
 * built from the eBay Motors / RockAuto ISO Metadata taxonomy.
 *
 * Why a script (not a controller call):
 *
 *   The admin editor exists, but bootstrapping 34 categories × ~5 attrs
 *   each by hand is painful and error-prone. This script lets ops seed
 *   the canonical taxonomy in one atomic write, then admins tweak from
 *   there. Re-running is safe — it replaces categories wholesale.
 *
 * Guarantees:
 *
 *   • ATOMIC. Single findOneAndUpdate({_id:"main"}, {$set, $inc}, upsert).
 *     Either every category lands or none do. No partial state.
 *   • PRESERVES hero. We only $set `categories` (and bump `version`);
 *     the hero subdoc and any other future fields are untouched.
 *   • PRE-FLIGHT VALIDATION. Every attribute definition is checked
 *     against the SAME validator the admin save path uses
 *     (validateAttributeDefinition). The DB write is never attempted
 *     unless every row is clean.
 *   • STRICT OPTIONS PARSER. `parseOptions(csv)` rejects whitespace
 *     around commas, leading/trailing commas, empty tokens, and any
 *     token > 60 chars (Mongoose schema cap on attributeDefinition
 *     options entries). Keeps stored data in the canonical shape the
 *     frontend Zod-compiles into select enums.
 *
 * Global Automotive Attributes:
 *
 *   Three attributes are injected into every category EXCEPT
 *   `workshop_tools` and `service_materials` (which are not parts —
 *   they only get part_condition):
 *
 *     oem_number              text   required
 *     compatibility_status    select required (oem|aftermarket|used|…)
 *     part_condition          select required (new|used|refurbished|…)
 *
 * Run:
 *
 *   cd back-end && node scripts/seed-categories.js
 *   cd back-end && node scripts/seed-categories.js --dry-run
 *
 * Exit codes:
 *
 *   0 — wrote (or, with --dry-run, validated) successfully
 *   1 — validation or DB failure (nothing was written)
 */

import "dotenv/config";
import mongoose from "mongoose";
import SiteContent from "../Model/siteContent.model.js";
import { validateAttributeDefinition } from "../Service/productSchema.service.js";

// ── CLI ─────────────────────────────────────────────────────────────────
const args    = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");

// ── ANSI color helpers (no chalk dep) ──────────────────────────────────
const c = {
  gray:   (s) => `\x1b[90m${s}\x1b[0m`,
  red:    (s) => `\x1b[31m${s}\x1b[0m`,
  green:  (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan:   (s) => `\x1b[36m${s}\x1b[0m`,
  bold:   (s) => `\x1b[1m${s}\x1b[0m`,
};

// ────────────────────────────────────────────────────────────────────────
// 1) Strict CSV parser for `options` declarations
// ────────────────────────────────────────────────────────────────────────

/**
 * Parse "a,b,c" → ["a","b","c"] with strict spec validation.
 *
 * Rejects:
 *   • non-strings
 *   • leading or trailing whitespace
 *   • whitespace immediately around any comma (`a, b` or `a ,b`)
 *   • leading or trailing comma
 *   • empty tokens (double commas)
 *   • tokens longer than 60 chars (Mongoose maxlength on each option)
 */
const parseOptions = (csv, ctx) => {
  if (typeof csv !== "string") {
    throw new Error(`[${ctx}] options must be a string, got ${typeof csv}`);
  }
  if (csv !== csv.trim()) {
    throw new Error(`[${ctx}] options has leading/trailing whitespace: "${csv}"`);
  }
  if (/,\s/.test(csv) || /\s,/.test(csv)) {
    throw new Error(`[${ctx}] options has whitespace around a comma: "${csv}"`);
  }
  if (csv.startsWith(",") || csv.endsWith(",")) {
    throw new Error(`[${ctx}] options has leading/trailing comma: "${csv}"`);
  }
  if (csv.includes(",,")) {
    throw new Error(`[${ctx}] options has empty token (",,"): "${csv}"`);
  }
  const tokens = csv.split(",");
  for (const t of tokens) {
    if (t.length === 0) throw new Error(`[${ctx}] empty token in "${csv}"`);
    if (t.length > 60)  throw new Error(`[${ctx}] token "${t}" exceeds 60 chars (${t.length})`);
  }
  return tokens;
};

// ────────────────────────────────────────────────────────────────────────
// 2) Attribute factories — keep declarations terse & unambiguous
// ────────────────────────────────────────────────────────────────────────

const text = (key, label, { required = false } = {}) => ({
  key, label, type: "text", options: [], required,
});
const num = (key, label, { required = false } = {}) => ({
  key, label, type: "number", options: [], required,
});
const sel = (key, label, csv, { required = false } = {}) => ({
  key, label, type: "select",
  options: parseOptions(csv, `${key}.options`),
  required,
});

// ────────────────────────────────────────────────────────────────────────
// 3) Global Automotive Attributes
// ────────────────────────────────────────────────────────────────────────

const GLOBAL_ATTRIBUTES = [
  text("oem_number",
       "OEM код / Каталогийн дугаар", { required: true }),
  sel ("compatibility_status",
       "Нийцэх төрөл",
       "oem,aftermarket,used,remanufactured,refurbished",
       { required: true }),
  sel ("part_condition",
       "Эд ангийн нөхцөл",
       "new,used,refurbished,damaged,for_parts",
       { required: true }),
];

const TOOLS_AND_MATERIALS_GLOBALS = [
  sel("part_condition",
      "Эд ангийн нөхцөл",
      "new,used,refurbished,damaged,for_parts",
      { required: true }),
];

const SKIP_FULL_GLOBALS = new Set(["workshop_tools", "service_materials"]);

// ────────────────────────────────────────────────────────────────────────
// 4) Icon paths — small library reused across categories
//    (SVG path-d attribute, no <svg> wrapper. Stored in Mongo as-is.)
// ────────────────────────────────────────────────────────────────────────

const ICON = {
  brake:        "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm0-12.5c-2.49 0-4.5 2.01-4.5 4.5S9.51 16.5 12 16.5s4.5-2.01 4.5-4.5S14.49 7.5 12 7.5z",
  engine:       "M13 2v8h8c0-4.42-3.58-8-8-8zm-2 0C6.48 2.05 3 5.56 3 10c0 4.97 4.03 9 9 9s9-4.03 9-9h-9V2z",
  lighting:     "M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7z",
  suspension:   "M17 8C8 10 5.9 16.17 3.82 21.34L5.71 22l1-2.3A4.49 4.49 0 008 20c3 0 3-2 6-2s3 2 6 2v-2c-3 0-3-2-6-2-.52 0-.96.03-1.39.08C13.77 13.23 15.71 10.72 17 8zm0-4v3l3-3H17z",
  electric:     "M15.67 4H14V2h-4v2H8.33C7.6 4 7 4.6 7 5.33v15.33C7 21.4 7.6 22 8.33 22h7.33c.74 0 1.34-.6 1.34-1.33V5.33C17 4.6 16.4 4 15.67 4z",
  body:         "M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99z",
  transmission: "M22 9V7h-2V5c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-2h2v-2h-2v-2h2v-2h-2V9h2zm-4 10H4V5h14v14z",
  oils:         "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z",
  gear:         "M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.488.488 0 00-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54A.484.484 0 0013.92 2h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.47a.49.49 0 00.12.61L4.89 10.66c-.05.31-.07.63-.07.94 0 .31.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z",
  wrench:       "M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z",
  wheel:        "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z",
  filter:       "M4.25 5.61C6.27 8.2 10 13 10 13v6c0 .55.45 1 1 1h2c.55 0 1-.45 1-1v-6s3.72-4.8 5.74-7.39c.51-.66.04-1.61-.79-1.61H5.04c-.83 0-1.3.95-.79 1.61z",
  battery:      "M15.67 4H14V2h-4v2H8.33C7.6 4 7 4.6 7 5.33v15.33C7 21.4 7.6 22 8.33 22h7.33c.74 0 1.34-.6 1.34-1.33V5.33C17 4.6 16.4 4 15.67 4z",
  coolant:      "M17 5h-2V3H9v2H7c-1.1 0-2 .9-2 2v13c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zM7 19V7h10v12H7zm5-2.5l3-2.5h-2v-3h-2v3H9z",
  exhaust:      "M22 16.5l-4-2V11c0-.55-.45-1-1-1h-3V7h-2v3H9c-.55 0-1 .45-1 1v3.5l-4 2V20h18v-3.5zM6 18v-.27l4-2V12h4v3.73l4 2V18H6z",
  fuel:         "M19.77 7.23l.01-.01-3.72-3.72L15 4.56l2.11 2.11c-.94.36-1.61 1.26-1.61 2.33 0 1.38 1.12 2.5 2.5 2.5.36 0 .69-.08 1-.21v7.21c0 .55-.45 1-1 1s-1-.45-1-1V14c0-1.1-.9-2-2-2h-1V5c0-1.1-.9-2-2-2H6c-1.1 0-2 .9-2 2v16h10v-7.5h1.5v5c0 1.38 1.12 2.5 2.5 2.5s2.5-1.12 2.5-2.5V9c0-.69-.28-1.32-.73-1.77zM12 10H6V5h6v5z",
  spark:        "M14.59 8L12 10.59 9.41 8 8 9.41 10.59 12 8 14.59 9.41 16 12 13.41 14.59 16 16 14.59 13.41 12 16 9.41z",
  airIntake:    "M22 11h-4.17l3.24-3.24-1.41-1.42L15 11h-2V9l5.66-4.66-1.42-1.41L13 6.17V2h-2v4.17L7.76 2.93 6.34 4.34 11 9v2H9L4.34 6.34 2.93 7.76 6.17 11H2v2h4.17l-3.24 3.24 1.41 1.42L9 13h2v2l-5.66 4.66 1.42 1.41L11 17.83V22h2v-4.17l3.24 3.24 1.42-1.41L13 15v-2h2l4.66 4.66 1.41-1.42L15.83 13H22z",
  hvac:         "M22 5H2v6h2V7h16v4h2zM7 12.5C7 11.67 6.33 11 5.5 11S4 11.67 4 12.5 4.67 14 5.5 14 7 13.33 7 12.5zM18.5 11c-.83 0-1.5.67-1.5 1.5s.67 1.5 1.5 1.5 1.5-.67 1.5-1.5-.67-1.5-1.5-1.5zM19 15H5c-1.66 0-3 1.34-3 3v3h2v-3c0-.55.45-1 1-1h14c.55 0 1 .45 1 1v3h2v-3c0-1.66-1.34-3-3-3z",
  mirror:       "M21 3H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM5 17l3.5-4.5 2.5 3.01L14.5 11l4.5 6H5z",
  wiper:        "M4 22h2L18 4h-2zM4 17l5-1V8L4 7zm14-9v8l5 1V7z",
  sensor:       "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z",
  belt:         "M4 6h2v12H4zm14 0h2v12h-2zM8 6h8v12H8z",
  gasket:       "M12 2L4 5v6c0 5.55 3.84 10.74 8 12 4.16-1.26 8-6.45 8-12V5l-8-3zm0 4.5L18 9v2c0 4.42-3.05 8.42-6 9.93-2.95-1.51-6-5.51-6-9.93V9l6-2.5z",
  bearing:      "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 16c-3.31 0-6-2.69-6-6s2.69-6 6-6 6 2.69 6 6-2.69 6-6 6zm0-10c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4z",
  ecu:          "M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-8 14H7v-2h4v2zm0-4H7v-2h4v2zm0-4H7V7h4v2zm6 8h-4v-2h4v2zm0-4h-4v-2h4v2zm0-4h-4V7h4v2z",
  starter:      "M15.5 1h-8C6.12 1 5 2.12 5 3.5v17C5 21.88 6.12 23 7.5 23h8c1.38 0 2.5-1.12 2.5-2.5v-17C18 2.12 16.88 1 15.5 1zm-4 21c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm4.5-4H7V4h9v14z",
  radiator:     "M9 4H7v16h2V4zm4 0h-2v16h2V4zm4 0h-2v16h2V4zm4 0h-2v16h2V4z",
  shaft:        "M2 12h20v2H2zm0-4h20v2H2zm0 8h20v2H2z",
  fastener:     "M14.59 8L12 10.59 9.41 8 8 9.41 10.59 12 8 14.59 9.41 16 12 13.41 14.59 16 16 14.59 13.41 12 16 9.41z",
  lock:         "M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z",
  carCare:      "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z",
  material:     "M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10z",
};

// ────────────────────────────────────────────────────────────────────────
// 5) Catalog — 34 categories with their category-specific attributes.
//    Globals are merged below; the spec for each row only lists what's
//    unique to that category.
// ────────────────────────────────────────────────────────────────────────

const CATEGORIES_RAW = [
  // 1
  { id: "engine", name: "Хөдөлгүүр", iconPath: ICON.engine, order: 1, specific: [
    sel("engine_type",     "Хөдөлгүүрийн төрөл",     "petrol,diesel,hybrid,electric,gas,lpg,cng"),
    num("displacement_cc", "Эзлэхүүн (cc)"),
    sel("cylinder_count",  "Цилиндрийн тоо",         "1,2,3,4,5,6,8,10,12,16,rotary"),
    sel("aspiration",      "Агааржуулалтын систем",  "naturally_aspirated,turbo,supercharged,twin_turbo,electric"),
  ]},
  // 2
  { id: "gearbox_transmission", name: "Хурдны хайрцаг", iconPath: ICON.transmission, order: 2, specific: [
    sel("transmission_type", "Дамжуулгын төрөл",   "manual,automatic,cvt,dsg,amt,dct,tiptronic"),
    sel("gear_count",        "Шилжих хурдны тоо",  "4,5,6,7,8,9,10"),
    sel("drive_type",        "Хөтлөгчийн төрөл",   "fwd,rwd,awd,4wd,part_time_4wd"),
  ]},
  // 3
  { id: "brake", name: "Тоормосны систем", iconPath: ICON.brake, order: 3, specific: [
    sel("brake_part",     "Тоормосны эд анги",  "pad,disc,drum,caliper,fluid,hose,master_cylinder,booster,sensor"),
    sel("axle_position",  "Тэнхлэгийн байрлал", "front,rear,both"),
    sel("friction_grade", "Үрэлтийн зэрэглэл",  "organic,ceramic,semi_metallic,low_metallic,sintered"),
  ]},
  // 4
  { id: "suspension", name: "Амортизатор & Дүүжин", iconPath: ICON.suspension, order: 4, specific: [
    sel("suspension_part", "Дүүжингийн эд анги", "shock,strut,spring,control_arm,ball_joint,bushing,sway_bar,stabilizer_link"),
    sel("position",        "Байрлал",            "front,rear,front_left,front_right,rear_left,rear_right"),
    sel("damping_type",    "Хатгалтын төрөл",    "gas,oil,electronic,air,coilover"),
  ]},
  // 5
  { id: "steering", name: "Жолооны систем", iconPath: ICON.gear, order: 5, specific: [
    sel("steering_part", "Жолооны эд анги",  "rack,pump,tie_rod,column,wheel,pinion,reservoir,hose"),
    sel("steering_type", "Жолооны төрөл",    "hydraulic,electric,electro_hydraulic,manual"),
  ]},
  // 6
  { id: "electric", name: "Цахилгаан тоног", iconPath: ICON.electric, order: 6, specific: [
    sel("component_type", "Бүрэлдэхүүн", "wiring,fuse,relay,switch,connector,harness,terminal,grommet"),
    sel("voltage",        "Хүчдэл",      "12V,24V,48V"),
  ]},
  // 7
  { id: "lighting", name: "Гэрэлтүүлэг", iconPath: ICON.lighting, order: 7, specific: [
    sel("light_type",  "Гэрлийн төрөл", "headlight,taillight,fog,turn_signal,interior,brake_light,reverse,drl"),
    sel("bulb_type",   "Гэрлийн дэнлүү", "halogen,led,xenon,hid,incandescent,laser"),
    sel("position",    "Байрлал",        "front,rear,side,interior,roof"),
  ]},
  // 8
  { id: "body", name: "Бие & Гадаргуу", iconPath: ICON.body, order: 8, specific: [
    sel("body_part", "Биеийн эд анги",   "bumper,fender,hood,door,trunk,grille,panel,mirror_housing,spoiler"),
    sel("side",      "Тал",              "front_left,front_right,rear_left,rear_right,left,right,front,rear,center,top,bottom"),
    sel("material",  "Материал",         "plastic,steel,aluminum,fiberglass,carbon_fiber,abs"),
    sel("finish",    "Гадаргуу",         "painted,primed,bare,polished,textured"),
  ]},
  // 9
  { id: "interior", name: "Дотор засал", iconPath: ICON.body, order: 9, specific: [
    sel("interior_part", "Дотор эд анги", "seat,dashboard,carpet,headliner,trim,console,handle,seatbelt,armrest"),
    sel("material",      "Материал",      "leather,fabric,vinyl,plastic,suede,alcantara,wood"),
    text("color",        "Өнгө"),
  ]},
  // 10
  { id: "wheels_tires", name: "Дугуй & Дугуйн обуд", iconPath: ICON.wheel, order: 10, specific: [
    sel("wheel_size_inch", "Обудын хэмжээ (in)", "12,13,14,15,16,17,18,19,20,21,22,23,24,22.5"),
    sel("tire_season",     "Дугуйн улирал",      "summer,winter,all_season,studded,off_road,at_mt"),
    sel("rim_material",    "Обудын материал",    "steel,alloy,forged,carbon_fiber,magnesium"),
    text("tire_size",      "Дугуйн хэмжээ (Жишээ: 215/55)"),
  ]},
  // 11
  { id: "oils", name: "Тос & Тосолгоо", iconPath: ICON.oils, order: 11, specific: [
    sel("oil_type",     "Тосны зориулалт", "engine,transmission,brake,power_steering,coolant,differential,gear"),
    text("viscosity",   "Зуурамтгайн зэрэг (5W-30)"),
    num("volume_liter", "Эзлэхүүн (л)"),
    sel("base_type",    "Үндсэн төрөл",    "synthetic,semi_synthetic,mineral,racing"),
    text("api_grade",   "API зэрэглэл"),
    text("acea_grade",  "ACEA зэрэглэл"),
  ]},
  // 12
  { id: "filters", name: "Шүүлтүүр", iconPath: ICON.filter, order: 12, specific: [
    sel("filter_type",  "Шүүлтүүрийн төрөл",   "oil,air,fuel,cabin,transmission,hydraulic,pollen,dpf"),
    sel("filter_shape", "Шүүлтүүрийн хэлбэр",  "cylindrical,panel,spin_on,cartridge,inline"),
  ]},
  // 13
  { id: "cooling_system", name: "Хөргөлтийн систем", iconPath: ICON.coolant, order: 13, specific: [
    sel("cooling_part",  "Хөргөлтийн эд анги", "radiator,thermostat,water_pump,fan,hose,reservoir,cap,sensor"),
    sel("coolant_type",  "Хөргөлтийн шингэн",  "green,orange,pink,blue,red,yellow,purple"),
  ]},
  // 14
  { id: "exhaust_system", name: "Утааны систем", iconPath: ICON.exhaust, order: 14, specific: [
    sel("exhaust_part", "Утааны эд анги", "muffler,catalytic_converter,pipe,manifold,resonator,gasket,sensor,clamp"),
    sel("material",     "Материал",       "stainless_steel,aluminized,mild_steel,titanium"),
  ]},
  // 15
  { id: "fuel_system", name: "Түлшний систем", iconPath: ICON.fuel, order: 15, specific: [
    sel("fuel_part", "Түлшний эд анги", "pump,injector,filter,tank,rail,pressure_regulator,cap,line"),
    sel("fuel_type", "Түлшний төрөл",   "petrol,diesel,gas,e85,flex,lpg,cng"),
  ]},
  // 16
  { id: "ignition_system", name: "Асаалтын систем", iconPath: ICON.spark, order: 16, specific: [
    sel("ignition_part", "Асаалтын эд анги",       "spark_plug,coil,distributor,wire,glow_plug,module,cap,rotor"),
    text("thread_size",  "Резьбаны хэмжээ (Голч)"),
  ]},
  // 17
  { id: "air_intake", name: "Агаар оруулах систем", iconPath: ICON.airIntake, order: 17, specific: [
    sel("intake_part",      "Агаар оруулагч эд анги", "filter,throttle_body,maf_sensor,intake_manifold,hose,resonator,box"),
    sel("filter_material",  "Шүүлтүүрийн материал",   "paper,foam,cotton,synthetic,oiled"),
  ]},
  // 18
  { id: "ac_heating", name: "Агааржуулагч & Халаалт", iconPath: ICON.hvac, order: 18, specific: [
    sel("hvac_part",         "Агааржуулагчийн эд анги", "compressor,condenser,evaporator,heater_core,blower,expansion_valve,dryer,hose"),
    sel("refrigerant_type",  "Хөргөгчийн төрөл",        "r134a,r1234yf,r12,r410a"),
  ]},
  // 19
  { id: "mirrors_glass", name: "Толь & Шил", iconPath: ICON.mirror, order: 19, specific: [
    sel("glass_part", "Шилэн эд анги", "windshield,side_window,rear_window,mirror_glass,sunroof,quarter_glass"),
    sel("feature",    "Онцлог",        "heated,tinted,electric,manual,auto_dimming,rain_sensor,defrost"),
  ]},
  // 20
  { id: "wipers", name: "Шил арчигч", iconPath: ICON.wiper, order: 20, specific: [
    sel("wiper_part", "Арчигчийн эд анги", "blade,arm,motor,washer_pump,nozzle,reservoir,linkage"),
    sel("position",   "Байрлал",           "front,rear,both,headlight"),
    num("length_mm",  "Уртаар (мм)"),
  ]},
  // 21
  { id: "sensors", name: "Мэдрэгчүүд", iconPath: ICON.sensor, order: 21, specific: [
    sel("sensor_type", "Мэдрэгчийн төрөл", "oxygen,maf,map,crankshaft,camshaft,abs,parking,tire_pressure,knock,coolant_temp"),
    sel("signal_type", "Дохионы төрөл",    "analog,digital,pwm,can_bus,lin_bus"),
  ]},
  // 22
  { id: "belts_hoses", name: "Бүс & Гуурс", iconPath: ICON.belt, order: 22, specific: [
    sel("part_type", "Эд ангийн төрөл", "timing_belt,serpentine_belt,v_belt,radiator_hose,fuel_hose,vacuum_hose,brake_hose"),
    num("length_mm", "Уртаар (мм)"),
  ]},
  // 23
  { id: "gaskets_seals", name: "Гасет & Битүүмжлэгч", iconPath: ICON.gasket, order: 23, specific: [
    sel("gasket_type", "Гасетын төрөл", "head,intake,exhaust,oil_pan,valve_cover,water_pump,timing_cover,differential"),
    sel("material",    "Материал",      "rubber,cork,paper,metal,silicone,composite,graphite"),
  ]},
  // 24
  { id: "bearings", name: "Холхивч & Бушинг", iconPath: ICON.bearing, order: 24, specific: [
    sel("bearing_type", "Холхивчийн төрөл", "wheel,clutch,pilot,thrust,roller,ball,needle,tapered"),
    sel("position",     "Байрлал",          "front,rear,left,right,top,bottom,inner,outer"),
  ]},
  // 25
  { id: "ecu_electronics", name: "ECU & Удирдлагын модуль", iconPath: ICON.ecu, order: 25, specific: [
    sel("module_type",            "Модулийн төрөл",       "engine_ecu,transmission_ecu,abs_module,airbag_module,bcm,immobilizer,instrument_cluster"),
    sel("programming_required",   "Программчлал шаардах", "yes,no,optional"),
  ]},
  // 26
  { id: "battery", name: "Батарей", iconPath: ICON.battery, order: 26, specific: [
    sel("battery_type",       "Батарейн төрөл",     "lead_acid,agm,gel,lithium_ion,efb"),
    num("capacity_ah",        "Багтаамж (Ah)"),
    num("cca",                "Хүйтэн асаалтын ток (CCA)"),
    sel("terminal_position",  "Туйлын байрлал",     "left,right,top,front"),
  ]},
  // 27
  { id: "starter_alternator", name: "Стартер & Генератор", iconPath: ICON.starter, order: 27, specific: [
    sel("part_type",  "Эд ангийн төрөл", "starter,alternator,solenoid,brush,regulator,pulley"),
    num("output_amp", "Гарах ток (А)"),
    sel("rotation",   "Эргэлт",          "cw,ccw,reversible"),
  ]},
  // 28
  { id: "radiator", name: "Радиатор & Хөргөлт", iconPath: ICON.radiator, order: 28, specific: [
    sel("radiator_part", "Радиаторын эд анги", "radiator,intercooler,oil_cooler,fan_shroud,cap,tank"),
    sel("core_material", "Үндсэн материал",    "aluminum,copper_brass,plastic"),
  ]},
  // 29
  { id: "drive_shafts", name: "Тэнхлэг, Хөтлөгч гол / Гранат", iconPath: ICON.shaft, order: 29, specific: [
    sel("shaft_part", "Эд анги",  "cv_joint,axle,driveshaft,boot,bearing,u_joint,carrier_bearing"),
    sel("position",   "Байрлал",  "front,rear,left,right,inner,outer"),
  ]},
  // 30
  { id: "fasteners", name: "Боолт & Шураг", iconPath: ICON.fastener, order: 30, specific: [
    sel("fastener_type", "Боолтны төрөл",            "bolt,nut,washer,screw,clip,rivet,stud,pin"),
    text("thread_pitch", "Резьбаны алхам (Pitch)"),
  ]},
  // 31
  { id: "lock_systems", name: "Цоожны эд анги", iconPath: ICON.lock, order: 31, specific: [
    sel("lock_part", "Цоожны эд анги", "door_lock,ignition_lock,trunk_lock,fuel_cap_lock,steering_lock,actuator,cylinder"),
    sel("key_type",  "Түлхүүрийн төрөл", "mechanical,transponder,smart_key,remote,keyless"),
  ]},
  // 32
  { id: "car_care", name: "Машины асаргааны бараа", iconPath: ICON.carCare, order: 32, specific: [
    sel("product_type", "Бүтээгдэхүүний төрөл", "wax,polish,shampoo,degreaser,leather_care,glass_cleaner,tire_shine,plastic_restorer"),
    num("volume_ml",    "Эзлэхүүн (мл)"),
  ]},
  // 33  — tools (NO global oem/compat; only part_condition)
  { id: "workshop_tools", name: "Засварын багаж", iconPath: ICON.wrench, order: 33, specific: [
    sel("tool_type",  "Багажны төрөл", "wrench,socket,screwdriver,hammer,pliers,jack,diagnostic_scanner,torque_wrench,multimeter"),
    sel("drive_size", "Хөдөлгөгч хэмжээ", "1_4_inch,3_8_inch,1_2_inch,3_4_inch,1_inch"),
    sel("power_type", "Хөдөлгөгч", "manual,electric,pneumatic,hydraulic,battery"),
  ]},
  // 34  — service materials (NO global oem/compat; only part_condition)
  { id: "service_materials", name: "Үйлчилгээний материал", iconPath: ICON.material, order: 34, specific: [
    sel("material_type",     "Материалын төрөл", "grease,sealant,thread_lock,cleaner,degreaser,solder,tape,adhesive,lubricant"),
    text("volume_or_weight", "Эзлэхүүн / Жин"),
  ]},
];

// ────────────────────────────────────────────────────────────────────────
// 6) Merge globals + specific → final attributesSchema
// ────────────────────────────────────────────────────────────────────────

const buildAttributesSchema = (categoryId, specific) => {
  const globals = SKIP_FULL_GLOBALS.has(categoryId)
    ? TOOLS_AND_MATERIALS_GLOBALS
    : GLOBAL_ATTRIBUTES;
  return [...globals, ...specific];
};

const buildCategories = () => CATEGORIES_RAW.map(({ id, name, iconPath, order, specific }) => ({
  id,
  name,
  iconPath,
  order,
  visible: true,
  attributesSchema: buildAttributesSchema(id, specific),
}));

// ────────────────────────────────────────────────────────────────────────
// 7) Pre-flight validation — abort BEFORE touching the DB
// ────────────────────────────────────────────────────────────────────────

const preflight = (categories) => {
  const errors = [];
  const seenCatIds = new Set();

  if (categories.length !== 34) {
    errors.push(`Expected 34 categories, got ${categories.length}`);
  }

  for (const cat of categories) {
    if (!cat.id || !cat.name || !cat.iconPath) {
      errors.push(`Category "${cat.id || "?"}": missing id/name/iconPath`);
      continue;
    }
    if (seenCatIds.has(cat.id)) {
      errors.push(`Duplicate category id: "${cat.id}"`);
    }
    seenCatIds.add(cat.id);

    // Each attr must pass the same gate the admin save uses.
    const attrSeen = new Set();
    cat.attributesSchema.forEach((attr, idx) => {
      const reason = validateAttributeDefinition(attr);
      if (reason) {
        errors.push(`Category "${cat.id}" attr #${idx + 1} (${attr.key || "?"}): ${reason}`);
      }
      const k = String(attr.key || "").toLowerCase();
      if (attrSeen.has(k)) {
        errors.push(`Category "${cat.id}" attr "${k}": duplicate key`);
      }
      attrSeen.add(k);
    });
  }
  return errors;
};

// ────────────────────────────────────────────────────────────────────────
// 8) Main
// ────────────────────────────────────────────────────────────────────────

const run = async () => {
  console.log(c.bold("\n  HiCar — seed-categories.js"));
  console.log(c.gray(`  mode: ${DRY_RUN ? "DRY RUN (no DB write)" : "LIVE"}`));
  console.log("");

  // Build (this also re-runs parseOptions at construction time, so any
  // bad CSV literal in this file blows up immediately with a clear ctx.)
  let categories;
  try {
    categories = buildCategories();
  } catch (err) {
    console.error(c.red("✗ Catalog construction failed:"), err.message);
    process.exit(1);
  }

  // Pre-flight
  const errors = preflight(categories);
  if (errors.length > 0) {
    console.error(c.red(`✗ Pre-flight validation found ${errors.length} error(s):`));
    errors.forEach((e) => console.error(c.red("   • ") + e));
    process.exit(1);
  }

  // Summary
  const totalAttrs = categories.reduce((a, c) => a + c.attributesSchema.length, 0);
  console.log(c.green(`  ✓ ${categories.length} categories, ${totalAttrs} attribute definitions, all valid.`));
  console.log("");
  categories.forEach((cat) => {
    const tag = SKIP_FULL_GLOBALS.has(cat.id) ? c.yellow(" (tools)") : "";
    console.log(
      "  " + c.cyan(String(cat.order).padStart(2)) + ". " +
      c.bold(cat.id.padEnd(22)) + " " +
      c.gray(cat.name.padEnd(32)) + " " +
      c.gray(`${cat.attributesSchema.length} attrs`) + tag,
    );
  });
  console.log("");

  if (DRY_RUN) {
    console.log(c.yellow("  --dry-run: skipping DB write."));
    process.exit(0);
  }

  // DB write
  if (!process.env.MONGO_URI) {
    console.error(c.red("✗ MONGO_URI is not set. Aborting."));
    process.exit(1);
  }

  try {
    const safeUri = (process.env.MONGO_URI || "").replace(/\/\/[^@]+@/, "//***@");
    console.log(c.gray(`  Connecting to ${safeUri}…`));
    await mongoose.connect(process.env.MONGO_URI);

    // Atomic replace. We $set categories wholesale and $inc version.
    // hero, updatedBy, createdAt, and any future top-level fields are
    // untouched. upsert handles the first-ever-write case.
    const result = await SiteContent.findOneAndUpdate(
      { _id: "main" },
      {
        $set: { categories },
        $inc: { version: 1 },
        $setOnInsert: { _id: "main" },
      },
      {
        new: true,
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      },
    );

    console.log("");
    console.log(c.green("  ✓ SiteContent.categories written."));
    console.log("    " + c.bold("doc version: ") + result.version);
    console.log("    " + c.bold("categories:  ") + result.categories.length);
    console.log("    " + c.bold("hero kept:   ") + (result.hero ? "yes" : "no"));
    console.log("");
    console.log(c.gray("  Frontend cache:"));
    console.log(c.gray("    • Public /api/site-content/categories has a 60s CDN cache."));
    console.log(c.gray("    • Admin editor's invalidateCategoriesCache() busts the in-mem cache"));
    console.log(c.gray("      on next save; or restart Next.js to flush immediately."));
    console.log("");

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error(c.red("✗ DB write failed:"), err.message);
    if (err.errors) {
      // Mongoose ValidationError — surface each sub-field
      Object.entries(err.errors).forEach(([path, e]) => {
        console.error(c.red("   • ") + path + ": " + (e.message || e));
      });
    }
    try { await mongoose.disconnect(); } catch { /* ignore */ }
    process.exit(1);
  }
};

run().catch((err) => {
  console.error(c.red("✗ Uncaught:"), err);
  process.exit(1);
});
