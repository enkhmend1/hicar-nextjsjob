#!/usr/bin/env node
/**
 * Phase A smoke test — pure-function checks for the role-based AI gateway.
 *
 * Validates (no DB / no LLM calls):
 *   ① deriveAiRole(user) maps role correctly + defaults to "user"
 *   ② buildRoleScope strips admin tools for non-admin
 *   ③ sanitizeProduct hides costPrice / stockQty from USER scope
 *   ④ detectWrongPersonaCommand catches admin commands in USER role
 *   ⑤ vagueQueryFormFor returns the right disambiguation form
 *   ⑥ buildSystemPrompt includes vehicleContext when present
 *   ⑦ inferLayoutFromTools picks the right layout per tool
 */

import {
  deriveAiRole, buildRoleScope, sanitizeProduct,
  detectWrongPersonaCommand, isToolAllowed,
} from "../Service/aiRole.service.js";
import { buildSystemPrompt } from "../Service/aiPrompts.service.js";
import { inferLayoutFromTools, vagueQueryFormFor } from "../Service/aiResponse.service.js";
import { __internal as sellerInternal } from "../Service/sellerInsights.service.js";
import { __internal as adminInternal } from "../Service/adminInsights.service.js";
import { correctOemCode, normalizeForMatch, __internal as ocrInternal } from "../Service/ocrFuzzy.service.js";
import { __internal as importInternal } from "../Service/importPreview.service.js";

const log = (tag, msg) => console.log(`[${tag}] ${msg}`);
let pass = 0, fail = 0;
const assert = (cond, label) => {
  if (cond) { pass++; log("✓", label); }
  else      { fail++; log("✗", label); }
};

// ────────────────────────────────────────────────────────────────────
// ① Role derivation
// ────────────────────────────────────────────────────────────────────
assert(deriveAiRole(null) === "user",                "anonymous → user");
assert(deriveAiRole({ role: "user" }) === "user",    "explicit user → user");
assert(deriveAiRole({ role: "seller" }) === "seller","seller → seller");
assert(deriveAiRole({ role: "admin" }) === "admin",  "admin → admin");
assert(deriveAiRole({ role: "hacker" }) === "user",  "unknown role defaults to user (no escalation)");

// ────────────────────────────────────────────────────────────────────
// ② Scope tool filtering
// ────────────────────────────────────────────────────────────────────
const userScope   = buildRoleScope("user", null);
const sellerScope = buildRoleScope("seller", { _id: "abc" });
const adminScope  = buildRoleScope("admin", { _id: "z9" });

assert(!isToolAllowed(userScope, "get_low_stock"),         "user CANNOT call get_low_stock");
assert(!isToolAllowed(userScope, "get_sales_summary"),     "user CANNOT call get_sales_summary");
assert( isToolAllowed(userScope, "search_products"),       "user CAN call search_products");
assert( isToolAllowed(userScope, "search_vehicle_parts"),  "user CAN call search_vehicle_parts");

assert(!isToolAllowed(sellerScope, "get_sales_summary"),   "seller CANNOT call admin-only sales summary");
assert( isToolAllowed(sellerScope, "get_low_stock"),       "seller CAN call low_stock");
assert( isToolAllowed(sellerScope, "get_deadstock"),       "seller CAN call deadstock (Phase B)");

assert( isToolAllowed(adminScope, "get_sales_summary"),    "admin CAN call sales summary");
assert( isToolAllowed(adminScope, "get_market_gaps"),      "admin CAN call market_gaps");

// Verify productFilter is locked down per role
assert(JSON.stringify(userScope.productFilter)   === JSON.stringify({ status: "approved" }), "user productFilter is approved-only");
assert(sellerScope.productFilter.seller === "abc",                                            "seller productFilter is scoped to own _id");
assert(JSON.stringify(adminScope.productFilter) === "{}",                                     "admin productFilter is unrestricted");

// ────────────────────────────────────────────────────────────────────
// ③ Product sanitization
// ────────────────────────────────────────────────────────────────────
const fullProduct = {
  _id: "p1", name: "Brake pad", brand: "Toyota", price: 50000, oem: "04465-02220",
  category: "brake", stockQty: 12, costPrice: 32000, warehouseLocation: "B-3",
  supplierInfo: { name: "Secret Co", contactPhone: "+976 99..." },
  images: ["x.jpg"], inStock: true, fitments: [],
};

const userView   = sanitizeProduct(fullProduct, userScope);
const sellerView = sanitizeProduct(fullProduct, sellerScope);
const adminView  = sanitizeProduct(fullProduct, adminScope);

assert(userView.id === "p1" && userView.name === "Brake pad", "user view keeps id+name");
assert(userView.costPrice === undefined,                       "user view HIDES costPrice");
assert(userView.warehouseLocation === undefined,               "user view HIDES warehouseLocation");
assert(userView.supplierInfo === undefined,                    "user view HIDES supplierInfo");
assert(userView.stockQty === undefined,                        "user view collapses stockQty");
assert(userView.inStock === true,                              "user view keeps inStock boolean");

assert(sellerView.costPrice === 32000,                         "seller view shows costPrice");
assert(sellerView.warehouseLocation === "B-3",                 "seller view shows warehouseLocation");
assert(sellerView.stockQty === 12,                             "seller view shows exact stock count");

assert(adminView.costPrice === 32000 && adminView.supplierInfo, "admin view shows everything");

// ────────────────────────────────────────────────────────────────────
// ④ Wrong-persona detection
// ────────────────────────────────────────────────────────────────────
assert(detectWrongPersonaCommand("today's sales", "user") !== null,   "user typing 'today's sales' is blocked");
assert(detectWrongPersonaCommand("өнөөдрийн борлуулалт", "user") !== null, "MN: borluulalt blocked for user");
assert(detectWrongPersonaCommand("low stock", "user") !== null,       "user typing 'low stock' is blocked");
assert(detectWrongPersonaCommand("Toyota Camry-ийн тоормосны бул", "user") === null, "innocent search is NOT blocked");
assert(detectWrongPersonaCommand("today's sales", "admin") === null,  "admin can ask for sales freely");

// ────────────────────────────────────────────────────────────────────
// ⑤ Vague-query disambiguation forms
// ────────────────────────────────────────────────────────────────────
assert(vagueQueryFormFor("тоормос")?.partType === "Тоормос",        "тоормос → brake form");
assert(vagueQueryFormFor("фар")?.partType === "Гэрэлтүүлэг",        "фар → lighting form");
assert(vagueQueryFormFor("амортизатор")?.partType === "Амортизатор","амортизатор → suspension form");
assert(vagueQueryFormFor("масло")?.partType === "Тос",              "масло → oils form");
assert(vagueQueryFormFor("батарей")?.partType === "Батарей",        "батарей → battery form");
assert(vagueQueryFormFor("xyz") === null,                            "unknown vague keyword returns null");

const brakeForm = vagueQueryFormFor("тоормос");
assert(brakeForm.fields.some((f) => f.key === "axle"),  "brake form asks about axle");
assert(brakeForm.fields.some((f) => f.key === "part_type"), "brake form asks about part_type");

// ────────────────────────────────────────────────────────────────────
// ⑥ System-prompt assembly with vehicleContext
// ────────────────────────────────────────────────────────────────────
const promptNoVehicle = buildSystemPrompt({ role: "user", locale: "mn" });
const promptWithVehicle = buildSystemPrompt({
  role: "user", locale: "mn",
  vehicleContext: { manufacturer: "Toyota", model: "Blade", generation: "AZE156", engineCode: "2AZ-FE" },
});

assert(promptNoVehicle.includes("HiCar AI Mechanic"),       "user prompt mentions persona");
assert(promptNoVehicle.includes("admin"),                   "user prompt warns about admin commands");
assert(!promptNoVehicle.includes("Make: Toyota"),           "no-vehicle prompt does NOT inject vehicle block");
assert(promptWithVehicle.includes("Make: Toyota"),          "vehicle prompt injects Make");
assert(promptWithVehicle.includes("Model: Blade"),          "vehicle prompt injects Model");
assert(promptWithVehicle.includes("Chassis/Generation: AZE156"), "vehicle prompt injects Generation");
assert(promptWithVehicle.includes("Engine code: 2AZ-FE"),   "vehicle prompt injects engine code");

const sellerPrompt = buildSystemPrompt({ role: "seller", locale: "mn" });
assert(sellerPrompt.includes("Inventory Optimizer"),        "seller persona prompt is loaded");
assert(sellerPrompt.includes("costPrice"),                  "seller prompt mentions costPrice access");

const adminPrompt = buildSystemPrompt({ role: "admin", locale: "mn" });
assert(adminPrompt.includes("Strategy AI"),                 "admin persona prompt is loaded");
assert(adminPrompt.includes("UNRESTRICTED"),                "admin prompt declares unrestricted access");

// ────────────────────────────────────────────────────────────────────
// ⑦ Layout inference per tool name
// ────────────────────────────────────────────────────────────────────
assert(inferLayoutFromTools([{ name: "search_products", result: { items: [{ id: 1 }] } }]).layout === "user_cards", "search_products → user_cards");
assert(inferLayoutFromTools([{ name: "search_vehicle_parts", result: { items: [], crossRefs: [] } }]).layout === "user_cards", "search_vehicle_parts → user_cards");
assert(inferLayoutFromTools([{ name: "get_low_stock", result: { columns: ["X"], rows: [[1]] } }]).layout === "seller_table", "get_low_stock → seller_table");
assert(inferLayoutFromTools([{ name: "get_sales_summary", result: { kind: "kpi_grid", data: {} } }]).layout === "admin_widget", "get_sales_summary → admin_widget");
assert(inferLayoutFromTools([{ name: "disambiguate_vague_query", result: { partType: "Тоормос", fields: [] } }]).layout === "diag_form", "disambiguate_vague_query → diag_form");
assert(inferLayoutFromTools([{ name: "cross_reference_oem", result: { equivalents: [] } }]).layout === "user_cards", "cross_reference_oem → user_cards (with crossRefs)");
assert(inferLayoutFromTools([]).layout === "plain",                                                                         "no tools → plain");

// ────────────────────────────────────────────────────────────────────
// ⑧ Phase B — new layout inference + seller tool surfaces
// ────────────────────────────────────────────────────────────────────
assert(inferLayoutFromTools([{ name: "get_deadstock", result: { columns: ["A"], rows: [] } }]).layout === "seller_table", "get_deadstock → seller_table");
assert(inferLayoutFromTools([{ name: "find_shelf_location", result: { columns: ["A"], rows: [] } }]).layout === "seller_table", "find_shelf_location → seller_table");
assert(inferLayoutFromTools([{ name: "generate_quotation", result: { quoteId: "HC-QT-260524-A1B2", bodyText: "...", summary: { total: 1000 } } }]).layout === "quotation", "generate_quotation → quotation");

// MNT formatter sanity
assert(sellerInternal.MNT(1250000) === "₮1,250,000",   "MNT formatter groups Mongolian style");
assert(sellerInternal.MNT(0)        === "₮0",            "MNT formatter handles zero");
assert(sellerInternal.MNT(null)     === "₮0",            "MNT formatter handles null");

// Revenue-status whitelist
assert(sellerInternal.REVENUE_STATUSES.includes("paid"),     "REVENUE_STATUSES includes paid");
assert(sellerInternal.REVENUE_STATUSES.includes("delivered"),"REVENUE_STATUSES includes delivered");
assert(!sellerInternal.REVENUE_STATUSES.includes("pending"), "REVENUE_STATUSES excludes pending");
assert(!sellerInternal.REVENUE_STATUSES.includes("cancelled"),"REVENUE_STATUSES excludes cancelled");

// Seller scope now exposes Phase B tools
assert(isToolAllowed(sellerScope, "get_deadstock"),         "seller CAN call get_deadstock");
assert(isToolAllowed(sellerScope, "find_shelf_location"),   "seller CAN call find_shelf_location");
assert(isToolAllowed(sellerScope, "generate_quotation"),    "seller CAN call generate_quotation");
assert(!isToolAllowed(userScope,   "get_deadstock"),        "user CANNOT call get_deadstock");
assert(!isToolAllowed(userScope,   "find_shelf_location"),  "user CANNOT call find_shelf_location");
assert(!isToolAllowed(userScope,   "generate_quotation"),   "user CANNOT call generate_quotation");

// ────────────────────────────────────────────────────────────────────
// ⑨ Phase C — admin BI tools + layout inference + helper math
// ────────────────────────────────────────────────────────────────────
assert(isToolAllowed(adminScope, "get_financial_metrics"),   "admin CAN call get_financial_metrics");
assert(isToolAllowed(adminScope, "get_demand_forecast"),     "admin CAN call get_demand_forecast");
assert(isToolAllowed(adminScope, "get_market_gaps"),         "admin CAN call get_market_gaps");
assert(!isToolAllowed(userScope,   "get_financial_metrics"), "user CANNOT call get_financial_metrics");
assert(!isToolAllowed(userScope,   "get_demand_forecast"),   "user CANNOT call get_demand_forecast");
assert(!isToolAllowed(userScope,   "get_market_gaps"),       "user CANNOT call get_market_gaps");
assert(!isToolAllowed(sellerScope, "get_financial_metrics"), "seller CANNOT call get_financial_metrics");
assert(!isToolAllowed(sellerScope, "get_demand_forecast"),   "seller CANNOT call get_demand_forecast");
assert(!isToolAllowed(sellerScope, "get_market_gaps"),       "seller CANNOT call get_market_gaps");

// Layout inference for the new tools
assert(inferLayoutFromTools([{ name: "get_financial_metrics", result: { kind: "kpi_grid", data: { revenue: 1000 } } }]).layout === "admin_widget", "get_financial_metrics → admin_widget");
assert(inferLayoutFromTools([{ name: "get_demand_forecast", result: { kind: "bar_chart", data: { x: [], y: [] } } }]).layout === "admin_widget",  "get_demand_forecast → admin_widget");
assert(inferLayoutFromTools([{ name: "get_market_gaps", result: { kind: "bar_chart", data: { x: [], y: [] } } }]).layout === "admin_widget",      "get_market_gaps → admin_widget");

// Layout passes through whatever `kind` the tool returned
const fmEnvelope = inferLayoutFromTools([{ name: "get_financial_metrics", result: { kind: "kpi_grid", title: "Sales", data: { x: 1 } } }]);
assert(fmEnvelope.payload.kind === "kpi_grid",  "envelope keeps tool's chart kind");
assert(fmEnvelope.payload.title === "Sales",    "envelope keeps tool's title");

// periodToSince math
const today = adminInternal.periodToSince("today");
assert(today instanceof Date && today.getHours() === 0,    "periodToSince('today') is midnight today");
const week  = adminInternal.periodToSince("week");
assert(week instanceof Date && (Date.now() - week.getTime()) > 6 * 24 * 3600 * 1000, "periodToSince('week') ≈ 7 days ago");
assert(adminInternal.periodToSince("all") === null,        "periodToSince('all') = null (no bound)");

// normaliseSearchQuery for market-gap clustering
const ns = adminInternal.normaliseSearchQuery;
assert(ns("ФАР!!!") === "фар",                                          "normalise strips punctuation + lowercases");
assert(ns("  Toyota   Camry  ") === "toyota camry",                     "normalise collapses whitespace + trims");
assert(ns("brake pad?") === "brake pad",                                "normalise strips trailing ?");
assert(ns("Brake Pad") === ns("brake pad"),                             "normalise is case-insensitive");

// REVENUE_STATUSES sync between admin + seller
assert(JSON.stringify(adminInternal.REVENUE_STATUSES) === JSON.stringify(sellerInternal.REVENUE_STATUSES),
       "admin + seller services share REVENUE_STATUSES list");

// ────────────────────────────────────────────────────────────────────
// ⑩ Phase D — OEM fuzzy correction
// ────────────────────────────────────────────────────────────────────

// Normalization
assert(normalizeForMatch("  43512-1261O ") === "43512-1261O",  "normalize strips whitespace + uppercases");
assert(normalizeForMatch("06430 S5A J5O")  === "06430S5AJ5O",  "normalize strips internal whitespace");
assert(normalizeForMatch("foo.bar-baz")    === "FOOBAR-BAZ",   "normalize strips non-alphanumeric punctuation (dot), keeps letters + dashes");

// Spec example: 43512-1261O → 43512-12610 (Toyota auto-correct)
const r1 = correctOemCode("43512-1261O");
assert(r1.corrected === "43512-12610",  "spec example: 43512-1261O → 43512-12610");
assert(r1.brand === "Toyota",           "spec example: brand identified as Toyota");
assert(r1.edits === 1,                  "spec example: exactly 1 substitution");
assert(r1.rule === "substituted",       "spec example: marked as substituted");

// Clean Toyota OEM stays exact (no spurious edits)
const r2 = correctOemCode("04465-02220");
assert(r2.corrected === "04465-02220",  "clean Toyota OEM kept as-is");
assert(r2.confidence === 1,             "clean OEM gets confidence 1.0");
assert(r2.edits === 0,                  "clean OEM gets zero edits");
assert(r2.rule === "exact",             "clean OEM rule = exact");

// Two-edit fix: 43512-126IO → 43512-12610 (I→1, O→0)
const r3 = correctOemCode("43512-126IO");
assert(r3.corrected === "43512-12610",  "two-edit fix: 43512-126IO → 43512-12610");
assert(r3.brand === "Toyota",           "two-edit fix: still Toyota");
assert(r3.edits === 2,                  "two-edit fix: 2 substitutions");

// Honda 5-3-3
const r4 = correctOemCode("06430-S5A-J50");
assert(r4.brand === "Honda",            "Honda 5-3-3 pattern matched");
assert(r4.edits === 0,                  "Honda OEM = exact match");

// Bosch — 10 digits starting with 0
const r5 = correctOemCode("0986478853");
assert(r5.brand === "Bosch",            "Bosch 10-digit pattern matched");

// Nissan letter-allowing pattern works on legitimate Nissan code
const r6 = correctOemCode("41060-EG085");
assert(r6.brand === "Nissan",           "legit Nissan letter+digits pattern matched");

// Garbage stays as-is with low confidence
const rG = correctOemCode("GARBAGE");
assert(rG.confidence === 0.3,           "garbage gets sentinel 0.3 confidence");
assert(rG.requiresReview === true,      "garbage requires review");
assert(rG.brand === null,               "garbage has no brand");

// SUBSTITUTIONS table sanity
assert(ocrInternal.SUBSTITUTIONS.O.includes("0"),  "O ↔ 0 in substitution table");
assert(ocrInternal.SUBSTITUTIONS["0"].includes("O"),"0 ↔ O bidirectional");
assert(ocrInternal.SUBSTITUTIONS.I.includes("1"),  "I → 1 in substitution table");
assert(ocrInternal.SUBSTITUTIONS.B.includes("8"),  "B → 8 in substitution table");

// MAX_VARIANTS safety valve
assert(ocrInternal.MAX_VARIANTS >= 64 && ocrInternal.MAX_VARIANTS <= 1024,
       "MAX_VARIANTS keeps the BFS bounded but useful");

// ────────────────────────────────────────────────────────────────────
// ⑪ Phase D — conflict detector + suggested action
// ────────────────────────────────────────────────────────────────────

// suggestAction matrix
const sa = importInternal.suggestAction;
assert(sa({ existing: null, newPrice: 100, newStock: 5 }) === "create",
       "no existing → create");
assert(sa({ existing: { price: 100, stockQty: 5 }, newPrice: 100, newStock: 5 }) === "skip",
       "identical price+stock → skip");
assert(sa({ existing: { price: 100, stockQty: 5 }, newPrice: 100, newStock: 10 }) === "merge_stock",
       "stock changed only → merge_stock");
assert(sa({ existing: { price: 100, stockQty: 5 }, newPrice: 110, newStock: 8 }) === "merge_stock",
       "small price drift (10%) → merge_stock");
assert(sa({ existing: { price: 100, stockQty: 5 }, newPrice: 200, newStock: 8 }) === "review",
       "huge price jump (>30%) → review (force seller decision)");

// annotateConflict shape
const conf = importInternal.annotateConflict(
  { price: 65000, stock: 20 },
  { _id: "p1", name: "Pad", price: 50000, stockQty: 12, status: "approved" },
);
assert(conf.existingId === "p1",      "conflict carries existingId");
assert(conf.existingPrice === 50000,  "conflict shows existingPrice");
assert(conf.incomingPrice === 65000,  "conflict shows incomingPrice");
assert(conf.priceDelta === 15000,     "conflict computes priceDelta");
assert(conf.priceDeltaPct === 30,     "conflict computes priceDeltaPct (30%)");
assert(conf.stockDelta === 8,         "conflict computes stockDelta (+8)");
assert(conf.suggestedAction === "merge_stock", "30% drift = boundary → merge_stock (not review)");

// compositeConfidence — uses MIN of OCR + enrichment scores
assert(importInternal.compositeConfidence(0.9, 0.6) === 0.6,
       "composite confidence takes the lower signal");
assert(importInternal.compositeConfidence(0.5, undefined) === 0.5,
       "composite handles missing enrichment confidence");

// PRICE_DRIFT_TOLERANCE constant
assert(importInternal.PRICE_DRIFT_TOLERANCE === 0.05,
       "price drift tolerance is ±5%");

// ────────────────────────────────────────────────────────────────────
// Summary
// ────────────────────────────────────────────────────────────────────
console.log("");
console.log(`Pass: ${pass}   Fail: ${fail}`);
process.exit(fail === 0 ? 0 : 1);
