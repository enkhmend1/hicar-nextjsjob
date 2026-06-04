/**
 * Minimal structured JSON logger — zero new runtime dependencies.
 *
 * Emits one JSON object per line (ndjson), which any log shipper can parse.
 * Swap for pino later without changing call sites (same shape).
 */

type Level = "debug" | "info" | "warn" | "error";
type Meta = Record<string, unknown>;

function emit(level: Level, msg: string, meta?: Meta): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...(meta ?? {}) });
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

export const logger = {
  debug: (msg: string, meta?: Meta) => emit("debug", msg, meta),
  info: (msg: string, meta?: Meta) => emit("info", msg, meta),
  warn: (msg: string, meta?: Meta) => emit("warn", msg, meta),
  error: (msg: string, meta?: Meta) => emit("error", msg, meta),
};
