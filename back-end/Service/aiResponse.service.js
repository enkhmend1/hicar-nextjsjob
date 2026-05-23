/**
 * Structured AI response envelope.
 *
 * Why this exists:
 *   The frontend chat widget renders very different UI per response —
 *   product cards for User, sortable tables for Seller, chart-ready data
 *   for Admin, and disambiguation dropdowns for vague queries. Without a
 *   discriminated union the renderer has to GUESS what to draw, which
 *   leads to brittle "look at toolCalls[0].name" sniffing in JSX.
 *
 *   This module produces a strict envelope that pairs the LLM's prose
 *   reply with a tagged `layout` so the renderer is a clean switch
 *   statement.
 *
 * The envelope shape (single contract for /api/ai/chat):
 *
 *   {
 *     reply:       string,                     // LLM prose, locale-aware
 *     layout:      "user_cards" | "seller_table"
 *                | "admin_widget" | "diag_form"
 *                | "plain",
 *     payload:     object,                     // shape depends on layout
 *     suggestions?: { label: string; cmd: string }[],
 *     diagnostics: { ... }                     // debugging metadata
 *   }
 *
 * Layout payload shapes:
 *
 *   user_cards    : { items: ProductCard[], crossRefs?: CrossRef[] }
 *   seller_table  : { columns: string[], rows: Cell[][], summary?: object }
 *   admin_widget  : { kind: "bar_chart"|"pie_chart"|"kpi_grid", ... }
 *   diag_form     : { partType: string, fields: FormField[] }
 *   plain         : (nothing — reply text only)
 */

// ────────────────────────────────────────────────────────────────────
// Builders — one per layout. Always return a fresh object so callers
// can mutate / merge without aliasing surprises.
// ────────────────────────────────────────────────────────────────────

/**
 * USER layout — rich product cards. The most common path.
 *
 * `crossRefs` is optional; populated when cross_reference_oem ran.
 * Each card carries the redacted USER-safe fields only (caller's job
 * to have run sanitizeProduct).
 */
export const userCards = ({ items = [], crossRefs = [], meta = {} }) => ({
  layout: "user_cards",
  payload: { items, crossRefs, meta },
});

/**
 * SELLER layout — sortable inventory table.
 *
 *   columns: ["OEM код", "Үлдэгдэл", "Байршил", "Үйлдэл"]
 *   rows: [
 *     ["04465-02220", 12, "B-3", { kind: "button", label: "Хямдрал", action: "discount:15" }]
 *   ]
 *   summary?: { totalSku: 42, trappedCapital: 12_500_000 }
 */
export const sellerTable = ({ columns = [], rows = [], summary = null }) => ({
  layout: "seller_table",
  payload: { columns, rows, summary },
});

/**
 * ADMIN layout — chart-ready structured data.
 *
 *   kind: "bar_chart" | "pie_chart" | "kpi_grid" | "line_chart"
 * Caller picks the shape that fits the metric.
 */
export const adminWidget = ({ kind = "kpi_grid", title = "", data = {} }) => ({
  layout: "admin_widget",
  payload: { kind, title, data },
});

/**
 * DIAG_FORM layout — disambiguation dropdowns for vague queries.
 *
 * Triggered when the user types a bare category word ("фар", "тоормос")
 * without enough context to search. The frontend renders the form fields
 * inline in the chat thread; submitting them re-enters the chat with the
 * answers appended.
 *
 *   partType: human label of what the user asked about ("фар")
 *   fields:   [{ key, label, type, options?, required }]
 *     type: "select" | "year" | "text"
 */
export const diagForm = ({ partType, fields = [], note = "" }) => ({
  layout: "diag_form",
  payload: { partType, fields, note },
});

/**
 * QUOTATION — generated B2B quote (Phase B / generate_quotation tool).
 *
 *   quoteId   : "HC-QT-260524-A3F2"
 *   bodyText  : pre-formatted plain text suitable for clipboard / email
 *   summary   : { subtotal, discount, vat, total, lineCount, validUntil }
 *
 * The frontend renders this as a monospace block with a copy button.
 */
export const quotation = ({ quoteId, bodyText, summary }) => ({
  layout: "quotation",
  payload: { quoteId, bodyText, summary },
});

/** PLAIN — no rich payload, just the reply text. */
export const plain = () => ({ layout: "plain", payload: {} });

// ────────────────────────────────────────────────────────────────────
// Common diagnostic-form templates the disambiguation tool returns
// for the most popular vague queries.
// ────────────────────────────────────────────────────────────────────

const FORM_SIDE_FRONT_REAR_LR = [
  { key: "position", label: "Байрлал", type: "select", required: true,
    options: ["front_left", "front_right", "rear_left", "rear_right", "front", "rear"] },
];

const FORM_AXLE_FRONT_REAR = [
  { key: "axle", label: "Тэнхлэг", type: "select", required: true,
    options: ["front", "rear", "both"] },
];

const FORM_CAR_BASICS = [
  { key: "make",  label: "Үйлдвэрлэгч", type: "text",   required: true },
  { key: "model", label: "Загвар",       type: "text",   required: true },
  { key: "year",  label: "Жил",          type: "year",   required: true },
];

/**
 * Map a Mongolian/English vague keyword → the dropdown set that
 * minimally pins down the right SKU group. Returned forms ALWAYS start
 * with car basics (unless vehicleContext is set, in which case the
 * caller should omit those).
 *
 * Returns null if the keyword isn't a known vague pattern.
 */
export const vagueQueryFormFor = (keyword) => {
  const k = String(keyword || "").trim().toLowerCase();
  if (!k) return null;

  // Brakes — pad/disc/caliper + axle
  if (/^(тоормос|brake|brakes|наклад|pad|pads)/.test(k)) {
    return {
      partType: "Тоормос",
      fields: [
        ...FORM_AXLE_FRONT_REAR,
        { key: "part_type", label: "Эд анги", type: "select", required: true,
          options: ["pad", "disc", "caliper", "fluid", "hose"] },
      ],
    };
  }
  // Lighting — position + bulb
  if (/^(фар|гэрэл|headlight|light|lamp)/.test(k)) {
    return {
      partType: "Гэрэлтүүлэг",
      fields: [
        { key: "light_type", label: "Гэрлийн төрөл", type: "select", required: true,
          options: ["headlight", "taillight", "fog", "turn_signal"] },
        ...FORM_SIDE_FRONT_REAR_LR,
      ],
    };
  }
  // Suspension — position
  if (/^(амортизатор|shock|strut|suspension|stoyka)/.test(k)) {
    return {
      partType: "Амортизатор",
      fields: FORM_SIDE_FRONT_REAR_LR,
    };
  }
  // Oils — type + viscosity
  if (/^(масло|тос|oil|lubricant)/.test(k)) {
    return {
      partType: "Тос",
      fields: [
        { key: "oil_type", label: "Тосны зориулалт", type: "select", required: true,
          options: ["engine", "transmission", "brake", "coolant"] },
        { key: "viscosity", label: "Зуурамтгайн зэрэг", type: "text", required: false },
      ],
    };
  }
  // Battery — capacity
  if (/^(батарей|аккум|battery)/.test(k)) {
    return {
      partType: "Батарей",
      fields: [
        { key: "capacity_ah", label: "Багтаамж (Ah)", type: "text", required: true },
        { key: "terminal_position", label: "Туйлын байрлал", type: "select", required: false,
          options: ["left", "right", "top"] },
      ],
    };
  }
  return null;
};

// ────────────────────────────────────────────────────────────────────
// Outer envelope assembler — used by the controller at the very end
// to produce the wire format. Always populates `layout` even on the
// failure path so the frontend renderer never crashes on undefined.
// ────────────────────────────────────────────────────────────────────

/**
 * Decide which layout to emit based on the tool calls that fired.
 * Priority — most-specific layout wins:
 *
 *   diag_form     → if disambiguate_vague_query was the LAST tool used
 *   admin_widget  → if get_sales_summary / forecast / market_gaps
 *   seller_table  → if get_low_stock / get_deadstock / find_shelf
 *   user_cards    → if search_products / search_vehicle_parts
 *   plain         → fallback
 */
export const inferLayoutFromTools = (toolCalls, role) => {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) return plain();

  // Inspect in reverse so the LAST tool drives the layout — that's the
  // one whose output the user is most likely seeing.
  for (let i = toolCalls.length - 1; i >= 0; i--) {
    const { name, result } = toolCalls[i];
    if (!result || result.error) continue;

    if (name === "disambiguate_vague_query") {
      return diagForm({
        partType: result.partType || "",
        fields: result.fields || [],
        note: result.note || "",
      });
    }
    if (name === "get_sales_summary"
        || name === "get_financial_metrics"
        || name === "get_demand_forecast"
        || name === "get_market_gaps") {
      return adminWidget({
        kind:  result.kind  || "kpi_grid",
        title: result.title || name,
        data:  result.data  || result,
      });
    }
    if (name === "get_low_stock" || name === "get_deadstock" || name === "find_shelf_location") {
      return sellerTable({
        columns: result.columns || [],
        rows:    result.rows    || [],
        summary: result.summary || null,
      });
    }
    if (name === "generate_quotation") {
      return quotation({
        quoteId:  result.quoteId  || "",
        bodyText: result.bodyText || "",
        summary:  result.summary  || {},
      });
    }
    if (name === "search_products" || name === "search_vehicle_parts" || name === "identify_part_from_image") {
      return userCards({
        items:     result.items     || [],
        crossRefs: result.crossRefs || [],
        meta: {
          query:    result.query,
          category: result.category,
          count:    result.count,
          // Smart-search context, when present.
          plan:     result.plan,
          oemBag:   result.oemBag,
        },
      });
    }
    if (name === "cross_reference_oem") {
      // Pure cross-ref query — present as user_cards with NO main items,
      // only the crossRefs list.
      return userCards({
        items: [],
        crossRefs: result.equivalents || [],
        meta: { primaryOem: result.primaryOem },
      });
    }
  }
  return plain();
};

/**
 * Assemble the wire envelope from the conversation result.
 *
 *   replyText:    string from the LLM
 *   toolCalls:    [{ name, result }] from runConversation
 *   role:         derived role
 *   diagnostics:  raw counter object (totalTokens, terminate, etc.)
 *
 * If the LLM left `reply` blank (rare but possible when the only output
 * was a tool call), substitute a neutral "Done." so the chat thread
 * never shows an empty bubble.
 */
export const buildEnvelope = ({ replyText, toolCalls, role, diagnostics, suggestions = [] }) => {
  const layoutObj = inferLayoutFromTools(toolCalls, role);
  const reply = String(replyText || "").trim() || _defaultReplyFor(layoutObj.layout, role);
  return {
    reply,
    layout: layoutObj.layout,
    payload: layoutObj.payload,
    suggestions,
    diagnostics,
  };
};

const _defaultReplyFor = (layout) => {
  switch (layout) {
    case "user_cards":   return "Доорх сэлбэгүүд таарч байна:";
    case "seller_table": return "Уг хүснэгтийг харна уу:";
    case "admin_widget": return "Үзүүлэлт бэлэн боллоо.";
    case "diag_form":    return "Сэлбэгээ нарийвчилъя — доорхыг бөглөнө үү:";
    case "quotation":    return "Үнийн санал бэлэн боллоо. Хуулж и-мэйлээр илгээж болно.";
    default:             return "Боллоо.";
  }
};
