/**
 * Minimal, zero-dependency structured logger.
 *
 * Why not pino/winston: the app already ships chalk and needs nothing more.
 * This keeps the dependency surface small while giving production-grade,
 * machine-parseable output.
 *
 *   import { logger } from "./Config/logger.js";
 *   logger.info("Server running", { port });
 *   logger.error("Payment settle failed", { err, orderId });
 *
 * Output:
 *   • production (NODE_ENV=production): one JSON object per line on
 *     stdout/stderr — ingestible by Loki/CloudWatch/Datadog without a parser.
 *   • dev: human-friendly colored lines via chalk.
 *
 * Level gating via LOG_LEVEL (debug|info|warn|error). Default: debug in dev,
 * info in production. Errors/warns go to stderr, info/debug to stdout.
 */

import chalk from "chalk";

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const isProd = process.env.NODE_ENV === "production";
const threshold =
  LEVELS[(process.env.LOG_LEVEL || (isProd ? "info" : "debug")).toLowerCase()] ??
  LEVELS.info;

const COLORS = {
  debug: chalk.gray,
  info: chalk.blueBright,
  warn: chalk.yellow,
  error: chalk.red,
};

const serializeErr = (e) => ({
  message: e.message,
  stack: e.stack,
  ...(e.code !== undefined ? { code: e.code } : {}),
});

/** Expand Error instances (top-level or nested under any key) into plain data. */
const normalizeMeta = (meta) => {
  if (!meta) return {};
  if (meta instanceof Error) return { err: serializeErr(meta) };
  const out = {};
  for (const [k, v] of Object.entries(meta)) {
    out[k] = v instanceof Error ? serializeErr(v) : v;
  }
  return out;
};

const emit = (level, msg, meta) => {
  if (LEVELS[level] < threshold) return;
  const time = new Date().toISOString();
  const toErr = level === "error" || level === "warn";

  if (isProd) {
    const line = JSON.stringify({ level, time, msg, ...meta });
    (toErr ? process.stderr : process.stdout).write(line + "\n");
    return;
  }

  // Dev: colored, readable. Stacks print on their own lines.
  const color = COLORS[level] || ((s) => s);
  let out = `${chalk.gray(time)} ${color(`[${level.toUpperCase()}]`)} ${msg}`;
  const rest = { ...meta };
  let stack;
  if (rest.err?.stack) {
    stack = rest.err.stack;
    rest.err = rest.err.message;
  }
  if (Object.keys(rest).length) out += ` ${chalk.gray(JSON.stringify(rest))}`;
  if (stack) out += `\n${chalk.gray(stack)}`;
  (toErr ? console.error : console.log)(out);
};

export const logger = {
  debug: (msg, meta) => emit("debug", msg, normalizeMeta(meta)),
  info: (msg, meta) => emit("info", msg, normalizeMeta(meta)),
  warn: (msg, meta) => emit("warn", msg, normalizeMeta(meta)),
  error: (msg, meta) => emit("error", msg, normalizeMeta(meta)),
};

export default logger;
