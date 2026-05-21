/**
 * Latin-Mongolian Transliteration & Semantic Expansion Service
 *
 * Real-world problem in HiCar's user base:
 *   • Mongolian speakers frequently type Cyrillic words in LATIN script
 *     (no Cyrillic keyboard, mobile typing speed, social-media habits).
 *     Examples: "amortizator", "tormos", "bafer", "ajilgaa", "gvper".
 *   • Workshop mechanics use heavy slang that also gets latinised —
 *     "sharov" for ball joint, "saylentblok" for bushing, "stupitsa" for
 *     hub bearing.
 *   • Many users mix Mongolian Cyrillic + Russian loanwords + English in
 *     a single query: "tormosni jishig naklad ajilgaa".
 *   • The product catalogue is stored in mixed Cyrillic + English; raw
 *     Latin-Mongolian tokens hit nothing.
 *
 * What this module does:
 *   ① Maintains a hand-curated dictionary of ~85 high-frequency car-parts
 *      terms, each entry tying together its Latin variants, Cyrillic
 *      spelling, English equivalent, and (optionally) the catalogue
 *      category.
 *   ② Exposes `transliterate(text)` — tokenises the input, looks each
 *      token up in the dictionary, and returns a structured object the
 *      caller can use to build a search-query expansion OR inject a hint
 *      into the LLM's system prompt.
 *   ③ Exposes `formatHint(hits, locale)` — pretty-prints the hits as a
 *      compact instruction block ready to drop into the system prompt.
 *
 * Why a deterministic dictionary AND a system-prompt hint?
 *   The dictionary catches common cases predictably (zero LLM cost, zero
 *   latency, zero hallucination risk). The system prompt teaches the
 *   model the GENERAL pattern so it can extend gracefully to the long
 *   tail of variants the dictionary doesn't enumerate.
 */

// ────────────────────────────────────────────────────────────────────
// Canonical categories — match the search_products tool's enum exactly.
// ────────────────────────────────────────────────────────────────────
const CATEGORY = {
  BRAKE:        "brake",
  ENGINE:       "engine",
  LIGHTING:     "lighting",
  SUSPENSION:   "suspension",
  ELECTRIC:     "electric",
  BODY:         "body",
  TRANSMISSION: "transmission",
  OTHER:        "other",
};

// ────────────────────────────────────────────────────────────────────
// TERMS — canonical entries. Each lists every transliteration variant
// we accept. Order in `variants` doesn't matter; lookup is case-
// insensitive. Multi-word variants ("tormosni shlang", "tosni filter")
// are scanned by the sliding window in scanHits (MAX_WINDOW=3).
// ────────────────────────────────────────────────────────────────────
const TERMS = [
  // ── BRAKE SYSTEM ──────────────────────────────────────────────────
  { mn: "тоормос",          en: "brake",         category: CATEGORY.BRAKE,
    variants: ["tormos", "tormoz", "тормоз", "тоормос", "тормос", "brake"] },
  { mn: "наклад",           en: "brake pad",     category: CATEGORY.BRAKE,
    variants: ["naklad", "nakladka", "наклад", "колодка", "kolodka", "brake pad"] },
  { mn: "тоормосны диск",   en: "brake disc",    category: CATEGORY.BRAKE,
    variants: ["disk", "диск", "jishig", "jishg", "tormos disk", "tormosni disk", "tormosni jishig",
               "brake disc", "rotor", "ротор", "дискэн тормос"] },
  { mn: "тоормосны шингэн", en: "brake fluid",   category: CATEGORY.BRAKE,
    variants: ["tormoz fluid", "tormos shingen", "тормозын шингэн", "brake fluid",
               "dot3", "dot4", "dot5", "dot 3", "dot 4", "dot 5",
               "тоормосны шингэн", "тормос масло", "тормозная жидкость"] },
  { mn: "тоормосны шланг",  en: "brake hose",    category: CATEGORY.BRAKE,
    variants: ["tormos shlang", "tormosni shlang", "tormosni vishki", "brake hose", "tormoz shlang"] },
  { mn: "супорт",           en: "brake caliper", category: CATEGORY.BRAKE,
    variants: ["suport", "support", "супорт", "суппорт", "caliper", "brake caliper"] },

  // ── ENGINE ────────────────────────────────────────────────────────
  { mn: "хөдөлгүүр",         en: "engine",       category: CATEGORY.ENGINE,
    variants: ["motor", "motir", "hudulgur", "хөдөлгүүр", "engine", "мотор"] },
  { mn: "поршень",           en: "piston",       category: CATEGORY.ENGINE,
    variants: ["porshin", "porshen", "поршень", "porshni", "piston"] },
  { mn: "клапан",            en: "valve",        category: CATEGORY.ENGINE,
    variants: ["klapan", "клапан", "valve"] },
  { mn: "тосны шүүлтүүр",    en: "oil filter",   category: CATEGORY.ENGINE,
    variants: ["filter", "filtr", "filtur", "tosni filter", "tosnii filter",
               "шүүлтүүр", "oil filter", "тосны филтр", "тосны шүүлтүүр"] },
  { mn: "агаарын шүүлтүүр",  en: "air filter",   category: CATEGORY.ENGINE,
    variants: ["agaariin filter", "agariin filter", "air filter", "агаарын шүүлтүүр", "agar filtr"] },
  { mn: "түлшний шүүлтүүр",  en: "fuel filter",  category: CATEGORY.ENGINE,
    variants: ["fuel filter", "tulshni shuultur", "tulsh filter", "түлшний шүүлтүүр"] },
  { mn: "салоны шүүлтүүр",   en: "cabin filter", category: CATEGORY.OTHER,
    variants: ["saloni filter", "salonii filter", "cabin filter",
               "салоны шүүлтүүр", "салонный фильтр", "салоны филтр"] },
  { mn: "тос",               en: "engine oil",   category: CATEGORY.ENGINE,
    variants: ["maasl", "masla", "tos", "тос", "масл", "oil", "engine oil", "motor oil",
               "motoriin tos", "хөдөлгүүрийн тос", "масло двигателя"] },
  { mn: "форсунка",          en: "fuel injector", category: CATEGORY.ENGINE,
    variants: ["forsunka", "форсунка", "injector", "fuel injector"] },
  { mn: "радиатор",          en: "radiator",     category: CATEGORY.ENGINE,
    variants: ["radiator", "радиатор", "kuller", "куллер"] },
  { mn: "хөргөлтийн шингэн", en: "coolant",      category: CATEGORY.ENGINE,
    variants: ["coolant", "антифриз", "antifriz", "antifreeze", "hurgultiin shingen",
               "tosol", "тосол",
               "g11", "g12", "g13",
               "ethylene glycol", "хөргөлтийн шингэн",
               "ногоон антифриз", "ягаан антифриз", "улаан антифриз"] },
  { mn: "дуу намсгуур",      en: "muffler",      category: CATEGORY.ENGINE,
    variants: ["mufler", "глушитель", "glushitel", "muffler", "duu namsguur"] },
  { mn: "хөдөлгүүрийн бүс",  en: "timing belt",  category: CATEGORY.ENGINE,
    variants: ["remen", "remis", "ремен", "ремень", "belt", "timing belt", "бүс", "холбоос бүс"] },
  { mn: "шланг",             en: "hose",         category: CATEGORY.OTHER,
    variants: ["shlang", "shlangi", "шланг", "hose"] },
  { mn: "усны насос",        en: "water pump",   category: CATEGORY.ENGINE,
    variants: ["usni nasos", "water pump", "помпа", "pompa", "pomp", "pompo", "помп", "водяной насос"] },
  { mn: "түлшний насос",     en: "fuel pump",    category: CATEGORY.ENGINE,
    variants: ["fuel pump", "tulshni nasos", "топливный насос"] },
  { mn: "галын лаа",         en: "glow plug",    category: CATEGORY.ENGINE,
    variants: ["glow plug", "galiin laa", "свеча накала"] },
  { mn: "термостат",         en: "thermostat",   category: CATEGORY.ENGINE,
    variants: ["termostat", "термостат", "thermostat"] },
  { mn: "жийрэг",            en: "gasket",       category: CATEGORY.ENGINE,
    variants: ["prokladka", "prokladk", "прокладка", "gasket", "жийрэг", "жийргэвч"] },

  // ── ELECTRIC / IGNITION ───────────────────────────────────────────
  { mn: "цахилгаан гэрлийн лаа", en: "spark plug", category: CATEGORY.ELECTRIC,
    variants: ["svidv", "svecha", "svechi", "sveche", "свеча", "свеч",
               "лаа", "лав", "spark plug", "лаавч", "очлуур"] },
  { mn: "генератор",         en: "alternator",   category: CATEGORY.ELECTRIC,
    variants: ["generator", "ginerator", "dinamo", "динамо", "генератор", "alternator"] },
  { mn: "стартер",           en: "starter motor", category: CATEGORY.ELECTRIC,
    variants: ["starter", "стартер", "starter motor"] },
  { mn: "аккумулятор",       en: "battery",      category: CATEGORY.ELECTRIC,
    variants: ["akku", "akb", "akkumulyator", "akkumlyator", "akulyator",
               "аккумулятор", "аккумлятор", "battery", "акку"] },
  { mn: "катушка",           en: "ignition coil", category: CATEGORY.ELECTRIC,
    variants: ["katushka", "babine", "babin", "бабин", "катушка",
               "coil", "ignition coil", "асаах ороомог"] },
  { mn: "мэдрэгч",           en: "sensor",       category: CATEGORY.ELECTRIC,
    variants: ["medregch", "мэдрэгч", "sensor", "датчик", "datchik"] },
  { mn: "хүчдэлийн релэ",    en: "voltage relay", category: CATEGORY.ELECTRIC,
    variants: ["rele", "релэ", "реле", "relay", "voltage relay"] },
  { mn: "ECU",               en: "ECU",          category: CATEGORY.ELECTRIC,
    variants: ["ecu", "чип", "chip", "ecm", "engine control unit"] },
  { mn: "сэлбэг утас",       en: "wiring harness", category: CATEGORY.ELECTRIC,
    variants: ["selbeg utas", "проводка", "wiring", "wiring harness", "provodka"] },

  // ── SUSPENSION / STEERING ────────────────────────────────────────
  { mn: "амортизатор",       en: "shock absorber", category: CATEGORY.SUSPENSION,
    variants: ["amortizator", "amrazitr", "amartizatr", "амортизатор", "shock absorber", "shock"] },
  { mn: "пүрш",              en: "spring",       category: CATEGORY.SUSPENSION,
    variants: ["pruzhin", "prujin", "pursh", "пүрш", "пружин", "пружина", "spring", "coil spring"] },
  { mn: "тулгуур",           en: "control arm",  category: CATEGORY.SUSPENSION,
    variants: ["tulguur", "ричаг", "richag", "control arm", "тулгуур"] },
  { mn: "доод гар",          en: "lower control arm", category: CATEGORY.SUSPENSION,
    variants: ["gitar", "gitara", "гитар", "гитара", "доод гар",
               "lower control arm", "lower arm"] },
  { mn: "өндгөн тулгуур",    en: "ball joint",   category: CATEGORY.SUSPENSION,
    variants: ["sharov", "sharovoi", "шаровая", "шаровая опора",
               "ball joint", "өндгөн тулгуур"] },
  { mn: "сайлентблок",       en: "bushing",      category: CATEGORY.SUSPENSION,
    variants: ["saylentblok", "sailentblok", "сайлентблок", "силент блок",
               "bushing", "rubber bushing"] },
  { mn: "втулка",            en: "sleeve bushing", category: CATEGORY.SUSPENSION,
    variants: ["vtulka", "втулка", "sleeve bushing", "резин жийрэг"] },
  { mn: "татах рулийн цаг",  en: "tie rod",      category: CATEGORY.SUSPENSION,
    variants: ["tyag", "tiag", "тяга", "тяг", "tie rod", "татах рулийн цаг"] },
  { mn: "рулийн үзүүр",      en: "tie rod end",  category: CATEGORY.SUSPENSION,
    variants: ["nakonechnik", "наконечник", "tie rod end", "рулийн үзүүр"] },
  { mn: "стабилизатор",      en: "sway bar",     category: CATEGORY.SUSPENSION,
    variants: ["stabilizator", "stabiliator", "stablizator", "стабилизатор",
               "тэнцүүлэгч", "sway bar", "anti-roll bar"] },
  { mn: "жолооны хүрд",      en: "steering wheel", category: CATEGORY.OTHER,
    variants: ["rul", "rool", "ruul", "руль", "steering wheel", "joloo"] },
  { mn: "жолооны рейка",     en: "steering rack", category: CATEGORY.SUSPENSION,
    variants: ["reyka", "rejka", "рейка", "steering rack"] },
  { mn: "холхивч",           en: "bearing",      category: CATEGORY.SUSPENSION,
    variants: ["podshipnik", "шарик", "подшипник", "bearing", "холхивч"] },
  { mn: "цапны холхивч",     en: "wheel hub bearing", category: CATEGORY.SUSPENSION,
    variants: ["stupica", "stupits", "stupitsa", "ступица",
               "wheel hub bearing", "цапны холхивч"] },
  { mn: "гулсуур",           en: "wheel hub",    category: CATEGORY.SUSPENSION,
    variants: ["gulsuur", "hub", "wheel hub"] },

  // ── BODY ─────────────────────────────────────────────────────────
  { mn: "бампер",            en: "bumper",       category: CATEGORY.BODY,
    variants: ["bumper", "bampr", "bamper", "bafer", "bafr",
               "gvper", "guper", "gupir", "gvpir", "гүпер", "бафер", "бампер"] },
  { mn: "капот",             en: "hood",         category: CATEGORY.BODY,
    variants: ["kapot", "kaput", "капот", "hood", "bonnet",
               "hamar", "mashinii hamar", "хамар", "машины хамар"] },
  { mn: "толь",              en: "side mirror",  category: CATEGORY.BODY,
    variants: ["tol", "toil", "толь", "зеркало", "zerkalo", "side mirror", "mirror"] },
  { mn: "хаалга",            en: "door",         category: CATEGORY.BODY,
    variants: ["haalga", "halga", "хаалга", "door", "дверь"] },
  { mn: "хаалганы хэрэгсэл", en: "door hardware", category: CATEGORY.BODY,
    variants: ["haalgand", "haalganii", "door handle", "door hinge",
               "хаалганы бариул", "хаалганы нугас"] },
  { mn: "цонх",              en: "window",       category: CATEGORY.BODY,
    variants: ["tsonkh", "цонх", "window", "стекло", "steklo"] },
  { mn: "шил",               en: "windshield",   category: CATEGORY.BODY,
    variants: ["windshield", "лобовое", "lobovoe", "ön cam", "шил"] },

  // ── LIGHTING ─────────────────────────────────────────────────────
  { mn: "фар",               en: "headlight",    category: CATEGORY.LIGHTING,
    variants: ["far", "fara", "fary", "фар", "headlight", "head light",
               "грэл", "grel", "их гэрэл"] },
  { mn: "буцах гэрэл",       en: "tail light",   category: CATEGORY.LIGHTING,
    variants: ["butsah gerel", "tail light", "rear light",
               "стоп", "stop", "stob", "стоп гэрэл", "брейк гэрэл"] },
  { mn: "дохио гэрэл",       en: "turn signal",  category: CATEGORY.LIGHTING,
    variants: ["dohio gerel", "повторитель", "turn signal", "indicator", "поворотник",
               "povort", "povorot", "дохионы гэрэл"] },
  { mn: "тоомсон гэрэл",     en: "fog light",    category: CATEGORY.LIGHTING,
    variants: ["fog light", "противотуманка", "пть"] },
  { mn: "халоген лаа",       en: "halogen bulb", category: CATEGORY.LIGHTING,
    variants: ["halogen", "галоген", "halogen bulb", "halogen lamp"] },
  { mn: "ксенон лаа",        en: "xenon bulb",   category: CATEGORY.LIGHTING,
    variants: ["ksenon", "ксенон", "xenon bulb", "xenon lamp", "hid"] },

  // ── WHEELS / TIRES ───────────────────────────────────────────────
  { mn: "шин",               en: "tire",         category: CATEGORY.OTHER,
    variants: ["shina", "shin", "шин", "тайр", "tire", "tyre", "резина", "pokrishka", "покрышка"] },
  { mn: "дугуй",             en: "wheel",        category: CATEGORY.OTHER,
    variants: ["dugui", "duguinuud", "дугуй", "wheel", "дугуйнууд"] },
  { mn: "обуд",              en: "rim",          category: CATEGORY.OTHER,
    variants: ["obud", "obut", "obod", "обуд", "rim", "rims", "rimsuud", "wheel rim", "ободок"] },

  // ── TRANSMISSION ─────────────────────────────────────────────────
  { mn: "автомат хайрцаг",   en: "automatic transmission", category: CATEGORY.TRANSMISSION,
    variants: ["avtomat", "automatic", "автомат", "atf", "автомат хайрцаг"] },
  { mn: "механик хайрцаг",   en: "manual transmission", category: CATEGORY.TRANSMISSION,
    variants: ["mehanik", "manual", "механик", "manual transmission"] },
  { mn: "клатч",             en: "clutch",       category: CATEGORY.TRANSMISSION,
    variants: ["klatch", "клатч", "сцепление", "stseplenie", "clutch"] },
  { mn: "приводны вал",      en: "drive shaft",  category: CATEGORY.TRANSMISSION,
    variants: ["shaft", "val", "вал", "drive shaft", "карданный вал"] },
  { mn: "ялгуурын тос",      en: "transmission fluid", category: CATEGORY.TRANSMISSION,
    variants: ["transmission fluid", "atf", "atf тос", "atf масло",
               "shaagiin tos", "ялгуурын тос",
               "автомат тос", "automat tos", "avtomat tos", "automatic transmission oil",
               "механик тос", "mehanik tos", "manual gear oil", "manual tos",
               "cvt fluid", "cvt тос", "cvt масло",
               "gear oil", "gearbox oil"] },

  // ── LUBRICANTS / OILS / FLUIDS ───────────────────────────────────
  // Engine-oil grades. The catalogue typically has separate SKUs per
  // grade so we keep them as DISTINCT canonical entries.
  { mn: "синтетик тос",      en: "synthetic oil",      category: CATEGORY.ENGINE,
    variants: ["sintetik", "synthetic oil", "synthetic", "fully synthetic",
               "синтетик", "синтетик тос", "синтетика", "synthetik"] },
  { mn: "хагас синтетик тос", en: "semi-synthetic oil", category: CATEGORY.ENGINE,
    variants: ["semi synthetic", "semi-synthetic", "хагас синтетик",
               "хагас синтетик тос", "полусинтетика", "polusintetika", "polusintetik"] },
  { mn: "минерал тос",       en: "mineral oil",        category: CATEGORY.ENGINE,
    variants: ["mineral", "mineral oil", "минерал", "минерал тос", "минералка", "mineralka"] },

  // Specialised fluids that aren't engine/transmission/coolant/brake.
  { mn: "рулийн хүчдэгч шингэн", en: "power steering fluid", category: CATEGORY.SUSPENSION,
    variants: ["power steering fluid", "ps fluid", "psf",
               "рулийн хүчдэгч", "рулийн хүчдэгч шингэн",
               "gur tos", "гидроусилитель", "gidrousilitel"] },
  { mn: "ялгаврын тос",      en: "differential oil",   category: CATEGORY.TRANSMISSION,
    variants: ["differential oil", "diff oil", "diferentsial",
               "ялгаврын тос", "мостын тос", "хойд гүүрийн тос",
               "rear axle oil", "axle oil"] },
  { mn: "гидроликийн тос",   en: "hydraulic oil",      category: CATEGORY.OTHER,
    variants: ["hydraulic oil", "hydraulic fluid", "гидроликийн тос",
               "гидравлика", "hidravlika", "gidravlika"] },

  // Greases — three distinct products that Mongolian mechanics name
  // separately. Litol and solidol are originally brand names that
  // became genericised.
  { mn: "тосон тос",         en: "grease",             category: CATEGORY.OTHER,
    variants: ["grease", "смазка", "smazka", "тосон тос", "тослох тос", "lubricant"] },
  { mn: "литол",             en: "lithium grease",     category: CATEGORY.OTHER,
    variants: ["litol", "litol-24", "литол", "литол-24", "lithium grease", "li grease"] },
  { mn: "солидол",           en: "solid grease",       category: CATEGORY.OTHER,
    variants: ["solidol", "солидол", "solid grease", "graphite grease", "graphitnaya"] },

  // Washer fluid — common search, sometimes typed Russian-style.
  { mn: "шилний угаагч шингэн", en: "windshield washer fluid", category: CATEGORY.OTHER,
    variants: ["windshield washer", "washer fluid",
               "омыватель", "омывачка", "omyvatel", "omyvachka",
               "шилний угаагч", "шилний угаагч шингэн", "шилний шингэн"] },

  // Lubrication-system parts. The OIL pump is a DIFFERENT part from the
  // water pump (тосны насос vs усны насос) — both exist on the engine.
  { mn: "тосны насос",       en: "oil pump",           category: CATEGORY.ENGINE,
    variants: ["oil pump", "тосны насос", "tosni nasos", "tosnii nasos",
               "масляный насос", "маслонасос"] },
  { mn: "тосны таваг",       en: "oil pan",            category: CATEGORY.ENGINE,
    variants: ["oil pan", "oil sump", "тосны таваг",
               "картер", "kartr", "kartriin tos", "kartriin tagaa",
               "масляный картер"] },
  { mn: "тос гаргах боолт",  en: "oil drain plug",     category: CATEGORY.ENGINE,
    variants: ["oil drain plug", "drain plug", "drain bolt",
               "пробка слива", "сливная пробка", "тос гаргах боолт"] },
  { mn: "тосны таглаа",      en: "oil cap",            category: CATEGORY.ENGINE,
    variants: ["oil cap", "oil filler cap", "тосны таглаа",
               "крышка масла", "крышка маслозаливной"] },
  { mn: "тосны жийрэг",      en: "oil seal",           category: CATEGORY.ENGINE,
    variants: ["oil seal", "тосны жийрэг", "сальник", "salnik", "salinik"] },
  { mn: "тос хөргүүр",       en: "oil cooler",         category: CATEGORY.ENGINE,
    variants: ["oil cooler", "тос хөргүүр", "охладитель масла", "ohladitel masla"] },
  { mn: "тосны хэмжих хайс", en: "oil dipstick",       category: CATEGORY.ENGINE,
    variants: ["dipstick", "oil dipstick", "тосны хэмжих хайс",
               "тосны хэмжүүр", "тосны щуп", "масляный щуп", "shtup"] },

  // Universal lubricant / penetrating oil — brand-genericised.
  { mn: "нэвт өрсөгч тос",   en: "penetrating oil",    category: CATEGORY.OTHER,
    variants: ["wd-40", "wd40", "penetrating oil", "нэвт өрсөгч тос",
               "вэдэшка", "vede shka"] },

  // General concept — "lubrication" as a search topic. Not a part itself
  // but routes the LLM to the right category.
  { mn: "тосологоо",         en: "lubrication",        category: CATEGORY.ENGINE,
    variants: ["tosolgoo", "tosologo", "тосологоо", "тосолгоо", "lubrication",
               "lube", "tosolgo"] },

  // ── SYMPTOMS / SLANG (not parts — used to refine search) ─────────
  { mn: "ажиллахгүй",        en: "not working",  category: CATEGORY.OTHER,
    variants: ["ajilgaa", "ажилгаа", "ажиллахгүй", "not working", "broken", "эвдэрсэн"] },
  { mn: "дуу гаргах",        en: "making noise", category: CATEGORY.OTHER,
    variants: ["duu garna", "duu garah", "making noise", "noisy", "хийсхийх"] },
  { mn: "халах",             en: "overheating",  category: CATEGORY.ENGINE,
    variants: ["khalakh", "халах", "overheating", "перегрев"] },
  { mn: "утаа гарах",        en: "smoking",      category: CATEGORY.ENGINE,
    variants: ["utaa garah", "smoking", "белый дым", "blue smoke"] },
];

// ────────────────────────────────────────────────────────────────────
// Lookup table — built once at module load. Lower-cased variants →
// canonical entry. Multiple variants point to the SAME object reference
// (lookup is fast + memory-efficient).
// ────────────────────────────────────────────────────────────────────
const LOOKUP = new Map();
for (const term of TERMS) {
  const canonical = { mn: term.mn, en: term.en, category: term.category };
  for (const v of term.variants) {
    LOOKUP.set(v.toLowerCase().trim(), canonical);
  }
}

/** All known canonical entries — handy for the prompt's example list. */
export const KNOWN_CANONICALS = TERMS.map((t) => ({ mn: t.mn, en: t.en, category: t.category }));

// ────────────────────────────────────────────────────────────────────
// Tokeniser — splits the input on whitespace, strips edge punctuation,
// preserves multi-char single tokens. Multi-word terms like "brake pad"
// or "тоормосны диск" are scanned via a sliding window so we don't miss
// them.
// ────────────────────────────────────────────────────────────────────
const tokenise = (text) => {
  return String(text || "")
    .split(/\s+/)
    .map((tok) => tok.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter(Boolean);
};

/**
 * Window scan: prefer LONGER matches first (e.g. "brake pad" beats
 * "brake" alone). Returns ordered hits with their original surface
 * forms so the caller can show "you typed X, we mapped to Y" if needed.
 */
const MAX_WINDOW = 3;
const scanHits = (tokens) => {
  const hits = [];
  let i = 0;
  while (i < tokens.length) {
    let matched = null;
    let consumed = 1;
    for (let w = Math.min(MAX_WINDOW, tokens.length - i); w >= 1; w--) {
      const phrase = tokens.slice(i, i + w).join(" ").toLowerCase();
      const found = LOOKUP.get(phrase);
      if (found) {
        matched = { surface: tokens.slice(i, i + w).join(" "), ...found };
        consumed = w;
        break;
      }
    }
    if (matched) hits.push(matched);
    i += consumed;
  }
  return hits;
};

/**
 * Main entrypoint.
 *
 * @param {string} text - raw user text (Latin, Cyrillic, English, or mixed)
 * @returns {{
 *   hits:        Array<{ surface, mn, en, category }>,
 *   hasHits:     boolean,
 *   expandedQuery: string,
 *   bestCategory: string|null,
 * }}
 */
export const transliterate = (text) => {
  const tokens = tokenise(text);
  if (tokens.length === 0) {
    return { hits: [], hasHits: false, expandedQuery: "", bestCategory: null };
  }
  const hits = scanHits(tokens);
  if (hits.length === 0) {
    return { hits, hasHits: false, expandedQuery: String(text), bestCategory: null };
  }

  // Stitch a single expanded string — replace each recognised phrase
  // with its `mn en` pair so the downstream search sees BOTH spellings.
  let cursor = 0;
  const out = [];
  const lower = String(text).toLowerCase();
  for (const h of hits) {
    const surface = h.surface.toLowerCase();
    const idx = lower.indexOf(surface, cursor);
    if (idx === -1) continue;
    if (idx > cursor) out.push(text.slice(cursor, idx));
    out.push(`${h.mn} ${h.en}`);
    cursor = idx + surface.length;
  }
  if (cursor < text.length) out.push(text.slice(cursor));

  // Pick the category most frequently represented in the hits.
  const catFreq = new Map();
  for (const h of hits) catFreq.set(h.category, (catFreq.get(h.category) || 0) + 1);
  const bestCategory = [...catFreq.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  return {
    hits,
    hasHits: true,
    expandedQuery: out.join("").trim(),
    bestCategory,
  };
};

/**
 * Render the hits as a compact instruction block for the LLM system
 * prompt. Locale-aware. Returns "" when no hits — caller can safely
 * concatenate this into any prompt unconditionally.
 */
export const formatHint = ({ hits, expandedQuery, bestCategory }, locale = "mn") => {
  if (!hits || hits.length === 0) return "";

  const lines = hits.map((h) => `  - "${h.surface}" → ${h.mn} (${h.en})`).join("\n");
  if (locale === "en") {
    return [
      "",
      "── TRANSLITERATION HINT (deterministic dictionary match) ──",
      "The user wrote a query that includes Latin-Mongolian transliteration.",
      "Recognised mappings:",
      lines,
      `Suggested expanded query: "${expandedQuery}"`,
      bestCategory ? `Suggested category: "${bestCategory}"` : "",
      "When you call search_products, USE THE EXPANDED QUERY combining both",
      "the Cyrillic and English terms. This maximises catalogue coverage.",
    ].filter(Boolean).join("\n");
  }
  return [
    "",
    "── ТРАНСЛИТ ЗААВАР (тогтсон үг зүйн таалал) ──",
    "Хэрэглэгч латин-Монгол транслитээр бичсэн. Танигдсан таалал:",
    lines,
    `Санал болгож буй өргөтгөсөн query: "${expandedQuery}"`,
    bestCategory ? `Санал болгож буй category: "${bestCategory}"` : "",
    "search_products дуудахдаа МОНГОЛ + АНГЛИ ХОЁУЛАНГ нь нэгтгэсэн query ашиглах.",
    "Тэгснээр каталоги дахь олдоц хамгийн өндөр байна.",
  ].filter(Boolean).join("\n");
};

// ────────────────────────────────────────────────────────────────────
// Static system-prompt addendum — the GENERAL rule the LLM learns even
// when the deterministic dictionary doesn't match. Appended once per
// invocation by buildSystemPrompt. Kept compact (every token costs
// money) but covers the 17 highest-frequency patterns + phonetic rules
// so the model can extend to unseen variants.
// ────────────────────────────────────────────────────────────────────
export const TRANSLIT_INSTRUCTION_EN = [
  "",
  "LATIN-MONGOLIAN COMPREHENSION:",
  "Mongolian users frequently type Cyrillic words using the Latin alphabet.",
  "Map them BEFORE calling search_products. Common patterns:",
  "  amortizator → амортизатор / shock absorber",
  "  tormos → тоормос / brake",
  "  naklad · nakladka → наклад / brake pad",
  "  jishig · jishg → тоормосны диск / brake disc",
  "  suport · support → супорт / brake caliper",
  "  bafer · bamper · gvper · guper → бампер / bumper",
  "  kapot · kaput · hamar → капот / hood",
  "  grel · far · fara → фар / headlight",
  "  stop · stob → буцах гэрэл / tail light",
  "  povort · povorot → дохио гэрэл / turn signal",
  "  motor · hudulgur → хөдөлгүүр / engine",
  "  shlang → шланг / hose",
  "  porshin → поршень / piston",
  "  svidv · svecha · svechi → лаа / spark plug",
  "  babine · babin → катушка / ignition coil",
  "  akku · akb · akulyator → аккумулятор / battery",
  "  dinamo → генератор / alternator",
  "  prujin · pursh → пүрш / spring",
  "  sharov · sharovoi → өндгөн тулгуур / ball joint",
  "  saylentblok → сайлентблок / bushing",
  "  podshipnik → холхивч / bearing",
  "  stupitsa · stupits → цапны холхивч / wheel hub bearing",
  "  gitar · gitara → доод гар / lower control arm",
  "  obud · obut · rim → обуд / rim",
  "  dugui → дугуй / wheel",
  "  pokrishka · shina → шин / tire",
  "  halga · haalga → хаалга / door",
  "  toil · tol → толь / side mirror",
  "  pomp · pompo → усны насос / water pump",
  "  prokladka → жийрэг / gasket",
  "  tos · masla → тос / engine oil",
  "  sintetik → синтетик тос / synthetic oil",
  "  litol → литол / lithium grease",
  "  smazka → тосон тос / grease",
  "  omyvatel → шилний угаагч шингэн / washer fluid",
  "  tosni nasos → тосны насос / oil pump (engine — distinct from water pump)",
  "  ajilgaa → ажиллахгүй (symptom, not a part — narrow by behaviour)",
  "Phonetic rules: kh→х · ch→ч · sh→ш · zh→ж · ya→я · yu→ю · gh→г · yo→ё",
  "ALWAYS expand the query to include BOTH the Mongolian Cyrillic name AND",
  "the precise English automotive term. Example:",
  '  search_products({ query: "тоормос brake", category: "brake" })',
  "When you cannot decide between two readings, prefer the English term —",
  "the catalogue has stronger English coverage.",
].join("\n");

export const TRANSLIT_INSTRUCTION_MN = [
  "",
  "ЛАТИН-МОНГОЛ ОЙЛГОЛТ:",
  "Хэрэглэгч кирилл үгийг латин үсгээр бичих нь түгээмэл.",
  "search_products дуудахаасаа өмнө орчуул. Жишээ:",
  "  amortizator → амортизатор / shock absorber",
  "  tormos → тоормос / brake",
  "  naklad · nakladka → наклад / brake pad",
  "  jishig · jishg → тоормосны диск / brake disc",
  "  suport → супорт / brake caliper",
  "  bafer · bamper · gvper · guper → бампер / bumper",
  "  kapot · kaput · hamar → капот / hood",
  "  grel · far · fara → фар / headlight",
  "  stop · stob → буцах гэрэл / tail light",
  "  povort · povorot → дохио гэрэл / turn signal",
  "  motor · hudulgur → хөдөлгүүр / engine",
  "  shlang → шланг / hose",
  "  porshin → поршень / piston",
  "  svidv · svecha · svechi → лаа / spark plug",
  "  babine · babin → катушка / ignition coil",
  "  akku · akb · akulyator → аккумулятор / battery",
  "  dinamo → генератор / alternator",
  "  prujin · pursh → пүрш / spring",
  "  sharov · sharovoi → өндгөн тулгуур / ball joint",
  "  saylentblok → сайлентблок / bushing",
  "  podshipnik → холхивч / bearing",
  "  stupitsa · stupits → цапны холхивч / wheel hub bearing",
  "  gitar · gitara → доод гар / lower control arm",
  "  obud · obut · rim → обуд / rim",
  "  dugui → дугуй / wheel",
  "  pokrishka · shina → шин / tire",
  "  halga · haalga → хаалга / door",
  "  toil · tol → толь / side mirror",
  "  pomp · pompo → усны насос / water pump",
  "  prokladka → жийрэг / gasket",
  "  tos · masla → тос / engine oil",
  "  sintetik → синтетик тос / synthetic oil",
  "  litol → литол / lithium grease",
  "  smazka → тосон тос / grease",
  "  omyvatel → шилний угаагч шингэн / washer fluid",
  "  tosni nasos → тосны насос / oil pump (engine — distinct from water pump)",
  "  ajilgaa → ажиллахгүй (шинж тэмдэг, эд анги биш)",
  "Дуудлагын дүрэм: kh→х · ch→ч · sh→ш · zh→ж · ya→я · yu→ю · gh→г · yo→ё",
  "Хайхдаа МОНГОЛ кирилл болон ТОДОРХОЙ Англи нэрийг хослуулна. Жишээ:",
  '  search_products({ query: "тоормос brake", category: "brake" })',
  "Хоёр уншилт хооронд эргэлзвэл Англи нэрийг сонго — каталогид давамгайлдаг.",
].join("\n");
