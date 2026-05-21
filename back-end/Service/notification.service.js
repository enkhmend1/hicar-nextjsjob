import nodemailer from "nodemailer";
import chalk from "chalk";
// Notification + User models are now used only by the outbox service.
// They live on at top-level via that module's imports; we don't need
// them here anymore.

// ── Email transport (optional) ─────────────────────────────────────
let transporter = null;
const SMTP_HOST = process.env.SMTP_HOST;
const emailEnabled = Boolean(SMTP_HOST);
if (emailEnabled) {
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
  console.log(chalk.green.bold(`Email enabled (${SMTP_HOST})`));
} else {
  console.log(chalk.yellow("Email disabled — set SMTP_HOST to enable"));
}

const FROM = process.env.SMTP_FROM || "no-reply@hicar.mn";

/**
 * Public notify API — preserved verbatim from the original signature so
 * every caller across the codebase keeps working without edits.
 *
 * INTERNALLY this now delegates to the notification outbox service, which
 * provides durable retry + exactly-once delivery semantics. The synchronous
 * Notification.create + transporter.sendMail path is GONE — those side
 * effects now happen inside the outbox worker, which retries on failure
 * instead of silently dropping the message.
 *
 * Callers should treat the returned value as opaque (most do — almost all
 * call sites are `notify({...}).catch(...)`).
 */
export const notify = async (payload) => {
  try {
    // Lazy import — outbox service is registered after notification.service
    // in index.js, so importing at module top would deadlock.
    const { enqueue } = await import("./notificationOutbox.service.js");
    return await enqueue(payload);
  } catch (e) {
    // Outbox should NEVER throw on a normal write — if it does, log loudly
    // so we notice. Do not propagate: notify() must stay non-fatal because
    // it sits on the critical path of refund / dispute flows.
    console.error(chalk.red("Notify (outbox) failed:"), e.message);
    return null;
  }
};

/** Broadcast to all admins — same outbox guarantees. */
export const notifyAdmins = async (payload) => {
  try {
    const { enqueueAdmins } = await import("./notificationOutbox.service.js");
    return await enqueueAdmins(payload);
  } catch (e) {
    console.error(chalk.red("NotifyAdmins (outbox) failed:"), e.message);
    return null;
  }
};

/**
 * Send a plain email WITHOUT creating an in-app notification.
 *
 * Used by flows where the recipient isn't authenticated and thus can't
 * see in-app notifications — most importantly password-reset links and
 * email verifications.
 *
 * Behaviour:
 *   • If SMTP is configured → sends via nodemailer
 *   • If SMTP is disabled    → logs the message body to the server console
 *                              with a clear `[email:dev]` prefix, so devs
 *                              copy the reset link from the terminal during
 *                              local development without setting up SMTP
 *   • Always resolves; never throws (logs failures)
 *
 * @param {{ to: string, subject: string, text: string, html?: string }} msg
 * @returns {Promise<{ delivered: boolean; transport: "smtp" | "console" | "failed" }>}
 */
export const sendMail = async ({ to, subject, text, html }) => {
  if (!to) {
    console.warn(chalk.yellow("sendMail called without `to` — skipping"));
    return { delivered: false, transport: "failed" };
  }

  if (!emailEnabled) {
    // Dev fallback — surface the message in the terminal so the developer
    // can copy the link / code without standing up SMTP.
    console.log(chalk.cyan("\n[email:dev] " + "─".repeat(60)));
    console.log(chalk.cyan(`  to:      ${to}`));
    console.log(chalk.cyan(`  subject: ${subject}`));
    console.log(chalk.cyan(`  body:    ${text}`));
    console.log(chalk.cyan("─".repeat(73) + "\n"));
    return { delivered: true, transport: "console" };
  }

  try {
    await transporter.sendMail({
      from: FROM, to, subject,
      text,
      html: html ?? `<p>${text.replace(/\n/g, "<br>")}</p>`,
    });
    return { delivered: true, transport: "smtp" };
  } catch (e) {
    console.error(chalk.red(`sendMail to ${to} failed:`), e.message);
    return { delivered: false, transport: "failed" };
  }
};

export const emailConfigured = emailEnabled;
