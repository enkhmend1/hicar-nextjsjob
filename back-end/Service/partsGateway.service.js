/**
 * Parts gateway — provider-agnostic resilient client.
 *
 * Same shape as `garage.service.js` but for the external parts catalogue:
 *   • picks active adapter from `partsProviders/registry`
 *   • proxy rotation (undici dispatcher)
 *   • retry with exponential backoff for retriable errors
 *   • circuit breaker per provider
 *   • redis cache (8h default — parts catalogue moves slowly)
 *
 * Public surface:
 *   lookupParts({ vehicle, englishName, oemSeeds }, opts)
 *     → { provider, oems, items, hit:"cache"|"network"|"none",
 *         proxyUsed?, tookMs }
 *
 * If the active provider is "mock" (no creds), returns `{ oems:[], items:[], hit:"none" }`
 * without firing any HTTP request.
 */

import { logger } from "../Config/logger.js";
import { wrapBreaker } from "./circuitBreaker.service.js";
import { pickProxy, reportProxyResult } from "./proxyPool.service.js";
import { cacheGet, cacheSet } from "../Config/redis.js";
import { getActivePartsProvider } from "./partsProviders/registry.js";

const CACHE_TTL  = Number(process.env.PARTS_CACHE_TTL    || 60 * 60 * 8); // 8h
const TIMEOUT_MS = Number(process.env.PARTS_TIMEOUT_MS   || 12_000);
const MAX_RETRIES = Number(process.env.PARTS_MAX_RETRIES || 3);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const fetchOnce = async (adapter, args) => {
  const proxy = pickProxy();
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const req   = adapter.buildRequest(args);

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
      const e = new Error("Parts API rejected credentials"); e.code = "PROVIDER_AUTH"; throw e;
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
      const e = new Error("Parts API timeout"); e.code = "TIMEOUT"; e.retriable = true; throw e;
    }
    throw err;
  }
};

const fetchWithRetries = async (adapter, args) => {
  let lastErr;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try { return await fetchOnce(adapter, args); }
    catch (err) {
      lastErr = err;
      if (!err.retriable) throw err;
      const wait = Math.min(2_000, 200 * 2 ** attempt);
      await sleep(wait);
    }
  }
  throw lastErr;
};

const breakers = new Map();
const breakerFor = (adapter) => {
  if (breakers.has(adapter.name)) return breakers.get(adapter.name);
  const breaker = wrapBreaker(`parts-${adapter.name}`, (args) => fetchWithRetries(adapter, args), {
    timeout: TIMEOUT_MS * MAX_RETRIES + 2_000,
  });
  breakers.set(adapter.name, breaker);
  return breaker;
};

const cacheKey = (adapter, args) => {
  const v = [
    args.vehicle?.manuname,
    args.vehicle?.modelname,
    args.vehicle?.generation || "",
    args.vehicle?.motorcode || "",
  ].join("|").toUpperCase();
  return `parts:${adapter.name}:${v}:${String(args.englishName || "").toLowerCase()}`;
};

/**
 * @param {{
 *   vehicle: { manuname, modelname, generation?, motorcode?, motortype? },
 *   englishName: string,
 *   oemSeeds?: string[],
 * }} args
 * @param {{ fresh?: boolean }} opts
 */
export const lookupParts = async (args, opts = {}) => {
  const started = Date.now();
  const adapter = getActivePartsProvider();

  // No real provider configured → short-circuit with empty result
  if (adapter.name === "mock" || !adapter.configured) {
    return {
      provider: adapter.name,
      oems:     [],
      items:    [],
      hit:      "none",
      tookMs:   Date.now() - started,
    };
  }

  if (!args?.englishName) {
    return { provider: adapter.name, oems: [], items: [], hit: "none", tookMs: Date.now() - started };
  }

  const key = cacheKey(adapter, args);
  if (!opts.fresh) {
    const cached = await cacheGet(key);
    if (cached) {
      return { ...cached, hit: "cache", tookMs: Date.now() - started };
    }
  }

  try {
    const call = breakerFor(adapter);
    const { json, proxyUsed } = await call(args);
    const parsed = adapter.parseResponse(json, { status: 200 });
    const payload = {
      provider: adapter.name,
      oems:  parsed.oems  || [],
      items: parsed.items || [],
      raw:   parsed.raw,
      proxyUsed,
    };
    await cacheSet(key, payload, CACHE_TTL);
    return { ...payload, hit: "network", tookMs: Date.now() - started };
  } catch (err) {
    // Never let a failing upstream block our search — log & degrade.
    logger.warn("Parts API failed", { adapter: adapter.name, err });
    return {
      provider: adapter.name,
      oems:     [],
      items:    [],
      hit:      "none",
      tookMs:   Date.now() - started,
      error:    { code: err.code || "UPSTREAM_ERROR", message: err.message },
    };
  }
};
