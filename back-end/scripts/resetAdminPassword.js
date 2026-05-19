#!/usr/bin/env node
/**
 * "Break-glass" admin password recovery.
 *
 * When an admin loses email access (SMTP misconfigured, lost mailbox, all
 * admins locked out), this script — runnable by anyone with SSH/shell access
 * to the server — generates and sets a new password for the named account.
 *
 * Usage:
 *   node scripts/resetAdminPassword.js <email>                  # auto-generate
 *   node scripts/resetAdminPassword.js <email> --password "X"   # set explicit pw
 *   node scripts/resetAdminPassword.js <email> --any-role       # allow non-admin too
 *
 * Security:
 *   • Requires direct server access — already a high-trust action
 *   • Refuses to reset NON-admin accounts unless --any-role is passed
 *     (forces operator to acknowledge what they're doing)
 *   • Generated password is printed ONCE to the terminal
 *   • Argon2-hashes via the regular pre('save') Mongoose hook — never stored
 *     plaintext, even temporarily
 *   • Audit line written to stdout so it's captured by any process supervisor
 *
 * Exit codes:
 *   0 — reset successful
 *   1 — user not found / argument error / DB failure
 *   2 — refused (role check)
 */

import "dotenv/config";
import mongoose from "mongoose";
import crypto from "crypto";
import chalk from "chalk";
import User from "../Model/user.model.js";

// ── CLI parsing (no library — keeps this self-contained) ────────────────
const args = process.argv.slice(2);
const email = args.find((a) => !a.startsWith("--"));
const flagPwIndex = args.indexOf("--password");
const explicitPw = flagPwIndex >= 0 ? args[flagPwIndex + 1] : null;
const allowAnyRole = args.includes("--any-role");

if (!email) {
  console.error(chalk.red("Usage: node scripts/resetAdminPassword.js <email> [--password X] [--any-role]"));
  process.exit(1);
}

// ── Token-style readable password generator (matches admin reset UX) ────
const SAFE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const generate = () => {
  const bytes = crypto.randomBytes(8);
  const out = Array.from(bytes, (b) => SAFE_ALPHABET[b % SAFE_ALPHABET.length]).join("");
  return `Hicar-${out.slice(0, 4)}-${out.slice(4)}`;
};

const newPassword = explicitPw && explicitPw.length >= 6
  ? explicitPw
  : (explicitPw ? null : generate());

if (!newPassword) {
  console.error(chalk.red("--password value must be at least 6 characters"));
  process.exit(1);
}

// ── Main ────────────────────────────────────────────────────────────────
try {
  console.log(chalk.gray(`Connecting to ${(process.env.MONGO_URI || "").replace(/\/\/[^@]+@/, "//***@")}…`));
  await mongoose.connect(process.env.MONGO_URI);

  const user = await User.findOne({ email: email.toLowerCase() }).select("+password");
  if (!user) {
    console.error(chalk.red(`✗ No user found with email "${email}"`));
    await mongoose.disconnect();
    process.exit(1);
  }

  if (user.role !== "admin" && !allowAnyRole) {
    console.error(chalk.yellow(
      `⚠ User "${email}" has role "${user.role}" (not admin).\n` +
      `  Pass --any-role to reset anyway.`,
    ));
    await mongoose.disconnect();
    process.exit(2);
  }

  user.password = newPassword;        // pre('save') argon2 hook hashes
  await user.save();

  // Audit — written to stdout so process supervisors / systemd journals pick it up
  console.log(chalk.yellow(
    `[audit] cli-password-reset  user=${user._id}  email=${user.email}  role=${user.role}  at=${new Date().toISOString()}`,
  ));

  console.log("");
  console.log(chalk.green("✓ Password reset successful"));
  console.log("");
  console.log(chalk.bold("  user:     ") + user.email);
  console.log(chalk.bold("  role:     ") + user.role);
  console.log(chalk.bold("  new pw:   ") + chalk.cyan(newPassword));
  console.log("");
  console.log(chalk.gray("  Сейл/админ-руу хүргэгээд нэвтэрсний дараа Profile-оос дахин солиулна уу."));
  console.log("");

  await mongoose.disconnect();
  process.exit(0);
} catch (err) {
  console.error(chalk.red("✗ Failed:"), err.message);
  try { await mongoose.disconnect(); } catch { /* ignore */ }
  process.exit(1);
}
