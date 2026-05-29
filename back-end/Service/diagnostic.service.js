/**
 * Diagnostic Engine — symptom → candidate parts mapper. Phase I.
 *
 * The spec calls out "diagnose before selling" as the USER agent's
 * most important behaviour. Without this, the AI would jump from
 * "Дугуй тог тог дуугарна" straight to product cards — wrong part,
 * angry customer, lost sale.
 *
 * This module gives the AI a concrete "real mechanic" knowledge base:
 * the symptom is the input, a ranked candidate list is the output.
 * Each candidate carries:
 *
 *   • name           — Mongolian display ("Дугуйн холхивч")
 *   • likelihood     — 0..1 prior probability for THIS symptom
 *   • location       — where on the car ("Урд тэнхлэг", "Доор")
 *   • urgency        — "low" / "medium" / "high" (safety relevance)
 *   • oem_hints      — search keywords to seed search_products if
 *                       the user confirms the candidate
 *
 * The map is hand-curated mechanic knowledge — not LLM-generated and
 * not from an external API. That makes it cheap, deterministic, and
 * possible to extend by ops without redeploying the model.
 *
 * Match strategy:
 *   For each SYMPTOM_PATTERN, count how many of its keyword regexes
 *   the user's text matches. Strongest match wins. Ties broken by
 *   pattern order (more specific patterns listed first).
 *
 * Out of scope for v1:
 *   • OBD2 code lookup ("P0301 → cylinder 1 misfire") — future tool.
 *   • Vehicle-specific diagnostic ("Toyota Crown ZVW30 known issues").
 */

// ────────────────────────────────────────────────────────────────────
// SYMPTOM PATTERNS
//
// Each pattern: { id, match: [regex], candidates: [parts], clarify: [Qs] }.
// `match` is OR'd — any keyword hit counts.
// `candidates` is ALREADY sorted by mechanic-priors (most likely first).
// `clarify` is ONE clarifying question the AI should ask before recommending.
// ────────────────────────────────────────────────────────────────────

const PATTERNS = [
  // ───── KNOCKING / CLUNKING (тог тог, нүдгэр) ──────────────────
  // NB: JavaScript `\b` is ASCII-only — it does NOT recognise Cyrillic
  // word boundaries even with the /u flag. We drop `\b` for Cyrillic
  // patterns and rely on the keyword being distinctive enough that
  // substring matches don't false-positive ("тог" inside another word
  // is too rare to gate for in v1).
  {
    id: "knocking_suspension",
    match: [
      /тог\s*тог/iu,
      /клак\s*клак/iu,
      /нүдгэр/iu,
      /клюнг/iu,
      /дугуй\s+(?:тог|чичир)/iu,
      /\bknock(?:ing)?\b/i,
      /\bclunk(?:ing)?\b/i,
      // Phase M.2.3: Latin transliteration ("tog tog", "klak klak").
      /\btog\s+tog\b/i,
      /\bklak\s+klak\b/i,
      /\bnudger\b/i,
    ],
    candidates: [
      { name: "Дугуйн холхивч (wheel bearing)",     likelihood: 0.30, location: "Урд / хойд тэнхлэг", urgency: "high",   oem_hints: "wheel bearing холхивч" },
      { name: "CV-Joint / Гранат",                   likelihood: 0.25, location: "Урд тэнхлэг",        urgency: "medium", oem_hints: "cv joint гранат" },
      { name: "Холбоос саваа (tie rod end)",         likelihood: 0.15, location: "Урд жолооны",        urgency: "high",   oem_hints: "tie rod end холбоос саваа" },
      { name: "Бөмбөг үе (ball joint)",              likelihood: 0.15, location: "Урд дүүжин",         urgency: "high",   oem_hints: "ball joint бөмбөг үе" },
      { name: "Стабилизаторын линк",                 likelihood: 0.10, location: "Урд тогтворжуулагч",  urgency: "low",    oem_hints: "stabilizer link sway bar" },
      { name: "Амортизаторын тулгуур (strut mount)", likelihood: 0.05, location: "Урд / хойд",         urgency: "medium", oem_hints: "strut mount амортизатор тулгуур" },
    ],
    clarify: [
      "Дугуй тог нь хурдалтад чанга болдог уу, эсвэл тогтмол байдаг уу?",
      "Зүүн талаас уу, баруун талаас уу?",
    ],
  },

  // ───── SQUEALING / SCREECHING (пийшгэн, циклеглэх) ────────────
  {
    id: "squealing",
    match: [
      /пийшг(?:эн|элж)/iu,
      /цикл(?:эг|эглэх)/iu,
      /\bsqueal(?:ing)?\b/i,
      /\bscreech(?:ing)?\b/i,
      /\bbrake(?:s)?\s+squeal/i,
      // Latin transliteration
      /\bpiishg(?:en|elj)\b/i,
      /\btsikleg(?:leh)?\b/i,
    ],
    candidates: [
      { name: "Тоормосны бул (brake pad)",        likelihood: 0.45, location: "Урд / хойд тэнхлэг",       urgency: "high",   oem_hints: "brake pad тоормосны бул" },
      { name: "Тоормосны диск (brake rotor)",     likelihood: 0.15, location: "Урд / хойд тэнхлэг",       urgency: "high",   oem_hints: "brake disc rotor тоормосны диск" },
      { name: "Сэдрэгч бүс (serpentine belt)",    likelihood: 0.15, location: "Хөдөлгүүрийн урд",         urgency: "low",    oem_hints: "serpentine belt сэдрэгч бүс" },
      { name: "Усны помпны холхивч",              likelihood: 0.10, location: "Хөдөлгүүр",                urgency: "medium", oem_hints: "water pump bearing усны помп" },
      { name: "Генераторын холхивч",              likelihood: 0.10, location: "Хөдөлгүүр",                urgency: "medium", oem_hints: "alternator bearing генератор" },
      { name: "Кондиционерын компрессор",         likelihood: 0.05, location: "Хөдөлгүүрийн урд",         urgency: "low",    oem_hints: "ac compressor конденсатор компрессор" },
    ],
    clarify: [
      "Тоормос дарахад л пийшгэн дуу гарах уу, эсвэл тоормосгүй ч гарах уу?",
      "Хүйтэн хөдөлгүүр асаахад чанга байх уу?",
    ],
  },

  // ───── VIBRATION (чичирэх) ─────────────────────────────────────
  {
    id: "vibration",
    match: [
      /чичир(?:эх|нэ|ээд)/iu,
      /хөдл(?:өх|өөд)/iu,
      /\bvibrat(?:ion|ing)\b/i,
      /\bshak(?:ing|e)\b/i,
      /хөдөлгүүр\s+чичир/iu,
      // Latin transliteration
      /\bchichir(?:eh|ne|eed)\b/i,
      /\bhudlu(?:h|ud)\b/i,
      /\bmotor\s+chichir/i,
    ],
    candidates: [
      { name: "Хөдөлгүүрийн тулгуур (engine mount)",       likelihood: 0.30, location: "Хөдөлгүүр",         urgency: "medium", oem_hints: "engine mount хөдөлгүүрийн тулгуур" },
      { name: "Дугуйн тэнцвэр (wheel balance)",             likelihood: 0.25, location: "Дугуй",              urgency: "medium", oem_hints: "wheel balance дугуй тэнцвэр" },
      { name: "Тоормосны диск гажилт (warped rotor)",       likelihood: 0.15, location: "Тоормос",            urgency: "high",   oem_hints: "brake disc warped тоормосны диск" },
      { name: "Лаа (spark plug)",                           likelihood: 0.10, location: "Хөдөлгүүр",          urgency: "low",    oem_hints: "spark plug лаа" },
      { name: "Ороомог (ignition coil)",                   likelihood: 0.10, location: "Хөдөлгүүр",          urgency: "medium", oem_hints: "ignition coil ороомог" },
      { name: "Фарсунка (injector)",                        likelihood: 0.10, location: "Хөдөлгүүр",          urgency: "medium", oem_hints: "fuel injector фарсунка" },
    ],
    clarify: [
      "Зогсож байхад чичирдэг үү, хурдтай байхад чичирдэг үү?",
      "Check Engine гэрэл ассан уу?",
    ],
  },

  // ───── WON'T START / NO POWER (асахгүй, хүчдэлгүй) ───────────
  {
    id: "wont_start",
    match: [
      /асахгүй/iu,
      /асаахгүй/iu,
      /хүчдэлгүй/iu,
      /стартердэхгүй/iu,
      /\bwon'?t\s+start\b/i,
      /\bno\s+power\b/i,
      /\bcrank(?:ing)?\b/i,
      // Latin transliteration ("asahgu", "asahgui", "huchdelgui")
      /\basahgu(?:i)?\b/i,
      /\basaahgu(?:i)?\b/i,
      /\bhuchdelgui\b/i,
      /\bstarterdehgu(?:i)?\b/i,
    ],
    candidates: [
      { name: "Аккумулятор / Батарей",          likelihood: 0.40, location: "Хөдөлгүүр", urgency: "high",   oem_hints: "battery аккум" },
      { name: "Генератор (alternator)",         likelihood: 0.20, location: "Хөдөлгүүр", urgency: "high",   oem_hints: "alternator генератор" },
      { name: "Стартер (starter)",              likelihood: 0.20, location: "Хөдөлгүүр", urgency: "high",   oem_hints: "starter стартер" },
      { name: "Түлшний помп",                   likelihood: 0.10, location: "Түлшний",   urgency: "high",   oem_hints: "fuel pump түлшний помп" },
      { name: "Асаалтын лаа (glow plug)",       likelihood: 0.05, location: "Хөдөлгүүр", urgency: "medium", oem_hints: "glow plug асаалтын лаа" },
      { name: "Иммобилайзер / Түлхүүр",         likelihood: 0.05, location: "Электрон",  urgency: "high",   oem_hints: "immobilizer key transponder" },
    ],
    clarify: [
      "Эргэлдэх дуу гарах уу, бүрэн чимээгүй юу?",
      "Гэрэл шилжих, гар ширхийх гэх мэт цахилгаан ажилладаг уу?",
    ],
  },

  // ───── OVERHEATING (хэт халалт) ────────────────────────────────
  {
    id: "overheating",
    match: [
      /хэт\s+халаа/iu,
      /халаа(?:лт|сан|даг)/iu,
      /температур\s+өндөр/iu,
      /\boverheat(?:ing)?\b/i,
      /\btemp\s+gauge\s+high\b/i,
      // Latin transliteration
      /\bhet\s+halaa/i,
      /\bhalaa(?:lt|san|dag)\b/i,
      /\btemperatur\s+(?:undur|ondor)\b/i,
    ],
    candidates: [
      { name: "Термостат (thermostat)",          likelihood: 0.30, location: "Хөдөлгүүр",         urgency: "high",  oem_hints: "thermostat термостат" },
      { name: "Усны помп (water pump)",          likelihood: 0.25, location: "Хөдөлгүүр",         urgency: "high",  oem_hints: "water pump усны помп" },
      { name: "Сэнс (cooling fan)",              likelihood: 0.20, location: "Радиатор",          urgency: "high",  oem_hints: "cooling fan сэнс" },
      { name: "Радиатор",                        likelihood: 0.15, location: "Урд",                urgency: "high",  oem_hints: "radiator радиатор" },
      { name: "Толгойн прокладка (head gasket)", likelihood: 0.05, location: "Хөдөлгүүрийн толгой", urgency: "high",  oem_hints: "head gasket толгойн прокладка" },
      { name: "Хөргөлтийн шингэн",               likelihood: 0.05, location: "Бак",                urgency: "medium",oem_hints: "coolant хөргөлтийн шингэн" },
    ],
    clarify: [
      "Хэт халалт явж байх үед эсвэл зогсоолд гардаг уу?",
      "Бакны шингэн дутагдсан байна уу?",
    ],
  },

  // ───── SMOKE / EXHAUST (утаа) ──────────────────────────────────
  {
    id: "smoke",
    match: [
      /(?:хөх|цагаан|хар)\s+утаа/iu,
      /утаа\s+(?:гарах|гарна|гардаг)/iu,
      /\bsmoke\b/i,
      /\bexhaust\s+smoke\b/i,
      // Latin transliteration ("huh utaa", "tsagaan utaa", "har utaa")
      /\b(?:huh|tsagaan|har)\s+utaa\b/i,
      /\butaa\s+gar(?:ah|na|dag)\b/i,
    ],
    candidates: [
      { name: "Толгойн прокладка (head gasket)",          likelihood: 0.25, location: "Толгой",            urgency: "high",   oem_hints: "head gasket толгойн прокладка" },
      { name: "Поршений цагираг (piston rings)",          likelihood: 0.20, location: "Цилиндр",            urgency: "high",   oem_hints: "piston rings поршений цагираг" },
      { name: "Клапаны битүүмжлэгч (valve seal)",         likelihood: 0.20, location: "Толгой",             urgency: "medium", oem_hints: "valve stem seal клапаны битүүмжлэгч" },
      { name: "Турбо / шахагч",                            likelihood: 0.15, location: "Хөдөлгүүр",          urgency: "high",   oem_hints: "turbo charger турбо" },
      { name: "Катализатор",                               likelihood: 0.10, location: "Утааны",             urgency: "medium", oem_hints: "catalytic converter катализатор" },
      { name: "Тосны шүүлтүүр / тос алдалт",              likelihood: 0.10, location: "Хөдөлгүүр",          urgency: "medium", oem_hints: "oil filter тосны шүүлтүүр" },
    ],
    clarify: [
      "Хөх утаа уу, цагаан утаа уу, хар утаа уу?",
      "Хүйтэн хөдөлгүүр асаахад л гардаг уу?",
    ],
  },

  // ───── SOFT BRAKE PEDAL (тоормосны педал зөөлөн) ──────────────
  {
    id: "soft_brake_pedal",
    match: [
      /тоормос(?:ны)?\s+педал/iu,
      /зөөлөн\s+тоормос/iu,
      /\bbrake\s+pedal\s+soft\b/i,
      /\bbrake(?:s)?\s+(?:spongy|low|sinks)/i,
      /тоормос\s+(?:зөөлөн|унаж|алга)/iu,
      // Latin transliteration ("tormos pedal", "zoolon tormos")
      /\btormos(?:nii)?\s+pedal\b/i,
      /\btoormos(?:nii)?\s+pedal\b/i,
      /\bzoolon\s+(?:tormos|toormos)\b/i,
    ],
    candidates: [
      { name: "Тоормосны шингэн алдалт (fluid leak)", likelihood: 0.30, location: "Гуурс / суппорт",        urgency: "high", oem_hints: "brake fluid hose тоормосны шингэн гуурс" },
      { name: "Үндсэн цилиндр (master cylinder)",      likelihood: 0.25, location: "Хөдөлгүүрийн өрөө",      urgency: "high", oem_hints: "master cylinder үндсэн цилиндр" },
      { name: "Тоормосны гуурс (brake hose)",           likelihood: 0.20, location: "Тэнхлэг",                urgency: "high", oem_hints: "brake hose тоормосны гуурс" },
      { name: "Тоормосны бул хэт элэгдсэн",            likelihood: 0.10, location: "Тэнхлэг",                urgency: "high", oem_hints: "brake pad worn тоормосны бул" },
      { name: "Вакуум хүчитгэгч (brake booster)",      likelihood: 0.10, location: "Хөдөлгүүрийн өрөө",      urgency: "high", oem_hints: "brake booster vacuum хүчитгэгч" },
      { name: "ABS модуль",                              likelihood: 0.05, location: "Электрон",               urgency: "high", oem_hints: "abs module" },
    ],
    clarify: [
      "Тоормос дарахад педал шалан хүртэл унах уу?",
      "Тоормосны шингэн бакны дотор хэмжээ хэвийн үү?",
    ],
  },

  // ───── ELECTRICAL (цахилгаан) ─────────────────────────────────
  {
    id: "electrical",
    match: [
      /цахилгаан\s+(?:асуудал|алга|ажиллахгүй)/iu,
      /гэрэл\s+асахгүй/iu,
      /фьюз/iu,
      /\belectric(?:al)?\s+(?:problem|fault)\b/i,
      /\bfuse\b/i,
      // Latin transliteration
      /\btsahilgaan\s+(?:asuudal|alga|ajillahgu)/i,
      /\bgerel\s+asahgu(?:i)?\b/i,
      /\bfyuz\b/i,
    ],
    candidates: [
      { name: "Фьюз (fuse)",                       likelihood: 0.30, location: "Фьюз хайрцаг", urgency: "low",    oem_hints: "fuse фьюз" },
      { name: "Реле (relay)",                       likelihood: 0.20, location: "Фьюз хайрцаг", urgency: "low",    oem_hints: "relay реле" },
      { name: "Утасны багц (wiring harness)",      likelihood: 0.20, location: "Биеийн доор",   urgency: "medium", oem_hints: "wiring harness утасны багц" },
      { name: "Аккумулятор",                        likelihood: 0.15, location: "Хөдөлгүүр",     urgency: "medium", oem_hints: "battery аккум" },
      { name: "Унтраалга (switch)",                 likelihood: 0.10, location: "Самбар",         urgency: "low",    oem_hints: "switch унтраалга" },
      { name: "BCM (Body Control Module)",          likelihood: 0.05, location: "Электрон",       urgency: "high",   oem_hints: "bcm body control module" },
    ],
    clarify: [
      "Аль электроник ажиллахгүй байна вэ — гэрэл, хаалга, шил, эсвэл өөр зүйл?",
      "Үе үе ажилладаг уу, бүрэн зогссон уу?",
    ],
  },

  // ───── WEIRD NOISE — generic catch-all (Phase M.2.3) ──────────
  // The previous patterns target SPECIFIC sounds (knocking, squealing,
  // smoke). When a user says "хачин дуу", "motor hachin dugaraad", or
  // "weird noise" we want to still recognise it as symptom-shaped so
  // the agent calls diagnose_symptom instead of jumping to product
  // search. Listed LAST so concrete patterns above always win on hits.
  //
  // Candidates here lean toward engine-related causes since that's
  // the most-common "unidentified noise" complaint; the clarifying
  // questions force a narrow-down on the next turn.
  {
    id: "weird_noise",
    match: [
      // Cyrillic
      /хачин\s+(?:дуу|чимээ)/iu,
      /хачин\s+дуугар/iu,
      /чимээ\s+гар(?:ах|на|даг)/iu,
      /(?:дугуй|мотор|хөдөлгүүр)\s+дуугар/iu,
      // Latin transliteration
      /\bhachin\s+(?:duu|chimee)\b/i,
      /\bhachin\s+dugar/i,
      /\b(?:motor|hudulguur|dugui)\s+dugar/i,
      /\bdugaraad\s+baina\b/i,
      /\bchimee\s+gar(?:ah|na|dag)\b/i,
      // English
      /\bweird\s+(?:noise|sound)\b/i,
      /\bstrange\s+(?:noise|sound)\b/i,
      /\bmaking\s+(?:a\s+)?(?:weird|strange|odd)\s+(?:noise|sound)\b/i,
    ],
    candidates: [
      { name: "Хөдөлгүүрийн ороомог (ignition coil)",  likelihood: 0.18, location: "Хөдөлгүүр",     urgency: "medium", oem_hints: "ignition coil ороомог" },
      { name: "Лаа (spark plug)",                       likelihood: 0.15, location: "Хөдөлгүүр",     urgency: "low",    oem_hints: "spark plug лаа" },
      { name: "Хөдөлгүүрийн тулгуур (engine mount)",    likelihood: 0.15, location: "Хөдөлгүүр",     urgency: "medium", oem_hints: "engine mount тулгуур" },
      { name: "Дугуйн холхивч (wheel bearing)",         likelihood: 0.15, location: "Тэнхлэг",       urgency: "high",   oem_hints: "wheel bearing холхивч" },
      { name: "Сэдрэгч бүс (serpentine belt)",          likelihood: 0.12, location: "Хөдөлгүүрийн урд", urgency: "low",  oem_hints: "serpentine belt сэдрэгч бүс" },
      { name: "Утааны систем (exhaust leak)",            likelihood: 0.10, location: "Утаа",           urgency: "medium", oem_hints: "exhaust gasket утааны" },
      { name: "Дамжуулга / араа (transmission)",         likelihood: 0.10, location: "Дамжуулга",     urgency: "high",   oem_hints: "transmission дамжуулга" },
      { name: "Бусад — нэмэлт оношилгоо хэрэгтэй",      likelihood: 0.05, location: "Мэдэгдэхгүй",   urgency: "medium", oem_hints: "" },
    ],
    clarify: [
      "Дуу нь хаанаас гарч байна вэ — хөдөлгүүр, тэнхлэг, эсвэл доороос?",
      "Зогсож байхад л гарах уу, явж байхад л гарах уу, эсвэл хоёуланд нь?",
      "Дуу ямар маягтай вэ — нүдгэр, шиглэх, чимээтэй унтрах, эсвэл өөр?",
    ],
  },
];

// ────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────

/**
 * Diagnose a free-form symptom description. Returns the best-matching
 * pattern's candidate list and clarifying questions. When nothing
 * matches, returns null so the caller can fall through to a generic
 * "tell me more" reply.
 *
 *   {
 *     symptom:           "Дугуй тог тог дуугарна",
 *     patternId:         "knocking_suspension",
 *     candidates:        [{ name, likelihood, location, urgency, oem_hints }, …],
 *     clarifyingQuestions: ["Хурдалтад чанга болдог уу?", …],
 *     urgency:           "high",   // max urgency among candidates
 *     matchStrength:     0.95,     // hits / max-pattern-hits (0..1)
 *   }
 */
export const diagnoseSymptom = (text) => {
  const s = String(text || "");
  if (s.length < 3) return null;

  let best = null;
  for (const pattern of PATTERNS) {
    const hits = pattern.match.reduce((n, rx) => n + (rx.test(s) ? 1 : 0), 0);
    if (hits === 0) continue;
    if (!best || hits > best._hits) {
      best = { ...pattern, _hits: hits };
    }
  }
  if (!best) return null;

  // Top urgency wins for the card-level chrome.
  const urgencyRank = { low: 0, medium: 1, high: 2 };
  const urgency = best.candidates.reduce((u, c) =>
    urgencyRank[c.urgency] > urgencyRank[u] ? c.urgency : u, "low");

  return {
    symptom:             s,
    patternId:           best.id,
    candidates:          best.candidates,
    clarifyingQuestions: best.clarify,
    urgency,
    matchStrength:       Math.min(1, best._hits / 3),
  };
};

/**
 * Tells callers whether a query is "symptom-shaped" — used by the
 * controller to prefer diagnose_symptom over search_products on the
 * first round. A bare keyword like "тоормос" is NOT a symptom; a
 * description like "тоормосны педал зөөлөн" IS.
 */
export const isSymptomShaped = (text) => {
  const s = String(text || "");
  return PATTERNS.some((p) => p.match.some((rx) => rx.test(s)));
};

// Test/ops exports
export const __internal = Object.freeze({
  PATTERN_COUNT: PATTERNS.length,
  PATTERN_IDS: PATTERNS.map((p) => p.id),
});
