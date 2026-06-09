import Redis from "ioredis";
import { logger } from "./logger.js";

const url = process.env.REDIS_URL;
export const redisEnabled = Boolean(url);
export const CACHE_TTL = Number(process.env.CACHE_TTL_SECONDS) || 60;

let client = null;
if (redisEnabled) {
  client = new Redis(url, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    lazyConnect: true,
  });
  client.connect()
    .then(() => logger.info("Redis connected", { ttl: CACHE_TTL }))
    .catch((e) => {
      logger.error("Redis connect failed", { err: e });
      client = null;
    });
  client.on("error", (e) => {
    logger.warn("Redis error", { err: e });
  });
} else {
  logger.warn("Redis disabled — no caching");
}

export const redis = client;

/** Get JSON-decoded value or null. Never throws (returns null on error). */
export const cacheGet = async (key) => {
  if (!client) return null;
  try {
    const raw = await client.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

/** Set with TTL. Never throws. */
export const cacheSet = async (key, value, ttl = CACHE_TTL) => {
  if (!client) return;
  try {
    await client.set(key, JSON.stringify(value), "EX", ttl);
  } catch { /* swallow */ }
};

/** Delete one key or all keys matching pattern (uses SCAN). */
export const cacheInvalidate = async (pattern) => {
  if (!client) return;
  try {
    if (!pattern.includes("*")) {
      await client.del(pattern);
      return;
    }
    let cursor = "0";
    do {
      const [next, keys] = await client.scan(cursor, "MATCH", pattern, "COUNT", 100);
      if (keys.length > 0) await client.del(...keys);
      cursor = next;
    } while (cursor !== "0");
  } catch { /* swallow */ }
};
