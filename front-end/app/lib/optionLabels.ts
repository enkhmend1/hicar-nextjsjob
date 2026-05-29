/**
 * UI-only Latin → Cyrillic mapping for dynamic-attribute dropdown options.
 *
 * Why this exists:
 *   The SiteContent.categories[].attributesSchema stores option values as
 *   stable English keys (`oem`, `wiring`, `new`, …) so the DB enum is
 *   language-neutral and search/filtering stays simple. But the seller
 *   form (Step 2 of /seller/products/new) is in Mongolian, and showing
 *   raw English in a Mongolian dropdown is jarring. This module is the
 *   single source of truth for how each English value is *displayed*.
 *
 * Resolution:
 *   • `tOption(value)`              — flat lookup, falls back to value.
 *   • `tOption(value, attrKey)`     — context-aware lookup; checks
 *     `BY_ATTR[attrKey][value]` first so attribute-specific overrides
 *     (e.g. `manual` under `transmission_type` vs `key_type`) win.
 *
 * Adding a new option:
 *   Add the key once to FLAT for the most common reading; only add a
 *   BY_ATTR entry if a different attribute needs a different label.
 */

/** Attribute-specific overrides — checked BEFORE the flat map. */
const BY_ATTR: Record<string, Record<string, string>> = {
  // Phase AH: car-parts market vocabulary — "Шинэтгэсэн" / "Хэрэглэсэн"
  // are technically correct but sound translated, not native. Mongolian
  // mechanics + buyers use shorter, more concrete words. We also keep
  // the two attribute namespaces (compatibility_status vs part_condition)
  // semantically distinct: the first is about PROVENANCE (was it OEM,
  // aftermarket, refurbished etc.), the second is about PHYSICAL STATE.
  //
  //  compatibility_status answers "What KIND of part is this?"
  //  part_condition       answers "What CONDITION is the part in?"
  compatibility_status: {
    oem:             "Үйлдвэрийн OEM",      // "Original OEM" → cleaner
    aftermarket:     "Aftermarket",         // single word is enough
    used:            "Хуучин",              // "Хэрэглэсэн" → less natural
    remanufactured:  "Үйлдвэрт сэргээсэн",  // distinct from "refurbished"
    refurbished:     "Засварласан",         // ← "Шинэтгэсэн" replaced
  },
  part_condition: {
    new:         "Шинэ",
    used:        "Хуучин",                  // ← match compatibility_status
    refurbished: "Засварласан",             // ← "Шинэтгэсэн" replaced
    damaged:     "Эвдэрсэн",
    for_parts:   "Сэлбэгт зориулсан",
  },

  // Same English token, different meaning depending on attribute.
  transmission_type: {
    manual: "Механик",
    automatic: "Автомат",
    cvt: "Вариатор (CVT)",
    dsg: "DSG",
    amt: "Хагас автомат (AMT)",
    dct: "Хосолсон шүүрэгч (DCT)",
    tiptronic: "Tiptronic",
  },
  steering_type: {
    hydraulic:        "Гидравлик",
    electric:         "Цахилгаан",
    electro_hydraulic:"Цахилгаан-гидравлик",
    manual:           "Механик",
  },
  key_type: {
    mechanical:   "Механик",
    transponder:  "Транспондер",
    smart_key:    "Ухаалаг түлхүүр",
    remote:       "Зайны түлхүүр",
    keyless:      "Түлхүүргүй",
  },
  power_type: {
    manual:     "Гар",
    electric:   "Цахилгаан",
    pneumatic:  "Хийн даралттай",
    hydraulic:  "Гидравлик",
    battery:    "Батарейтай",
  },

  // damping_type.oil should read "Тосон", not the more common "Тос/Тосон".
  damping_type: {
    gas:        "Хийн",
    oil:        "Тосон",
    electronic: "Цахилгаан",
    air:        "Агаарын",
    coilover:   "Coilover",
  },

  // filter_type.oil should read "Тосны шүүлтүүр" (vs raw "oil" elsewhere).
  filter_type: {
    oil:          "Тосны",
    air:          "Агаарын",
    fuel:         "Түлшний",
    cabin:        "Салоны",
    transmission: "Хайрцагны",
    hydraulic:    "Гидравлик",
    pollen:       "Тоосны",
    dpf:          "DPF (Шаталтын)",
  },

  // oil_type.engine = engine oil (not engine part)
  oil_type: {
    engine:         "Хөдөлгүүрийн",
    transmission:   "Хайрцагны",
    brake:          "Тоормосны",
    power_steering: "Жолооны хүчитгэгчийн",
    coolant:        "Хөргөлтийн",
    differential:   "Дифференциалын",
    gear:           "Шүдтэй цахилгааны",
  },

  // gasket_type.exhaust/intake — refers to the location, not category.
  gasket_type: {
    head:          "Толгойн",
    intake:        "Сорогчийн",
    exhaust:       "Утааны",
    oil_pan:       "Тосны савны",
    valve_cover:   "Хавхлагны таганы",
    water_pump:    "Усны помпны",
    timing_cover:  "Тааруулгын таганы",
    differential:  "Дифференциалын",
  },

  // sensor_type — specialized vocab so single-word translations work.
  sensor_type: {
    oxygen:         "Хүчилтөрөгчийн (Lambda)",
    maf:            "Агаарын урсгалын (MAF)",
    map:            "Сорогчийн даралтын (MAP)",
    crankshaft:     "Тохой голын (CKP)",
    camshaft:       "Хуваарилах голын (CMP)",
    abs:            "ABS",
    parking:        "Зогсоолын",
    tire_pressure:  "Дугуйн даралтын (TPMS)",
    knock:          "Цохилгооны",
    coolant_temp:   "Хөргөлтийн дулааны",
  },

  // signal_type — engineering acronyms kept as-is where standard.
  signal_type: {
    analog:   "Аналог",
    digital:  "Дижитал",
    pwm:      "PWM",
    can_bus:  "CAN-шин",
    lin_bus:  "LIN-шин",
  },

  // module_type — keep ECU/ABS-style acronyms intact.
  module_type: {
    engine_ecu:         "Хөдөлгүүрийн ECU",
    transmission_ecu:   "Хайрцагны ECU (TCU)",
    abs_module:         "ABS модуль",
    airbag_module:      "Дэрний модуль (SRS)",
    bcm:                "BCM (Их биеийн модуль)",
    immobilizer:        "Иммобилайзер",
    instrument_cluster: "Самбарын модуль",
  },

  // bulb_type — keep technology acronyms.
  bulb_type: {
    halogen:      "Галоген",
    led:          "LED",
    xenon:        "Ксенон",
    hid:          "HID",
    incandescent: "Энгийн",
    laser:        "Лазер",
  },

  // light_type — clarify position vs function.
  light_type: {
    headlight:    "Урд гэрэл",
    taillight:    "Хойд гэрэл",
    fog:          "Манангийн",
    turn_signal:  "Хажуу гэрэл",
    interior:     "Дотор гэрэл",
    brake_light:  "Тоормосны гэрэл",
    reverse:      "Арагшаа гэрэл",
    drl:          "Өдрийн гэрэл (DRL)",
  },

  fuel_type: {
    petrol: "Бензин",
    diesel: "Дизель",
    gas:    "Хий",
    e85:    "E85",
    flex:   "Flex",
    lpg:    "LPG (Шингэн хий)",
    cng:    "CNG (Шахсан хий)",
  },

  engine_type: {
    petrol:   "Бензин",
    diesel:   "Дизель",
    hybrid:   "Хайбрид",
    electric: "Цахилгаан",
    gas:      "Хийн",
    lpg:      "LPG",
    cng:      "CNG",
  },

  aspiration: {
    naturally_aspirated: "Атмосферын",
    turbo:               "Турбо",
    supercharged:        "Компрессор",
    twin_turbo:          "Хос турбо",
    electric:            "Цахилгаан",
  },

  drive_type: {
    fwd:           "Урдаар хөтлөгч (FWD)",
    rwd:           "Хойноор хөтлөгч (RWD)",
    awd:           "Дөрвөн дугуйт (AWD)",
    "4wd":         "4 хөтлөгч (4WD)",
    part_time_4wd: "Хэсэгчилсэн 4WD",
  },

  drive_size: {
    "1_4_inch": "1/4 инч",
    "3_8_inch": "3/8 инч",
    "1_2_inch": "1/2 инч",
    "3_4_inch": "3/4 инч",
    "1_inch":   "1 инч",
  },

  programming_required: {
    yes:      "Шаардлагатай",
    no:       "Шаардлагагүй",
    optional: "Сонголтоор",
  },

  refrigerant_type: {
    r134a:   "R-134a",
    r1234yf: "R-1234yf",
    r12:     "R-12 (хуучин)",
    r410a:   "R-410a",
  },

  rotation: {
    cw:         "Цагийн зүүний дагуу",
    ccw:        "Цагийн зүүний эсрэг",
    reversible: "Хоёр чигт",
  },

  coolant_type: {
    green:  "Ногоон",
    orange: "Улбар шар",
    pink:   "Ягаан",
    blue:   "Цэнхэр",
    red:    "Улаан",
    yellow: "Шар",
    purple: "Нил ягаан",
  },

  tire_season: {
    summer:     "Зуны",
    winter:     "Өвлийн",
    all_season: "Бүх улирлын",
    studded:    "Гаслагтай (шипертэй)",
    off_road:   "Off-road",
    at_mt:      "AT / MT (всэхүүн нутаг)",
  },

  rim_material: {
    steel:        "Ган",
    alloy:        "Хайлш",
    forged:       "Цутгасан хайлш",
    carbon_fiber: "Карбон",
    magnesium:    "Магнийн",
  },

  // Position vs side: keep them under attr-specific so positional axes
  // don't bleed into one another.
  side: {
    front_left:  "Урд зүүн",
    front_right: "Урд баруун",
    rear_left:   "Хойд зүүн",
    rear_right:  "Хойд баруун",
    left:        "Зүүн",
    right:       "Баруун",
    front:       "Урд",
    rear:        "Хойд",
    center:      "Төв",
    top:         "Дээд",
    bottom:      "Доод",
  },
  position: {
    front:       "Урд",
    rear:        "Хойд",
    left:        "Зүүн",
    right:       "Баруун",
    front_left:  "Урд зүүн",
    front_right: "Урд баруун",
    rear_left:   "Хойд зүүн",
    rear_right:  "Хойд баруун",
    inner:       "Дотор",
    outer:       "Гадна",
    top:         "Дээд",
    bottom:      "Доод",
    headlight:   "Гэрэлд",
    both:        "Хоёул",
    interior:    "Доторх",
    roof:        "Дээвэр",
    side:        "Хажуу",
  },
  axle_position: {
    front: "Урд тэнхлэг",
    rear:  "Хойд тэнхлэг",
    both:  "Хоёул",
  },
  terminal_position: {
    left:  "Зүүн",
    right: "Баруун",
    top:   "Дээд",
    front: "Урд",
  },

  // The seller-form material dropdown context varies a lot.
  material: {
    plastic:         "Хуванцар",
    steel:           "Ган",
    stainless_steel: "Зэвэрдэггүй ган",
    aluminum:        "Хөнгөн цагаан",
    aluminized:      "Цайрласан",
    mild_steel:      "Зөөлөн ган",
    titanium:        "Титан",
    fiberglass:      "Шилэн ширхэгт",
    carbon_fiber:    "Карбон",
    abs:             "ABS хуванцар",
    rubber:          "Резин",
    cork:            "Үйс",
    paper:           "Цаас",
    metal:           "Метал",
    silicone:        "Силикон",
    composite:       "Композит",
    graphite:        "Графит",
    leather:         "Арьс",
    fabric:          "Даавуу",
    vinyl:           "Винил",
    suede:           "Замш",
    alcantara:       "Алкантара",
    wood:            "Мод",
    stainless:       "Зэвэрдэггүй ган",
    brass:           "Гууль",
    nylon:           "Капрон (Нейлон)",
    zinc_plated:     "Цайрласан",
  },

  // filter_material — paper here means filter media, not document.
  filter_material: {
    paper:     "Цаасан",
    foam:      "Хөөсөн",
    cotton:    "Хөвөн",
    synthetic: "Синтетик",
    oiled:     "Тосолгоотой",
  },

  // base_type — oil base, not surface.
  base_type: {
    synthetic:      "Синтетик",
    semi_synthetic: "Хагас синтетик",
    mineral:        "Минерал",
    racing:         "Уралдааны",
  },

  finish: {
    painted:  "Будсан",
    primed:   "Праймертай",
    bare:     "Хайруу",
    polished: "Зүлгэсэн",
    textured: "Текстуртай",
  },

  feature: {
    heated:       "Халаалттай",
    tinted:       "Бараан шилтэй",
    electric:     "Цахилгаан",
    manual:       "Гар",
    auto_dimming: "Авто бараавчтай",
    rain_sensor:  "Бороо мэдрэгчтэй",
    defrost:      "Гэсгээгчтэй",
  },

  // Per-category single-token sets — keys are unambiguous in their own
  // attribute so no flat-map fallback is needed.

  brake_part: {
    pad:             "Тоормосны бул",
    disc:            "Диск",
    drum:            "Бөмбөлөг",
    caliper:         "Суппорт",
    fluid:           "Шингэн",
    hose:            "Гуурс",
    master_cylinder: "Үндсэн цилиндр",
    booster:         "Вакуум хүчитгэгч",
    sensor:          "Мэдрэгч",
  },
  friction_grade: {
    organic:        "Органик",
    ceramic:        "Керамик",
    semi_metallic:  "Хагас металлик",
    low_metallic:   "Бага металлик",
    sintered:       "Шахмал",
  },
  suspension_part: {
    shock:           "Амортизатор",
    strut:           "Стойка",
    spring:          "Пүрш",
    control_arm:     "Хөшүүрэг",
    ball_joint:      "Бөмбөг үе",
    bushing:         "Бушинг (Сайлент-блок)",
    sway_bar:        "Тогтворжуулагч",
    stabilizer_link: "Стабилизаторын линк",
  },
  steering_part: {
    rack:      "Жолооны рейк",
    pump:      "Помп",
    tie_rod:   "Холбоос саваа",
    column:    "Жолооны багана",
    wheel:     "Жолоо",
    pinion:    "Шуудай",
    reservoir: "Бак",
    hose:      "Гуурс",
  },
  component_type: {
    wiring:    "Утас",
    fuse:      "Saplaur (фьюз)",
    relay:     "Реле",
    switch:    "Унтраалга",
    connector: "Залгуур",
    harness:   "Утасны багц",
    terminal:  "Туйл",
    grommet:   "Резинэн нэвчүүлэгч",
  },
  voltage: {
    "12V": "12В",
    "24V": "24В",
    "48V": "48В",
  },
  body_part: {
    bumper:         "Бампер",
    fender:         "Хаалт",
    hood:           "Капот",
    door:           "Хаалга",
    trunk:          "Тэвш",
    grille:         "Тор",
    panel:          "Хавтан",
    mirror_housing: "Толин хаалт",
    spoiler:        "Спойлер",
  },
  interior_part: {
    seat:       "Суудал",
    dashboard:  "Самбар",
    carpet:     "Хивс",
    headliner:  "Тагны бүрхүүл",
    trim:       "Самбарын шигдээс",
    console:    "Консол",
    handle:     "Бариул",
    seatbelt:   "Бүс",
    armrest:    "Гарын тулгуур",
  },
  cooling_part: {
    radiator:    "Радиатор",
    thermostat:  "Термостат",
    water_pump:  "Усны помп",
    fan:         "Сэнс",
    hose:        "Гуурс",
    reservoir:   "Бак",
    cap:         "Таг",
    sensor:      "Мэдрэгч",
  },
  exhaust_part: {
    muffler:             "Дуу намсгуур",
    catalytic_converter: "Катализатор",
    pipe:                "Хоолой",
    manifold:            "Коллектор",
    resonator:           "Резонатор",
    gasket:              "Гасет",
    sensor:              "Лямбда",
    clamp:               "Хавчаар",
  },
  fuel_part: {
    pump:                "Помп",
    injector:            "Фарсунка",
    filter:              "Шүүлтүүр",
    tank:                "Бак",
    rail:                "Рамп (рейл)",
    pressure_regulator:  "Даралт зохицуулагч",
    cap:                 "Таг",
    line:                "Хоолой",
  },
  ignition_part: {
    spark_plug:  "Лаа",
    coil:        "Ороомог",
    distributor: "Тарагч (трамблер)",
    wire:        "Утас",
    glow_plug:   "Халаалтын лаа",
    module:      "Модуль",
    cap:         "Таг",
    rotor:       "Ротор",
  },
  intake_part: {
    filter:           "Шүүлтүүр",
    throttle_body:    "Дроссель",
    maf_sensor:       "MAF мэдрэгч",
    intake_manifold:  "Сорогч коллектор",
    hose:             "Гуурс",
    resonator:        "Резонатор",
    box:              "Хайрцаг",
  },
  hvac_part: {
    compressor:      "Компрессор",
    condenser:       "Конденсатор",
    evaporator:      "Бууруулагч (Эвапоратор)",
    heater_core:     "Халаагчийн зүрх",
    blower:          "Сэнс",
    expansion_valve: "Тэлэлтийн хавхлага",
    dryer:           "Хатаагч",
    hose:            "Гуурс",
  },
  glass_part: {
    windshield:    "Урд шил",
    side_window:   "Хажуу шил",
    rear_window:   "Хойд шил",
    mirror_glass:  "Толины шил",
    sunroof:       "Дээвэрийн шил",
    quarter_glass: "Гурвалжин шил",
  },
  wiper_part: {
    blade:       "Шүүр",
    arm:         "Хөшүүрэг",
    motor:       "Мотор",
    washer_pump: "Угаагчийн помп",
    nozzle:      "Шахуурга",
    reservoir:   "Бак",
    linkage:     "Холбоос",
  },
  part_type: {
    // belts_hoses
    timing_belt:    "Тааруулгын бүс",
    serpentine_belt:"Сэдрэгч бүс",
    v_belt:         "V-бүс",
    radiator_hose:  "Радиаторын гуурс",
    fuel_hose:      "Түлшний гуурс",
    vacuum_hose:    "Вакуум гуурс",
    brake_hose:     "Тоормосны гуурс",
    // starter_alternator
    starter:        "Стартер",
    alternator:     "Генератор",
    solenoid:       "Соленойд",
    brush:          "Сойз",
    regulator:      "Зохицуулагч",
    pulley:         "Шкив",
  },
  bearing_type: {
    wheel:   "Дугуйн",
    clutch:  "Автогийн",
    pilot:   "Pilot",
    thrust:  "Тулах",
    roller:  "Ролик",
    ball:    "Бөмбөг",
    needle:  "Зүү",
    tapered: "Конус",
  },
  battery_type: {
    lead_acid:    "Хар тугалган-Хүчилтэй",
    agm:          "AGM",
    gel:          "Гелтэй",
    lithium_ion:  "Литий-ион",
    efb:          "EFB",
  },
  radiator_part: {
    radiator:   "Радиатор",
    intercooler:"Интеркулер",
    oil_cooler: "Тосны хөргөгч",
    fan_shroud: "Сэнсний бүрхүүл",
    cap:        "Таг",
    tank:       "Бак",
  },
  core_material: {
    aluminum:    "Хөнгөн цагаан",
    copper_brass:"Зэс-гууль",
    plastic:     "Хуванцар",
  },
  shaft_part: {
    cv_joint:        "Гранат",
    axle:            "Тэнхлэг",
    driveshaft:      "Хөтлөгч босоо",
    boot:            "Пыльник",
    bearing:         "Холхивч",
    u_joint:         "U-үе (Крестовин)",
    carrier_bearing: "Тулах холхивч",
  },
  fastener_type: {
    bolt:   "Боолт",
    nut:    "Гайка",
    washer: "Шайба",
    screw:  "Шураг",
    clip:   "Хавчаар",
    rivet:  "Тахир хадаас",
    stud:   "Хадаас",
    pin:    "Зүү",
  },
  lock_part: {
    door_lock:     "Хаалганы цоож",
    ignition_lock: "Асаалтын цоож",
    trunk_lock:    "Тэвшний цоож",
    fuel_cap_lock: "Бакны таганы цоож",
    steering_lock: "Жолооны цоож",
    actuator:      "Актуатор",
    cylinder:      "Цилиндр",
  },
  product_type: {
    wax:               "Лаа (полироль)",
    polish:            "Полироль",
    shampoo:           "Шампунь",
    degreaser:         "Тос арилгагч",
    leather_care:      "Арьс арчилгаа",
    glass_cleaner:     "Шил цэвэрлэгч",
    tire_shine:        "Дугуйн гялбаа",
    plastic_restorer:  "Хуванцар сэргээгч",
  },
  tool_type: {
    wrench:             "Түлхүүр (рожк)",
    socket:             "Толгойт түлхүүр",
    screwdriver:        "Скрюпц",
    hammer:             "Алх",
    pliers:             "Хямар",
    jack:               "Домкрат",
    diagnostic_scanner: "Диагностик сканер",
    torque_wrench:      "Динамометр түлхүүр",
    multimeter:         "Мультиметр",
  },
  material_type: {
    grease:      "Тосон тосолгоо",
    sealant:     "Битүүмжлэгч (герметик)",
    thread_lock: "Резьбан түгжээ",
    cleaner:     "Цэвэрлэгч",
    degreaser:   "Тос арилгагч",
    solder:      "Гагнуурын тугалга",
    tape:        "Тууз",
    adhesive:    "Цавуу",
    lubricant:   "Тосолгоо",
  },
  filter_shape: {
    cylindrical: "Цилиндр",
    panel:       "Хавтгай",
    spin_on:     "Эргэлдэг",
    cartridge:   "Картриж",
    inline:      "Шугаман",
  },
  gear_count: {
    "4": "4 хурдны", "5": "5 хурдны", "6": "6 хурдны",
    "7": "7 хурдны", "8": "8 хурдны", "9": "9 хурдны", "10": "10 хурдны",
  },
  cylinder_count: {
    "1": "1 цилиндр", "2": "2 цилиндр", "3": "3 цилиндр",
    "4": "4 цилиндр", "5": "5 цилиндр", "6": "6 цилиндр",
    "8": "8 цилиндр", "10": "10 цилиндр", "12": "12 цилиндр",
    "16": "16 цилиндр", rotary: "Роторт",
  },
  wheel_size_inch: {
    "12":   "12 инч", "13": "13 инч", "14": "14 инч", "15": "15 инч",
    "16":   "16 инч", "17": "17 инч", "18": "18 инч", "19": "19 инч",
    "20":   "20 инч", "21": "21 инч", "22": "22 инч", "23": "23 инч",
    "24":   "24 инч", "22.5": "22.5 инч (ачааны)",
  },
};

/**
 * Flat fallback map — used when no attribute-specific override exists
 * for the value. Should only contain values that mean the same thing
 * regardless of where they're used.
 */
const FLAT: Record<string, string> = {
  yes: "Тийм",
  no:  "Үгүй",
  both: "Хоёул",
};

/**
 * Resolve a stored option value to a Mongolian display label.
 *   1. If `attrKey` is given and BY_ATTR[attrKey][value] exists → use it.
 *   2. Else fall back to FLAT[value].
 *   3. Else return the raw value verbatim (so unknown options still render).
 */
export const tOption = (value: string, attrKey?: string): string => {
  if (attrKey) {
    const ctx = BY_ATTR[attrKey];
    if (ctx && ctx[value] != null) return ctx[value];
  }
  return FLAT[value] ?? value;
};
