/**
 * Proxy pool — round-robin HTTP proxy rotation with cooldown on failure.
 *
 * Pool is configured via env `PROXY_URLS` (comma-separated). Each entry is
 * a full proxy URL, e.g.
 *
 *   http://user:pass@host:port,http://user:pass@host2:port
 *
 * IMPORTANT IMPLEMENTATION NOTE
 * ─────────────────────────────
 * Node 20+ `fetch` is implemented by **undici**, which does NOT honour the
 * legacy `agent` option (a common mistake that silently breaks proxying —
 * the request fires from the server's own IP and nobody notices).
 *
 * Undici exposes its own pluggable transport called **Dispatcher**. The
 * `ProxyAgent` is a Dispatcher that tunnels every request through an
 * upstream proxy (HTTP CONNECT for HTTPS targets, forwarding for HTTP).
 *
 * Callers therefore set `init.dispatcher = proxy.dispatcher` — NOT `agent`.
 *
 * Designed to be side-effect-free until first call; if PROXY_URLS is empty
 * the module no-ops and the system uses direct connections.
 */

import { ProxyAgent } from "undici";
import chalk from "chalk";

const FAIL_COOLDOWN_MS = 60_000;       // 1 minute
const FAIL_THRESHOLD   = 3;            // consecutive failures before cooldown
const PROXY_CONNECT_TIMEOUT = Number(process.env.PROXY_CONNECT_TIMEOUT_MS || 8_000);

const RAW = (process.env.PROXY_URLS || "").trim();

const buildEntry = (url) => ({
  url,
  dispatcher: new ProxyAgent({
    uri: url,
    connect: { timeout: PROXY_CONNECT_TIMEOUT },
    requestTls: { rejectUnauthorized: process.env.PROXY_TLS_INSECURE !== "true" },
  }),
  failures: 0,
  cooldownUntil: 0,
  // diagnostics
  successCount: 0,
  failCount: 0,
  lastUsedAt: 0,
});

const pool = RAW
  ? RAW.split(",").map((url) => url.trim()).filter(Boolean).map(buildEntry)
  : [];

export const proxyPoolEnabled = pool.length > 0;
if (proxyPoolEnabled) {
  console.log(chalk.green.bold(`Proxy pool enabled — ${pool.length} endpoint(s) (undici ProxyAgent)`));
} else {
  console.log(chalk.gray("Proxy pool disabled (PROXY_URLS empty) — direct connect"));
}

let cursor = -1;

/**
 * Pick the next available proxy (round-robin, skipping cooled-down ones).
 *
 * @returns {{ url: string, dispatcher: import("undici").ProxyAgent, _i: number } | null}
 *          `null` if pool is empty OR every entry is cooling down.
 */
export const pickProxy = () => {
  if (!proxyPoolEnabled) return null;
  const now = Date.now();
  const tried = new Set();
  while (tried.size < pool.length) {
    cursor = (cursor + 1) % pool.length;
    if (tried.has(cursor)) continue;
    tried.add(cursor);
    const p = pool[cursor];
    if (p.cooldownUntil > now) continue;
    p.lastUsedAt = now;
    return { url: p.url, dispatcher: p.dispatcher, _i: cursor };
  }
  return null;
};

/**
 * Report success/failure for a previously-picked proxy. Cools down after
 * FAIL_THRESHOLD consecutive failures.
 */
export const reportProxyResult = (info, success) => {
  if (!info || info._i === undefined) return;
  const p = pool[info._i];
  if (!p) return;
  if (success) {
    p.failures = 0;
    p.successCount += 1;
  } else {
    p.failures += 1;
    p.failCount += 1;
    if (p.failures >= FAIL_THRESHOLD) {
      p.cooldownUntil = Date.now() + FAIL_COOLDOWN_MS;
      p.failures = 0;
      console.warn(chalk.yellow(`Proxy cooled down: ${redact(p.url)} (until ${new Date(p.cooldownUntil).toISOString()})`));
    }
  }
};

const redact = (url) => url.replace(/:[^:@\/]+@/, ":***@");

/**
 * Operator-facing view: list every proxy + its health counters.
 * Credentials are redacted before returning.
 */
export const proxyStats = () =>
  pool.map(({ url, failures, cooldownUntil, successCount, failCount, lastUsedAt }) => ({
    url: redact(url),
    failures,
    coolingDown: cooldownUntil > Date.now(),
    cooldownUntil: cooldownUntil ? new Date(cooldownUntil).toISOString() : null,
    successCount,
    failCount,
    lastUsedAt: lastUsedAt ? new Date(lastUsedAt).toISOString() : null,
  }));

/**
 * Test helper: verify a single proxy by hitting an echo-IP service.
 * Returns the response body or throws.
 *
 * Usage: `node scripts/testProxy.js http://user:pass@host:port`
 */
export const probeProxy = async (proxyUrl, target = "https://api.ipify.org?format=json") => {
  const dispatcher = new ProxyAgent({
    uri: proxyUrl,
    connect: { timeout: PROXY_CONNECT_TIMEOUT },
    requestTls: { rejectUnauthorized: process.env.PROXY_TLS_INSECURE !== "true" },
  });
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), PROXY_CONNECT_TIMEOUT + 2_000);
  try {
    const res = await fetch(target, {
      method: "GET",
      dispatcher,
      signal: ctrl.signal,
      headers: { "User-Agent": "HiCar-ProxyProbe/1.0" },
    });
    const body = await res.text();
    return { ok: res.ok, status: res.status, body };
  } finally {
    clearTimeout(t);
  }
};
