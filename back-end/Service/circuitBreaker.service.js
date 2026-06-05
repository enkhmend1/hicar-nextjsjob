/**
 * Thin opossum wrapper — produces named circuit breakers with sane defaults
 * suitable for outbound HTTP calls to flaky third-party services.
 *
 *   timeout:                 12 s
 *   errorThresholdPercentage: 50 %
 *   resetTimeout:            30 s    (half-open after this many ms)
 *   rollingCountTimeout:     20 s
 *   volumeThreshold:         5       (need at least N calls in window)
 *
 * Use it like:
 *   const garageCall = wrapBreaker("garage", async (plate) => { ... });
 *   const data = await garageCall(plate);
 */

import CircuitBreaker from "opossum";
import { logger } from "../Config/logger.js";

const DEFAULTS = {
  timeout: 12_000,
  errorThresholdPercentage: 50,
  resetTimeout: 30_000,
  rollingCountTimeout: 20_000,
  rollingCountBuckets: 10,
  volumeThreshold: 5,
};

export const wrapBreaker = (name, fn, opts = {}) => {
  const breaker = new CircuitBreaker(fn, { ...DEFAULTS, ...opts, name });

  breaker.on("open", () =>
    logger.warn("circuit OPEN — refusing calls", {
      circuit: name, resetSeconds: (opts.resetTimeout ?? DEFAULTS.resetTimeout) / 1000,
    }));
  breaker.on("halfOpen", () =>
    logger.info("circuit HALF-OPEN — probing", { circuit: name }));
  breaker.on("close", () =>
    logger.info("circuit CLOSED — healthy", { circuit: name }));

  // Fail-open when the breaker rejects so callers can decide a fallback
  breaker.fallback((...args) => {
    const err = new Error(`Circuit "${name}" is open`);
    err.code = "CIRCUIT_OPEN";
    err.args = args;
    throw err;
  });

  return (...args) => breaker.fire(...args);
};
