/**
 * Vehicle lookup service — provider-agnostic gateway.
 *
 *   ┌──────────────┐
 *   │   Caller     │  (vehicle.controller, worker)
 *   └──────┬───────┘
 *          │  fetchByPlate(plate)
 *          ▼
 *   ┌─────────────────────────────────────────────────┐
 *   │  garage.service.js (this file)                  │
 *   │   • Redis cache                                 │
 *   │   • Retry + backoff (retriable errors only)     │
 *   │   • Circuit breaker (one per provider)          │
 *   │   • Proxy rotation (undici dispatcher)          │
 *   │   • Timeout                                     │
 *   └──────┬─────────────────────────┬────────────────┘
 *          │                         │
 *          │ buildRequest()          │ parseResponse()
 *          ▼                         ▼
 *   ┌──────────────────────────────────────────────────┐
 *   │ active VehicleProvider adapter (registry.js)     │
 *   │   garage | newweb | vinDecoder | …               │
 *   └──────────────────────────────────────────────────┘
 *
 * To swap upstream API (e.g. garage.mn → some-other.mn):
 *   1. Write a new adapter (see vehicleProviders/types.js for contract)
 *   2. Register it in vehicleProviders/registry.js
 *   3. Set VEHICLE_PROVIDER=<name> in .env
 * Nothing else changes — cache, retry, breaker, proxy all stay intact.
 *
 * The file name `garage.service.js` is kept for backwards-compatibility
 * with all existing imports. Conceptually this is the vehicle-lookup
 * gateway, not a garage-specific client.
 *
 * Returns:  fetchByPlate(plate, { fresh? })
 *           → { raw, normalized, hit: "cache"|"network",
 *               source: <providerName>, proxyUsed?: string }
 *
 * Errors (`err.code`):
 *    PLATE_INVALID | NOT_FOUND | TIMEOUT | RATE_LIMITED
 *    UPSTREAM_5XX  | CIRCUIT_OPEN | UPSTREAM_ERROR | PROVIDER_AUTH
 */

import { logger } from "../Config/logger.js";
import { wrapBreaker } from "./circuitBreaker.service.js";
import { pickProxy, reportProxyResult } from "./proxyPool.service.js";
import { cacheGet, cacheSet } from "../Config/redis.js";
import { getActiveProvider } from "./vehicleProviders/registry.js";

const DEFAULT_CACHE_TTL = Number(process.env.GARAGE_CACHE_TTL || 60 * 60 * 24); // 24h
const TIMEOUT_MS  = Number(process.env.GARAGE_TIMEOUT_MS || 10_000);
const MAX_RETRIES = Number(process.env.GARAGE_MAX_RETRIES || 3);

// ── Plate utilities delegate to the active adapter ─────────────────────
// Existing imports (vehicle.controller, etc.) keep working unchanged.
export const normalizePlate = (p) => getActiveProvider().normalizePlate(p);
export const isPlateValid   = (p) => getActiveProvider().isPlateValid(p);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Low-level fetch with proxy + timeout (single attempt) ──────────────
const fetchOnce = async (plate, adapter) => {
  const proxy = pickProxy();
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const req   = adapter.buildRequest(plate);

  // Node 20+ fetch is undici → must use `dispatcher`, not `agent`.
  const init = {
    method:  req.method || "GET",
    headers: req.headers || {},
    body:    req.body || undefined,
    signal:  ctrl.signal,
  };
  if (proxy?.dispatcher) init.dispatcher = proxy.dispatcher;

  try {
    const res = await fetch(req.url, init);
    clearTimeout(timer);

    if (res.status === 429) {
      const e = new Error("Rate limited"); e.code = "RATE_LIMITED"; e.retriable = true; throw e;
    }
    if (res.status >= 500) {
      const e = new Error(`Upstream ${res.status}`); e.code = "UPSTREAM_5XX"; e.retriable = true; throw e;
    }
    if (res.status === 401 || res.status === 403) {
      const e = new Error("Upstream rejected our credentials"); e.code = "PROVIDER_AUTH"; throw e;
    }
    if (res.status === 404) {
      const e = new Error("Plate not found"); e.code = "NOT_FOUND"; throw e;
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const e = new Error(`Upstream ${res.status} ${body.slice(0, 200)}`); e.code = "UPSTREAM_ERROR"; throw e;
    }

    const json = await res.json();
    reportProxyResult(proxy, true);
    return { json, proxyUsed: proxy ? proxy.url.replace(/:[^:@\/]+@/, ":***@") : null };
  } catch (err) {
    clearTimeout(timer);
    reportProxyResult(proxy, false);
    if (err.name === "AbortError") {
      const e = new Error("Upstream timeout"); e.code = "TIMEOUT"; e.retriable = true; throw e;
    }
    throw err;
  }
};

// ── Retry envelope: exponential backoff for retriable errors ───────────
const fetchWithRetries = async (plate, adapter) => {
  let lastErr;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await fetchOnce(plate, adapter);
    } catch (err) {
      lastErr = err;
      if (!err.retriable) throw err;
      const wait = Math.min(2000, 200 * 2 ** attempt);
      await sleep(wait);
    }
  }
  throw lastErr;
};

// Lazy-init one circuit breaker per provider name — keeps stats clean when
// you swap providers, and lets you A/B by reading the active provider at
// request time.
const breakers = new Map();
const breakerFor = (adapter) => {
  if (breakers.has(adapter.name)) return breakers.get(adapter.name);
  const breaker = wrapBreaker(`vehicle-${adapter.name}`, (plate) => fetchWithRetries(plate, adapter), {
    timeout: TIMEOUT_MS * MAX_RETRIES + 2000,
  });
  breakers.set(adapter.name, breaker);
  return breaker;
};

/**
 * Public entry: cache-first → adapter.buildRequest → fetch → adapter.parseResponse
 *
 * @param {string} plate
 * @param {{ fresh?: boolean }} opts  — `fresh` bypasses cache
 * @returns {Promise<{ raw, normalized, hit: "cache"|"network",
 *                     source: string, proxyUsed?: string }>}
 */
export const fetchByPlate = async (plate, opts = {}) => {
  const adapter = getActiveProvider();
  const normalized = adapter.normalizePlate(plate);
  if (!adapter.isPlateValid(normalized)) {
    const e = new Error("Plate format invalid"); e.code = "PLATE_INVALID"; throw e;
  }
  const cacheKey = `vehicle:${adapter.name}:plate:${normalized}`;
  const ttl = adapter.cacheTtlSeconds || DEFAULT_CACHE_TTL;

  if (!opts.fresh) {
    const cached = await cacheGet(cacheKey);
    if (cached) {
      return {
        raw: cached.raw,
        normalized: cached.normalized,
        hit: "cache",
        source: adapter.name,
      };
    }
  }

  const call = breakerFor(adapter);
  const { json, proxyUsed } = await call(normalized);
  const parsed = adapter.parseResponse(json, { status: 200 });

  await cacheSet(cacheKey, { raw: json, normalized: parsed }, ttl);
  return {
    raw: json,
    normalized: parsed,
    hit: "network",
    source: adapter.name,
    proxyUsed,
  };
};

if (process.env.GARAGE_API_KEY) {
  logger.info("Garage API key configured");
}
