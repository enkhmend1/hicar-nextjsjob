/**
 * Redis-backed sliding-window rate limiter.
 *
 *   const limit = rateLimit({ key: (req) => req.ip, window: 60, max: 30 })
 *   app.use("/api/vehicle/lookup", limit, controller)
 *
 * Falls back to a permissive no-op when Redis is disabled (dev mode) —
 * production deployments must run with Redis to get real protection.
 *
 * Emits RateLimit-* headers per RFC draft so frontend can back off.
 */

import { redis, redisEnabled } from "../Config/redis.js";

export const rateLimit = ({
  key = (req) => req.ip,
  window = 60,           // seconds
  max = 60,              // requests per window
  prefix = "rl",
  message = "Хэт олон хүсэлт. Хэдэн секундийн дараа дахин оролдоно уу.",
} = {}) => async (req, res, next) => {
  if (!redisEnabled || !redis) return next();

  let bucket;
  try { bucket = key(req); } catch { bucket = req.ip; }
  if (!bucket) return next();

  const k = `${prefix}:${bucket}`;
  try {
    const tx = redis.multi();
    tx.incr(k);
    tx.expire(k, window, "NX"); // only set TTL on first increment
    const [count] = await tx.exec().then((r) => r.map((x) => x[1]));
    const used = Number(count);
    const remaining = Math.max(0, max - used);
    const ttl = await redis.ttl(k);

    res.setHeader("RateLimit-Limit", String(max));
    res.setHeader("RateLimit-Remaining", String(remaining));
    res.setHeader("RateLimit-Reset", String(ttl > 0 ? ttl : window));

    if (used > max) {
      res.setHeader("Retry-After", String(ttl > 0 ? ttl : window));
      return res.status(429).json({ message, retryAfter: ttl });
    }
    return next();
  } catch {
    // Never block on Redis errors — fail-open
    return next();
  }
};

/**
 * Convenience presets for common shapes.
 */
export const ipLimit  = (max, window = 60) => rateLimit({ max, window });
export const userLimit = (max, window = 60) =>
  rateLimit({ max, window, prefix: "rlu", key: (req) => req.user?._id ? `u:${req.user._id}` : `ip:${req.ip}` });
