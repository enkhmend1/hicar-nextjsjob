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
import chalk from "chalk";

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
    console.warn(chalk.red(`[circuit:${name}] OPEN — refusing calls for ${(opts.resetTimeout ?? DEFAULTS.resetTimeout) / 1000}s`)));
  breaker.on("halfOpen", () =>
    console.log(chalk.yellow(`[circuit:${name}] HALF-OPEN — probing`)));
  breaker.on("close", () =>
    console.log(chalk.green(`[circuit:${name}] CLOSED — healthy`)));

  // Fail-open when the breaker rejects so callers can decide a fallback
  breaker.fallback((...args) => {
    const err = new Error(`Circuit "${name}" is open`);
    err.code = "CIRCUIT_OPEN";
    err.args = args;
    throw err;
  });

  return (...args) => breaker.fire(...args);
};
