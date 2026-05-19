import nodemailer from "nodemailer";
import chalk from "chalk";
import Notification from "../Model/notification.model.js";
import User from "../Model/user.model.js";

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

// ── Create one notification, optionally email ──────────────────────
export const notify = async ({ user, type, title, body, link = "", data = {}, email = false }) => {
  try {
    const n = await Notification.create({ user, type, title, body, link, data });
    if (email && emailEnabled) {
      const u = typeof user === "object" ? user : await User.findById(user);
      if (u?.email) {
        transporter.sendMail({
          from: FROM, to: u.email, subject: title,
          text: body, html: `<p>${body}</p>${link ? `<p><a href="${link}">${link}</a></p>` : ""}`,
        }).catch(e => console.error(chalk.red("Email send failed:"), e.message));
      }
    }
    return n;
  } catch (e) {
    console.error(chalk.red("Notify failed:"), e.message);
    return null;
  }
};

// ── Broadcast to all admins ────────────────────────────────────────
export const notifyAdmins = async (payload) => {
  const admins = await User.find({ role: "admin" }).select("_id");
  await Promise.all(admins.map(a => notify({ ...payload, user: a._id })));
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
