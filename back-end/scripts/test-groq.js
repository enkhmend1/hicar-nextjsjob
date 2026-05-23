#!/usr/bin/env node
/**
 * Quick smoke test — proves the Groq API key in .env can actually
 * complete a chat request.  Use:
 *
 *   cd back-end && node scripts/test-groq.js
 *
 * Exit codes:  0 = key works,  1 = key missing / invalid / network fail.
 */

import "dotenv/config";
import { aiConfig } from "../Config/openai.js";

const log = (tag, msg) => console.log(`[${tag}] ${msg}`);

if (!aiConfig.text.enabled) {
  log("FAIL", "aiConfig.text.enabled === false — GROQ_API_KEY missing or empty");
  process.exit(1);
}

log("INFO", `Calling ${aiConfig.text.label} (model=${aiConfig.text.model})…`);

const startedAt = Date.now();
try {
  const r = await aiConfig.text.client.chat.completions.create({
    model: aiConfig.text.model,
    messages: [
      { role: "system", content: "Reply with exactly one short Mongolian word." },
      { role: "user",   content: "Сайн уу?" },
    ],
    max_tokens: 16,
    temperature: 0,
  });

  const ms     = Date.now() - startedAt;
  const reply  = r.choices?.[0]?.message?.content?.trim() || "(empty)";
  const usage  = r.usage || {};
  log("OK",   `latency=${ms}ms  prompt_tok=${usage.prompt_tokens ?? "?"}  completion_tok=${usage.completion_tokens ?? "?"}`);
  log("OK",   `reply: "${reply}"`);
  log("DONE", "GROQ key is valid — AI chat will work.");
  process.exit(0);
} catch (err) {
  // Common Groq errors: 401 (invalid key), 429 (rate limited),
  // 404 (model retired). The OpenAI SDK exposes .status on these.
  const status = err?.status || err?.response?.status;
  const code   = err?.code   || err?.error?.code || "";
  log("FAIL", `status=${status ?? "?"}  code=${code || "?"}  msg=${err.message}`);

  if (status === 401) log("HINT", "Invalid key. Regenerate at https://console.groq.com/keys");
  if (status === 429) log("HINT", "Free-tier rate limit hit. Wait a minute and retry.");
  if (status === 404) log("HINT", "Model retired. Try GROQ_MODEL=llama-3.1-8b-instant in .env");
  process.exit(1);
}
