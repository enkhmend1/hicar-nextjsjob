/**
 * AI Reflection + Confidence service — Phase H.
 *
 * Turns a "tool-augmented LLM" into a "self-correcting agent":
 *
 *   ① Score every tool result on a 0..1 confidence scale.
 *   ② After each tool call inside the chat loop, REFLECT on whether
 *      the answer is good enough. If not, mint a "recovery hint" the
 *      LLM sees on its next round ("your last search returned 0 —
 *      try cross_reference_oem instead").
 *   ③ Track running confidence across the turn so the final response
 *      envelope can carry it; the frontend renders a badge or an
 *      escalation banner depending on the band.
 *
 * Why this matters:
 *   The vanilla tool loop stops when the LLM stops asking for tools.
 *   That makes "search returned 0 → AI says 'олдсонгүй' → END" the
 *   modal failure path. Reflection turns that into "search returned
 *   0 → reflection notices → injects a fallback hint → LLM tries
 *   cross_reference_oem → finds an aftermarket alternative → returns
 *   a useful answer". Same tool budget, materially better UX.
 *
 * What this is NOT:
 *   • Not a chain-of-thought scratchpad (we don't ask the LLM to
 *     "think step by step" — that's expensive and unverifiable).
 *   • Not an oracle of truth — confidence is a heuristic from
 *     OBSERVABLE signals (counts, OEM hit, fallback flags), not
 *     an LLM self-rating.
 *
 * Confidence bands (mirrored on the frontend):
 *   ≥ 0.90  →  high       — render normally, no UI cue
 *   0.70–0.89 →  medium   — subtle "Магадлал: 78%" badge
 *   0.50–0.69 →  low      — "AI бүрэн итгэлгүй байна" warning
 *   < 0.50  →  critical   — escalation banner ("оператортой холбогдох уу?")
 */

const HIGH_BAND     = 0.90;
const MEDIUM_BAND   = 0.70;
const LOW_BAND      = 0.50;
const EMPTY_RESULT  = 0.20;
const TOOL_ERROR    = 0.10;

// ────────────────────────────────────────────────────────────────────
// scoreToolResult — pure per-tool heuristic
// ────────────────────────────────────────────────────────────────────

/**
 * Score one tool result in [0,1]. Higher = the LLM should trust it.
 *
 * Rules (per tool):
 *
 *   search_products / search_vehicle_parts
 *     items.length === 0                       → 0.20  (empty miss)
 *     items.length ≥ 5                          → 0.95
 *     transliterated dictionary hit AND items   → 0.95  (slang resolved)
 *     fallbackUsed = true                       → 0.65  (we picked a
 *                                                       text-fallback path,
 *                                                       not OEM exact)
 *     plain non-empty                           → 0.85
 *
 *   cross_reference_oem
 *     found = true AND equivalents.length ≥ 2   → 0.95
 *     found = true                              → 0.80
 *     !found                                    → 0.30
 *
 *   identify_part_from_image
 *     confidence == "high"                      → 0.95
 *     confidence == "medium"                    → 0.75
 *     confidence == "low"                       → 0.55
 *
 *   disambiguate_vague_query
 *     ALWAYS 1.0 — we KNEW we needed clarification; the form IS the
 *     answer. No band downgrade for it.
 *
 *   lookup_vehicle_by_plate
 *     vehicleId present, !error                 → 0.95
 *     error                                     → 0.20
 *
 *   switch_active_vehicle
 *     switched === true                         → 1.00  (deterministic)
 *
 *   get_deadstock / find_shelf_location
 *     rows.length ≥ 1                           → 0.95
 *     summary.matchCount === 0                  → 0.30
 *
 *   generate_quotation
 *     summary.lineCount ≥ 1 AND missingCount=0  → 1.00
 *     missingCount > 0                          → 0.70  (partial — flag)
 *
 *   get_*_metrics / get_market_gaps / get_demand_forecast
 *     non-empty data                            → 0.90
 *     empty / no signal                         → 0.50
 *
 *   ANY tool with result.error                  → 0.10
 *
 * Unknown tools fall through to 0.50 (neutral) so we never accidentally
 * over-confidence a new tool's output.
 */
export const scoreToolResult = (name, result) => {
  if (!result || typeof result !== "object") return 0.50;
  if (result.error)                          return TOOL_ERROR;

  switch (name) {
    case "search_products":
    case "search_vehicle_parts": {
      const n = Array.isArray(result.items) ? result.items.length : 0;
      if (n === 0) return EMPTY_RESULT;
      if (result.transliterated?.length && n > 0) return 0.95;
      if (result.fallbackUsed) return 0.65;
      if (n >= 5) return 0.95;
      return 0.85;
    }

    case "cross_reference_oem": {
      if (!result.found) return 0.30;
      const k = Array.isArray(result.equivalents) ? result.equivalents.length : 0;
      return k >= 2 ? 0.95 : 0.80;
    }

    case "identify_part_from_image": {
      if (result.confidence === "high")   return 0.95;
      if (result.confidence === "medium") return 0.75;
      if (result.confidence === "low")    return 0.55;
      return 0.65;
    }

    case "disambiguate_vague_query":
      return 1.0;

    case "lookup_vehicle_by_plate":
      return result.vehicleId ? 0.95 : EMPTY_RESULT;

    case "switch_active_vehicle":
      return result.switched ? 1.0 : 0.30;

    case "get_deadstock":
    case "find_shelf_location":
    case "get_low_stock": {
      const n = Array.isArray(result.rows) ? result.rows.length : 0;
      const matchCount = result.summary?.matchCount;
      if (matchCount === 0) return 0.30;
      return n >= 1 ? 0.95 : 0.50;
    }

    case "generate_quotation": {
      const missing = Number(result.summary?.missingCount || 0);
      const lines   = Number(result.summary?.lineCount    || 0);
      if (lines >= 1 && missing === 0) return 1.0;
      if (missing > 0) return 0.70;
      return 0.40;
    }

    case "get_financial_metrics":
    case "get_demand_forecast":
    case "get_market_gaps":
    case "get_sales_summary": {
      const hasData = result.data && Object.keys(result.data).length > 0;
      return hasData ? 0.90 : 0.50;
    }

    default:
      return 0.50;
  }
};

// ────────────────────────────────────────────────────────────────────
// Recovery hints — system notes the LLM sees on its next round
// ────────────────────────────────────────────────────────────────────

/**
 * If the last tool call has low confidence AND a sensible recovery
 * path exists, return a short English directive the controller will
 * inject into the conversation as a system note. Returns null when
 * no recovery is appropriate.
 *
 * The recovery hint is targeted advice, not a generic "try again" —
 * the LLM is more likely to follow concrete instructions ("call X
 * with Y") than vague encouragement.
 */
export const recoveryHintFor = (name, result, runtime, history) => {
  if (!result || result.error) {
    return `[REFLECTION] The tool "${name}" failed: ${result?.error || "unknown error"}. ` +
           `Do NOT retry the same tool with the same args. Either ask the user a clarifying ` +
           `question or try a different tool.`;
  }

  // Empty product search → suggest cross_reference_oem OR disambiguate.
  //
  // Heuristic: if the query LOOKS LIKE an OEM (≥4 chars, contains a digit,
  // alphanumeric+dash) cross_reference_oem is the right next step — an
  // OEM with no marketplace hit often DOES have aftermarket equivalents.
  // For bare vocabulary queries ("фар", "тоормос") cross_reference would
  // fail by design; disambiguate is the right recovery.
  if (name === "search_products" || name === "search_vehicle_parts") {
    const n = Array.isArray(result.items) ? result.items.length : 0;
    if (n > 0) return null;

    const tried = new Set(history.map((tc) => tc.name));
    const q = String(result.query || "").trim();
    const looksLikeOem = q.length >= 4 && /\d/.test(q) && /^[A-Za-z0-9\-./]+$/.test(q);

    if (looksLikeOem && !tried.has("cross_reference_oem")) {
      return `[REFLECTION] search returned 0 hits for "${q}". ` +
             `The query looks like an OEM code — call cross_reference_oem to find ` +
             `aftermarket equivalents BEFORE telling the user nothing was found.`;
    }
    if (!tried.has("disambiguate_vague_query") && !runtime?.vehicleContext) {
      return `[REFLECTION] search returned 0 hits and no vehicle context is set. ` +
             `Call disambiguate_vague_query with the user's keyword so the UI can ` +
             `collect year/model/side from them.`;
    }
    if (!tried.has("cross_reference_oem") && q) {
      return `[REFLECTION] search returned 0 hits for "${q}". ` +
             `Try cross_reference_oem with the closest OEM from result.oemBag (if any) ` +
             `before telling the user nothing was found.`;
    }
    return `[REFLECTION] search returned 0 hits AND fallback tools have already been ` +
           `tried this turn. Tell the user honestly — no part matched — and offer ` +
           `to escalate to an operator.`;
  }

  // Cross-ref miss → don't insist; let the AI explain to the user.
  if (name === "cross_reference_oem" && !result.found) {
    return `[REFLECTION] cross_reference_oem found no equivalents for ` +
           `"${result.primaryOem}". Tell the user we have no aftermarket data for ` +
           `this OEM and suggest they contact an operator.`;
  }

  // Image OCR low confidence → ask for a clearer photo
  if (name === "identify_part_from_image" && result.confidence === "low") {
    return `[REFLECTION] OCR confidence is LOW. Ask the user for a clearer photo ` +
           `(better lighting, closer to the OEM sticker) OR for the OEM code typed manually.`;
  }

  return null;
};

// ────────────────────────────────────────────────────────────────────
// Aggregate reflection over an entire turn's tool history
// ────────────────────────────────────────────────────────────────────

/**
 * Compose a turn-level reflection result from the full tool history.
 *
 *   confidence       — the LAST tool's confidence (the user sees its
 *                      output, so its band is the one that matters);
 *                      capped at 0.50 if any tool errored mid-turn.
 *   recoveryHint     — to inject if rounds remain; null otherwise.
 *   shouldEscalate   — true when final confidence < LOW_BAND.
 *   escalationReason — "low_confidence" / "tool_error" / null.
 */
export const reflectOnToolCalls = (toolCalls, runtime, { roundsRemaining = 0 } = {}) => {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
    return { confidence: 0.95, recoveryHint: null, shouldEscalate: false, escalationReason: null };
  }

  const last = toolCalls[toolCalls.length - 1];
  let confidence = scoreToolResult(last.name, last.result);

  // Cap if any earlier tool errored — caller saw a partial / shaky path.
  // We cap to 0.40 (squarely below LOW_BAND) so the escalation path
  // ALWAYS fires: a tool error in the conversation, even if the very
  // last tool succeeded, is operationally a "show the user the
  // 'contact operator' CTA" event.
  const hadError = toolCalls.some((tc) => tc.result?.error);
  if (hadError) confidence = Math.min(confidence, 0.40);

  const recoveryHint = roundsRemaining > 0
    ? recoveryHintFor(last.name, last.result, runtime, toolCalls.slice(0, -1))
    : null;

  const shouldEscalate = confidence < LOW_BAND;
  const escalationReason = shouldEscalate
    ? (hadError ? "tool_error" : "low_confidence")
    : null;

  return { confidence: +confidence.toFixed(2), recoveryHint, shouldEscalate, escalationReason };
};

// ────────────────────────────────────────────────────────────────────
// Build the escalation payload sent to the frontend
// ────────────────────────────────────────────────────────────────────

/**
 * Produce a structured escalation card the frontend renders as a
 * prominent banner with a "Contact operator" CTA. Returns null when
 * no escalation is warranted.
 *
 * Reasons → user-visible message + suggestedAction:
 *   low_confidence  → "Бид таны асуултанд бүрэн хариулж чадахгүй..."
 *   tool_error      → "Систем түр алдаатай байна..."
 *   manual          → caller explicitly requested it
 */
export const buildEscalation = (reason, locale = "mn") => {
  if (!reason) return null;
  const en = locale === "en";
  const map = {
    low_confidence: en
      ? "We couldn't find a confident answer. Contact an operator for help?"
      : "Бид таны асуултанд бүрэн хариулж чадсангүй. Оператортой холбогдох уу?",
    tool_error: en
      ? "A system tool is temporarily unavailable. An operator can help while we recover."
      : "Системийн нэг хэрэгсэл түр ажиллахгүй байна. Оператор тусалж чадна.",
    manual: en
      ? "Connect to an operator?"
      : "Оператортой холбогдох уу?",
  };
  return {
    reason,
    message: map[reason] || map.manual,
    suggestedAction: { kind: "contact_operator", href: "/help/contact" },
  };
};

// ────────────────────────────────────────────────────────────────────
// Confidence-band classifier (for tests + UI parity)
// ────────────────────────────────────────────────────────────────────
export const confidenceBand = (c) => {
  if (c >= HIGH_BAND)    return "high";
  if (c >= MEDIUM_BAND)  return "medium";
  if (c >= LOW_BAND)     return "low";
  return "critical";
};

export const __internal = Object.freeze({
  HIGH_BAND, MEDIUM_BAND, LOW_BAND, EMPTY_RESULT, TOOL_ERROR,
});
