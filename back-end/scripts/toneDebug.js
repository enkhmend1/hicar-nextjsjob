/**
 * Focused debug — capture full response + diagnostics for ONE scenario.
 * Print only the interesting parts (reply + diagnostics) so we can read.
 */
const BASE = "http://localhost:5001";
const CHAT = `${BASE}/api/ai/chat`;

const CASES = [
  {
    name: "casual Latin",
    body: { messages: [{ role: "user", content: "toormosni bul baina uu" }], locale: "mn" },
  },
  {
    name: "diagnostic symptom",
    body: {
      messages: [{ role: "user", content: "урдны дугуй тог тог дуугарна" }],
      locale: "mn",
      vehicleContext: { manufacturer: "Toyota", model: "Prius", generation: "ZVW30" },
    },
  },
  {
    name: "vague keyword 'фар'",
    body: { messages: [{ role: "user", content: "фар" }], locale: "mn" },
  },
];

(async () => {
  for (const c of CASES) {
    console.log("\n=== " + c.name + " ===");
    try {
      const t0 = Date.now();
      const res = await fetch(CHAT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(c.body),
        signal: AbortSignal.timeout(90000),
      });
      const json = await res.json();
      const ms = Date.now() - t0;
      console.log(`HTTP ${res.status} (${ms}ms)`);
      console.log("layout:", json.layout, "conf:", json.confidence);
      console.log("reply:", json.reply);
      if (json.diagnostics) {
        console.log("diagnostics:", JSON.stringify(json.diagnostics, null, 2));
      }
      if (json.toolCalls) {
        console.log("toolCalls:", json.toolCalls.map((tc) => tc.name).join(", "));
      }
    } catch (e) {
      console.log("ERROR:", e.message);
    }
  }
})();
