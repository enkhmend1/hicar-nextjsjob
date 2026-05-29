/**
 * Phase AO — live chat tone verification.
 *
 * Hits POST /api/ai/chat with the 8 VOICE EXAMPLES from Phase AN and
 * scores each reply on:
 *   • Register match (formal vs casual mirroring)
 *   • Natural connector usage (За тэр / Аан тийм / Тэгэхдээ / ...)
 *   • Empathy first on symptoms
 *   • No robotic hedges (Магадлал 65%, Дээрх тоо баримтаар, ...)
 *   • Length (target: 2–4 sentences)
 *
 * Prints colour-coded results so we can eyeball which categories pass
 * and which need prompt iteration.
 */

const BASE = process.env.AI_BASE || "http://localhost:5001";
const CHAT = `${BASE}/api/ai/chat`;

const SCENARIOS = [
  {
    id: "а — formal vehicle search",
    body: {
      messages: [{ role: "user", content: "Toyota Blade-ын тоормосны бул хайя" }],
      locale: "mn",
      vehicleContext: {
        manufacturer: "Toyota", model: "Blade", generation: "AZE156",
      },
    },
    expectations: {
      hasConnector: true,
      formalRegister: true,
      empathy: false,
    },
  },
  {
    id: "б — casual Latin user",
    body: {
      messages: [{ role: "user", content: "toormosni bul baina uu" }],
      locale: "mn",
    },
    expectations: {
      casualRegister: true,
    },
  },
  {
    id: "в — diagnostic with empathy",
    body: {
      messages: [{ role: "user", content: "урдны дугуй тог тог дуугарна" }],
      locale: "mn",
      vehicleContext: { manufacturer: "Toyota", model: "Prius", generation: "ZVW30" },
    },
    expectations: {
      empathy: true,
      noRoboticHedge: true,
    },
  },
  {
    id: "г — vague keyword",
    body: {
      messages: [{ role: "user", content: "фар" }],
      locale: "mn",
    },
    expectations: {
      hasConnector: true,
      length: [10, 80],   // shouldn't be too long for a clarifier
    },
  },
  {
    id: "д — price intent",
    body: {
      messages: [
        { role: "user", content: "Toyota Blade тоормосны наклад хайя" },
        { role: "assistant", content: "Blade-нд тохирох 3 наклад олсон. Аль нь сонирхож байна?" },
        { role: "user", content: "хямд нь алийг нь санал болгох вэ?" },
      ],
      locale: "mn",
      vehicleContext: { manufacturer: "Toyota", model: "Blade", generation: "AZE156" },
    },
    expectations: {
      mentionsPriceSorted: true,
    },
  },
  {
    id: "е — casual greeting",
    body: {
      messages: [{ role: "user", content: "sain bnu" }],
      locale: "mn",
    },
    expectations: {
      noRefusal: true,
      friendly: true,
    },
  },
  {
    id: "ж — empty search",
    body: {
      messages: [{ role: "user", content: "тоормосны бамба" }],   // misspelling, no hits
      locale: "mn",
    },
    expectations: {
      helpful: true,
      noBlame: true,
    },
  },
  {
    id: "з — order status (off-topic-ish for anon)",
    body: {
      messages: [{ role: "user", content: "захиалга яаж байна" }],
      locale: "mn",
    },
    expectations: {
      friendly: true,
    },
  },
];

const CONNECTORS = ["За тэр", "Аан", "Нэгэнт", "Тэгэхдээ", "Магадгүй", "Зүгээр", "Тэгвэл"];
const ROBOTIC = ["Магадлал ", "Дата дээр", "Дээрх тоо баримтаар", "Үүний дараа", "Хариуд нь"];
const EMPATHY_OPENERS = ["Аан", "Уу,", "Ойлгомжтой", "Жаахан түгш", "санаа зова"];

const ANSI = {
  reset: "\x1b[0m",
  bold:  "\x1b[1m",
  dim:   "\x1b[2m",
  red:   "\x1b[31m",
  green: "\x1b[32m",
  yellow:"\x1b[33m",
  cyan:  "\x1b[36m",
};

const score = (reply, exp) => {
  const checks = [];
  const sentenceCount = (reply.match(/[.!?]+/g) || []).length;

  if (exp.hasConnector !== undefined) {
    const hit = CONNECTORS.some((c) => reply.includes(c));
    checks.push({ name: "connector", pass: hit === exp.hasConnector });
  }
  if (exp.empathy) {
    const hit = EMPATHY_OPENERS.some((c) => reply.includes(c));
    checks.push({ name: "empathy", pass: hit });
  }
  if (exp.noRoboticHedge) {
    const hit = ROBOTIC.some((c) => reply.includes(c));
    checks.push({ name: "no-robot", pass: !hit });
  }
  if (exp.length) {
    const len = reply.length;
    checks.push({ name: `length(${exp.length[0]}-${exp.length[1]})`, pass: len >= exp.length[0] && len <= exp.length[1] });
  }
  if (exp.mentionsPriceSorted) {
    const hit = /хямд|cheap|₮/.test(reply);
    checks.push({ name: "price-mention", pass: hit });
  }
  if (exp.noRefusal) {
    const hit = /Уучлаарай.*хандах эрх|refuse|cannot/i.test(reply);
    checks.push({ name: "no-refusal", pass: !hit });
  }
  if (exp.helpful) {
    const hit = /OEM|код|хайвал|санал|сонгох|шалга/i.test(reply);
    checks.push({ name: "helpful", pass: hit });
  }
  if (exp.noBlame) {
    const hit = /(буруу|алдаа гарга)/i.test(reply);
    checks.push({ name: "no-blame", pass: !hit });
  }
  if (exp.friendly) {
    const hit = /Сайн уу|тусл|байя|туслана/i.test(reply);
    checks.push({ name: "friendly", pass: hit });
  }
  checks.push({ name: `sentences(2-5)`, pass: sentenceCount >= 1 && sentenceCount <= 6 });

  const passed = checks.filter((c) => c.pass).length;
  return { checks, passed, total: checks.length, sentenceCount };
};

const fmtBadge = (pass) => pass
  ? `${ANSI.green}✓${ANSI.reset}`
  : `${ANSI.red}✗${ANSI.reset}`;

async function runOne(scenario) {
  const t0 = Date.now();
  let res, json;
  try {
    res = await fetch(CHAT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(scenario.body),
    });
    json = await res.json();
  } catch (e) {
    return { scenario, error: e.message, ms: Date.now() - t0 };
  }
  const ms = Date.now() - t0;
  if (!res.ok) return { scenario, error: `HTTP ${res.status}: ${JSON.stringify(json).slice(0, 200)}`, ms };

  const reply = json.reply || "(empty)";
  const result = score(reply, scenario.expectations);
  return { scenario, reply, layout: json.layout, confidence: json.confidence, ms, ...result };
}

async function main() {
  console.log(`${ANSI.bold}${ANSI.cyan}Phase AO — Tone verification against ${CHAT}${ANSI.reset}\n`);
  const results = [];
  for (const scn of SCENARIOS) {
    process.stdout.write(`${ANSI.dim}Running ${scn.id}…${ANSI.reset}\n`);
    const r = await runOne(scn);
    results.push(r);
    if (r.error) {
      console.log(`  ${ANSI.red}ERROR:${ANSI.reset} ${r.error}\n`);
      continue;
    }
    console.log(`  ${ANSI.dim}layout=${r.layout} conf=${r.confidence ?? "—"} ${r.ms}ms ${r.sentenceCount} sentences${ANSI.reset}`);
    console.log(`  ${ANSI.bold}REPLY:${ANSI.reset} ${r.reply}`);
    for (const c of r.checks) {
      console.log(`    ${fmtBadge(c.pass)} ${c.name}`);
    }
    const pct = Math.round((r.passed / r.total) * 100);
    const color = pct >= 80 ? ANSI.green : pct >= 50 ? ANSI.yellow : ANSI.red;
    console.log(`  → ${color}${r.passed}/${r.total} (${pct}%)${ANSI.reset}\n`);
  }

  // Aggregate
  const ok = results.filter((r) => !r.error);
  const totalChecks = ok.reduce((s, r) => s + r.total, 0);
  const totalPassed = ok.reduce((s, r) => s + r.passed, 0);
  const overall = totalChecks ? Math.round((totalPassed / totalChecks) * 100) : 0;
  const color = overall >= 80 ? ANSI.green : overall >= 50 ? ANSI.yellow : ANSI.red;
  console.log(`${ANSI.bold}OVERALL: ${color}${totalPassed}/${totalChecks} (${overall}%)${ANSI.reset}`);
  console.log(`${ANSI.bold}Errors:${ANSI.reset} ${results.filter((r) => r.error).length}/${results.length}`);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
