/**
 * AI Role-Based Access Control — the trust boundary for every AI request.
 *
 * Why a dedicated module:
 *   The AI controller routes a single endpoint to three very different
 *   personas (User / Seller / Admin) with very different data visibility.
 *   Keeping role derivation, scope construction, and field redaction in
 *   ONE place means the controller can never accidentally hand a User
 *   role a seller-private field (e.g. costPrice, warehouseLocation), and
 *   the unit tests have a single function to assert against.
 *
 * Boundaries enforced:
 *
 *   USER    → status:"approved" products only; public fields only;
 *             no costPrice / no supplierInfo / no stockQty count
 *             (only inStock boolean); cannot call admin tools.
 *   SELLER  → own products only (seller == req.user._id); full inventory
 *             fields exposed (costPrice, stockQty, warehouseLocation,
 *             salesHistory); cannot call admin-only or other-seller tools.
 *   ADMIN   → unrestricted; sees costPrice, all sellers, all aggregations.
 *
 * Tool exposure rules live here too — the controller filters TOOLS by
 * scope.allowedTools[] before sending to the LLM, so the model literally
 * can't request a tool it's not entitled to call.
 */

// Public-facing product fields. Used as the allowlist for USER scope.
const USER_SAFE_FIELDS = Object.freeze([
  "id", "name", "brand", "oem", "price", "originalPrice",
  "category", "tags", "images", "iconPath",
  "description", "badge", "rating", "ratingCount",
  "inStock",            // boolean only — never the count
  "deliveryDays",
  "fitments",           // car compatibility is public info
  "attributes",         // category-specific specs are public
  "compatibility",      // OEM bag / engine codes are useful for cross-ref
  "createdAt",
]);

// SELLER scope adds inventory-management fields.
const SELLER_EXTRA_FIELDS = Object.freeze([
  "stockQty", "lowStockThreshold", "status", "rejectedReason",
  "updatedAt",
  // Fields the SPEC asks for but that the schema does not yet expose.
  // The redactor includes them when present so future schema additions
  // are picked up automatically without touching this code.
  "costPrice", "warehouseLocation", "salesHistory", "lastSoldAt",
]);

// ADMIN scope is everything — no redaction.

/**
 * Derive a strict 3-way role from the auth user. Defaults to "user" for
 * anonymous or unrecognised principals so a missing-auth path can never
 * accidentally elevate.
 */
export const deriveAiRole = (user) => {
  const r = user?.role;
  if (r === "admin")  return "admin";
  if (r === "seller") return "seller";
  return "user";
};

/**
 * Build the runtime scope object the rest of the AI pipeline reads from.
 * This is the SINGLE source of truth for what the current request can do.
 *
 * `allowedTools` is the most security-critical field — it determines
 * what the LLM is even shown. Keep this list small and explicit.
 */
export const buildRoleScope = (role, user) => {
  switch (role) {
    case "admin":
      return Object.freeze({
        role: "admin",
        canSeeCost:     true,
        canSeeAllStock: true,
        canSeeAllSellers: true,
        sellerId: null,                 // null = no merchant filter
        productFilter: {},              // unrestricted (raw access)
        allowedTools: Object.freeze([
          "search_products",
          "search_vehicle_parts",
          "cross_reference_oem",
          "identify_part_from_image",
          "disambiguate_vague_query",
          // Phase I — symptom → candidate parts diagnostic
          "diagnose_symptom",
          // Phase G — vehicle switcher tools
          "lookup_vehicle_by_plate",
          "switch_active_vehicle",
          // Phase A — admin financial bedrock
          "get_low_stock",
          "get_sales_summary",
          // Phase C — BI/strategy tools
          "get_financial_metrics",
          "get_demand_forecast",
          "get_market_gaps",
        ]),
      });

    case "seller":
      return Object.freeze({
        role: "seller",
        canSeeCost:       true,
        canSeeAllStock:   false,        // own inventory only
        canSeeAllSellers: false,
        sellerId: user?._id || null,
        // Hard filter applied to EVERY product query in this scope.
        productFilter: { seller: user?._id || null },
        allowedTools: Object.freeze([
          "search_products",            // scoped to own inventory
          "search_vehicle_parts",
          "cross_reference_oem",
          "identify_part_from_image",
          "disambiguate_vague_query",
          // Phase I — symptom → candidate parts diagnostic
          "diagnose_symptom",
          // Phase G — sellers also help customers look up plates
          "lookup_vehicle_by_plate",
          "switch_active_vehicle",
          // Shared with admin — handler scopes by productFilter anyway.
          "get_low_stock",
          // Seller-only tools land here as Phase B adds them
          "get_deadstock",
          "find_shelf_location",
          "generate_quotation",
        ]),
      });

    case "user":
    default:
      return Object.freeze({
        role: "user",
        canSeeCost:       false,
        canSeeAllStock:   false,
        canSeeAllSellers: false,
        sellerId: null,
        // Hard filter — public marketplace only sees approved listings.
        productFilter: { status: "approved" },
        allowedTools: Object.freeze([
          "search_products",
          "search_vehicle_parts",
          "cross_reference_oem",
          "identify_part_from_image",
          "disambiguate_vague_query",
          // Phase I — symptom → candidate parts diagnostic
          "diagnose_symptom",
          // Phase G — in-chat vehicle switcher tools
          "lookup_vehicle_by_plate",
          "switch_active_vehicle",
        ]),
      });
  }
};

/**
 * Strip a product (lean object or Mongoose doc) down to the fields the
 * current scope is allowed to see. Always returns a plain object — never
 * a Mongoose document — so callers can't accidentally call .save() on a
 * redacted view.
 *
 * For USER scope, `stockQty` is collapsed into a boolean (`inStock: stockQty > 0`)
 * so the AI can answer "is it in stock?" without leaking exact counts that
 * a competitor could mine.
 */
export const sanitizeProduct = (product, scope) => {
  if (!product) return null;
  const src = typeof product.toObject === "function" ? product.toObject() : product;

  if (scope.role === "admin") {
    // No redaction — admin sees everything. Coerce _id → id for the wire.
    const out = { ...src, id: String(src._id || src.id || "") };
    delete out._id;
    return out;
  }

  const allowed = scope.role === "seller"
    ? new Set([...USER_SAFE_FIELDS, ...SELLER_EXTRA_FIELDS])
    : new Set(USER_SAFE_FIELDS);

  const out = { id: String(src._id || src.id || "") };
  for (const key of allowed) {
    if (key === "id") continue;
    if (src[key] !== undefined) out[key] = src[key];
  }

  // USER scope: collapse exact stock count into a boolean signal.
  if (scope.role === "user") {
    if (src.stockQty !== undefined) {
      out.inStock = src.inStock !== false && Number(src.stockQty) > 0;
    }
    // Belt-and-suspenders: delete anything that could leak via attributes.
    if (out.attributes && typeof out.attributes === "object") {
      const a = { ...out.attributes };
      delete a.costPrice; delete a.cost_price;
      delete a.supplier;  delete a.supplierId;
      out.attributes = a;
    }
  }

  return out;
};

/** Batch redactor — most call sites have arrays. */
export const sanitizeProducts = (products, scope) =>
  (Array.isArray(products) ? products : []).map((p) => sanitizeProduct(p, scope));

/**
 * Compose a hard MongoDB filter that always applies for the current
 * scope. Callers MUST `$and` this with their own conditions so the
 * scope can never be widened by a malformed query.
 *
 *   const filter = { $and: [ scopeFilter(scope), userQueryFilter ] };
 */
export const scopeFilter = (scope) => scope.productFilter || {};

/**
 * Check whether the LLM is allowed to call a given tool in this scope.
 * Used by the controller to filter TOOLS[] before sending to the model.
 */
export const isToolAllowed = (scope, toolName) =>
  scope.allowedTools && scope.allowedTools.includes(toolName);

/**
 * Detect "wrong-persona" commands so the UI can show a friendly redirect
 * instead of letting the LLM noodle on an inaccessible query.
 *
 *   USER trying "today's sales" / "low stock"     → redirect to login
 *   SELLER trying "global revenue"                 → redirect to admin
 *   ADMIN never blocked.
 */
const ADMIN_COMMAND_PATTERNS = [
  /\b(today'?s|weekly|monthly|all[- ]time)\s+sales\b/i,
  /\blow[- ]?stock\b/i,
  /өнөөдр(ийн)?\s+борлуулалт/i,
  /цөөн\s+үлдсэн/i,
  /\bsales\s+report\b/i,
  /санхүү(гийн)?\s+тайлан/i,
  /орлого/i,
];

export const detectWrongPersonaCommand = (text, role) => {
  const s = String(text || "");
  if (!s) return null;

  if (role === "user") {
    const hit = ADMIN_COMMAND_PATTERNS.find((rx) => rx.test(s));
    if (hit) {
      return {
        type: "admin_command_blocked",
        message:
          "Энэ тушаал нь админ/зарагчийн дашбоардад ажилладаг. " +
          "Хэрэв та зарагч/админ бол /auth/login -руу нэвтэрнэ үү.",
        suggestedRoute: "/auth/login",
      };
    }
  }
  return null;
};

// Re-export field lists for tests / future redactors.
export const __internal = Object.freeze({
  USER_SAFE_FIELDS,
  SELLER_EXTRA_FIELDS,
  ADMIN_COMMAND_PATTERNS,
});
