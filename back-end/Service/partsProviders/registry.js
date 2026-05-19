/**
 * Parts provider registry — picks the active PartsProvider by env
 * `PARTS_PROVIDER` (default "mock" if no credentials present).
 *
 * Resolution priority:
 *   1. If env PARTS_PROVIDER is set AND the adapter is registered + configured → use it.
 *   2. Otherwise, the first registered+configured adapter wins.
 *   3. Otherwise fall back to mock (which returns empty).
 *
 * This avoids the common "configured an API key but forgot to set
 * PARTS_PROVIDER" footgun in production.
 */

import chalk from "chalk";
import partsouqAdapter from "./partsouq.adapter.js";
import amayamaAdapter from "./amayama.adapter.js";
import mockAdapter from "./mock.adapter.js";

const ADAPTERS = {
  [partsouqAdapter.name]: partsouqAdapter,
  [amayamaAdapter.name]:  amayamaAdapter,
  [mockAdapter.name]:     mockAdapter,
};

const requested = (process.env.PARTS_PROVIDER || "").trim().toLowerCase();

const pickActive = () => {
  // 1. explicit env wins (if configured)
  if (requested && ADAPTERS[requested]?.configured) return ADAPTERS[requested];
  if (requested && ADAPTERS[requested] && !ADAPTERS[requested].configured) {
    console.warn(chalk.yellow(`PARTS_PROVIDER="${requested}" registered but credentials missing`));
  }
  // 2. first configured wins (excluding mock)
  for (const a of Object.values(ADAPTERS)) {
    if (a.name !== "mock" && a.configured) return a;
  }
  // 3. fall back to mock
  return mockAdapter;
};

const active = pickActive();
console.log(chalk.green.bold(`Parts provider: ${active.displayName} (${active.name})${active.name === "mock" ? " — no external lookups" : ""}`));

export const getActivePartsProvider = () => active;
export const getPartsProviderByName = (name) => ADAPTERS[name] || null;
export const listPartsProviders = () =>
  Object.values(ADAPTERS).map((a) => ({ name: a.name, displayName: a.displayName, configured: a.configured }));
