/**
 * Maintenance hints — Phase AM.
 *
 * Returns 1-3 short, Mongolian-friendly maintenance suggestions for the
 * user's vehicle that the AI can WEAVE INTO ITS REPLY. Two sources feed
 * each hint:
 *
 *   1. PER-MAKE / MODEL knowledge — what owners of this specific vehicle
 *      typically need to watch for. E.g. Toyota Prius hybrid battery,
 *      Honda CR-V timing chain, Land Cruiser front diff.
 *
 *   2. PER-SEARCH category triggers — if the user just searched for
 *      brake pads, remind them brake fluid ages every 2 years. If they
 *      searched for spark plugs, remind them about ignition coils.
 *
 * Why this matters:
 *   Buyers on a marketplace typically arrive with ONE part in mind.
 *   Naturally surfacing the adjacent service items (fluid + filter +
 *   gasket) drives both cart size AND user trust — "they really know
 *   my car". This is the "value-add layer" that lifts an ordinary
 *   commerce chat into a real automotive assistant.
 *
 * Output shape:
 *   getMaintenanceHints({ vehicleContext, recentSearches }) → string[]
 *   Each string is ONE sentence, Mongolian, action-oriented. The LLM
 *   sees them in the system prompt with instructions to MENTION ONE
 *   naturally (not as a list dump).
 *
 * Why static (not learned from order data):
 *   We don't have the order volume yet for a useful per-make recommender.
 *   These rules come from public Toyota/Honda/Nissan maintenance
 *   schedules + Mongolia second-hand market knowledge. As order data
 *   grows we can swap this implementation behind the same interface.
 *
 * Not in scope (yet):
 *   - Per-vehicle KM tracking (we don't store odometer)
 *   - Owner manual deep links
 *   - SMS / push reminders (handled separately by Phase L background agent)
 */

// ────────────────────────────────────────────────────────────────────
// PER-MAKE knowledge — common "things owners of this make should know"
//
// Keys: lowercased make. Each entry is a list of context-free reminders
// that always make sense for ANY year of that make. The LLM will pick
// AT MOST ONE per chat turn so the prompt stays focused.
// ────────────────────────────────────────────────────────────────────
const MAKE_HINTS = Object.freeze({
  toyota: [
    "Toyota эзэмшигчид: 80,000-100,000 км дотор timing belt / water pump бүрэн солих санал болгодог.",
    "Toyota автомат хайрцагт ATF (трансмиссийн тос) 60,000 км тутамд солих нь ажиллах хугацааг 2 дахин уртасгана.",
    "Япон гарал үүсэлтэй Toyota-нд OEM Aisin / Denso / Sankei сэлбэг тохиромжтой — aftermarket цолтой нь дунд зэрэг.",
  ],
  honda: [
    "Honda-н ихэнх загвар timing chain ашигладаг — 150,000 км хүртэл solих шаардлагагүй (зөвхөн tensioner шалгах).",
    "Honda CVT-тэй бол CVT-тосыг 40,000 км тутамд солих маш чухал — судалын зөвлөмж.",
  ],
  nissan: [
    "Nissan CVT (X-Trail / Teana / Sentra) — CVT тосыг 40,000 км тутамд солих нь ердийн сэргийлэх арга.",
    "Nissan-ийн ABS sensor + хойд диск тоос их хатдаг — 60,000 км дээр харах.",
  ],
  mitsubishi: [
    "Mitsubishi Outlander / Lancer — timing belt 100,000 км дотор солих, дагалдах усны помп бас солих нь стандарт.",
  ],
  hyundai: [
    "Hyundai-ийн TGDI хөдөлгүүр (Sonata, Tucson) — карбон хуримтлал заавал шалгадаг (60,000 км+).",
    "Hyundai Сонатад термостат + хөргөлтийн систем 80,000 км дээр заавал шалгана.",
  ],
  subaru: [
    "Subaru EJ хөдөлгүүртэй (Legacy, Forester) — head gasket leak 100,000 км дээр түгээмэл; coolant өнгө шалгана.",
    "Subaru AWD-ийн difficult механизм нь 50,000 км-д бэхэлгээ шингэн заавал солих.",
  ],
  bmw: [
    "BMW-ийн N-series хөдөлгүүр (N20, N52, N55) — VANOS / тосны хэрэглээ хяна, 80,000 км дотор valve cover gasket солих нь түгээмэл.",
  ],
  "mercedes-benz": [
    "Mercedes-ийн 7G-Tronic автомат хайрцагт ATF тосыг 60,000 км тутамд бүрэн солих санал болгодог.",
  ],
  mercedes: [
    "Mercedes-ийн 7G-Tronic автомат хайрцагт ATF тосыг 60,000 км тутамд бүрэн солих санал болгодог.",
  ],
});

// ────────────────────────────────────────────────────────────────────
// PER-MODEL "watch out" knowledge — sharper rules for specific
// chassis / model. Override or supplement MAKE_HINTS when the model
// matches. Keys are lowercased "make model" joined by space.
// ────────────────────────────────────────────────────────────────────
const MODEL_HINTS = Object.freeze({
  "toyota prius": [
    "Prius-ийн hybrid батарей 150,000 км эсвэл 8-10 жилд эрсдэлд орох — ажиллагаа удааширвал шалгуулах.",
    "Prius-ийн inverter coolant 80,000 км дотор солих санал болгодог (engine coolant-аас тусдаа).",
  ],
  "toyota crown": [
    "Crown-ийн 2GR / 1JZ хөдөлгүүр-д тосны нэвчилт цаг ажил, valve cover gasket 100,000 км дээр харах нь стандарт.",
  ],
  "toyota land cruiser": [
    "Land Cruiser — timing belt (1HD-FTE/UZ дизель) 100,000 км дотор бэлдэх, дагалдах өргөгч + помп.",
  ],
  "honda crv": [
    "CR-V (RD/RM) — VTC actuator + timing chain tensioner 100,000 км дээр шуу гаргадаг.",
  ],
  "honda cr-v": [
    "CR-V (RD/RM) — VTC actuator + timing chain tensioner 100,000 км дээр шуу гаргадаг.",
  ],
  "nissan x-trail": [
    "X-Trail (T31/T32) CVT — 40,000 км тутамд тос солиогүй бол jam-цалитай эрсдэлтэй.",
  ],
});

// ────────────────────────────────────────────────────────────────────
// PER-SEARCH category triggers. When the user's last search hits one
// of these categories, surface the related cross-system reminder.
// Keys are matched as substring against the search query + category.
// ────────────────────────────────────────────────────────────────────
const SEARCH_TRIGGERS = Object.freeze([
  {
    match: /тоормос|brake|наклад/i,
    hints: [
      "Тоормос солихтой хамт тоормосны шингэн (DOT4) 2 жил тутамд солих нь шинэ накладын ажиллагааг сайжруулна.",
      "Урд накладыг сольж байгаа бол хойд накладыг бас шалгах — ихэнхдээ 60,000 км-ээс хэтрэхгүй.",
    ],
  },
  {
    match: /масло|тос|oil|шүүлтүүр.*тос/i,
    hints: [
      "Хөдөлгүүрийн тос солихтой хамт air filter + cabin filter шалгах нь хямд бэлэн арга.",
    ],
  },
  {
    match: /амортизатор|shock|strut|стойк/i,
    hints: [
      "Стойк (амортизатор) солих үед top mount + bump stop + spring-ийг бас шалгах — өргөтгөл сонголт ерөнхийдөө $15-30 ширхэг.",
    ],
  },
  {
    match: /свеч|spark|плаг|ignition/i,
    hints: [
      "Iridium свеч 100,000 км хүртэл, харин ignition coil ~80,000 км дотор уг ажиллагаа муудна — хослуулж шалгах.",
    ],
  },
  {
    match: /аккумул|battery|акку/i,
    hints: [
      "Шинэ батарей суулгахдаа alternator-ийн voltage (13.5-14.7V) шалгуулах — alternator муу бол шинэ батарей хурдан сулрана.",
    ],
  },
  {
    match: /радиатор|coolant|антифриз|cooling/i,
    hints: [
      "Хөргөлтийн системийг битэцлэхдээ thermostat + усны помп бас солих нь стандарт пакет (60,000-80,000 км).",
    ],
  },
  {
    match: /timing|бүс|ремен/i,
    hints: [
      "Timing belt сольж байгаа бол water pump + idler pulley + tensioner-ийг хослуулж солих — нэг л удаа задлах боломж.",
    ],
  },
]);

/**
 * Pick a hint at random from a list. We RANDOMISE so the same user
 * doesn't see the identical reminder every chat turn.
 */
const pickOne = (arr) => {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
};

/**
 * Resolve maintenance hints for the current chat context.
 *
 * @param {Object} ctx
 * @param {Object} [ctx.vehicleContext]  - frontend-supplied vehicle (manufacturer/model)
 * @param {Object} [ctx.memory]          - aiMemory snapshot with recentSearches
 * @param {string} [ctx.lastUserText]    - the user's latest message
 * @returns {string[]}  up to 2 hints; empty if nothing matches.
 */
export const getMaintenanceHints = ({ vehicleContext, memory, lastUserText } = {}) => {
  const out = [];

  // (1) Per-model — most specific wins
  if (vehicleContext?.manufacturer && vehicleContext?.model) {
    const key = `${vehicleContext.manufacturer} ${vehicleContext.model}`.toLowerCase();
    const modelHint = pickOne(MODEL_HINTS[key]);
    if (modelHint) out.push(modelHint);
  }

  // (2) Per-make — fallback when no model-specific rule
  if (out.length === 0 && vehicleContext?.manufacturer) {
    const makeHint = pickOne(MAKE_HINTS[vehicleContext.manufacturer.toLowerCase()]);
    if (makeHint) out.push(makeHint);
  }

  // (3) Search-trigger — driven by the LAST user message + recent
  // searches. Always add at most ONE so the prompt stays focused.
  const searchPool = [
    lastUserText || "",
    ...(memory?.recentSearches || []).slice(0, 3).map((s) => s.query || ""),
  ].join(" ");
  for (const trigger of SEARCH_TRIGGERS) {
    if (trigger.match.test(searchPool)) {
      const hint = pickOne(trigger.hints);
      if (hint && !out.includes(hint)) {
        out.push(hint);
        break;  // one trigger per turn
      }
    }
  }

  return out.slice(0, 2);
};

/**
 * Format hints as a single system-prompt block. Empty string when no
 * hints — caller appends only when non-empty so the prompt stays clean.
 */
export const formatMaintenanceHints = (hints) => {
  if (!hints || hints.length === 0) return "";
  return [
    "MAINTENANCE INSIGHTS (mention AT MOST ONE NATURALLY in your reply,",
    "as a parenthetical or a follow-up sentence — never as a bullet list,",
    "never as the main answer):",
    ...hints.map((h) => `  • ${h}`),
  ].join("\n");
};

// Test exports
export const __internal = Object.freeze({
  MAKE_HINTS,
  MODEL_HINTS,
  SEARCH_TRIGGERS,
});
