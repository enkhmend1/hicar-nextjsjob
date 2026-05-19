#!/usr/bin/env node
/**
 * Create a fresh admin user directly via the CLI.
 *
 *   • Bypasses the public /register endpoint (no rate limit, no email/captcha).
 *   • Intended for the very first deploy or a "doomsday" recovery where the
 *     UI / email pipeline is unusable.
 *   • Idempotent on email — if a user with that email already exists, the
 *     script promotes them to admin and optionally resets their password.
 *
 * Usage:
 *   node scripts/createAdmin.js <email>
 *   node scripts/createAdmin.js <email> --name "Erdene Admin"
 *   node scripts/createAdmin.js <email> --password "MyStrongPw#1"
 *   node scripts/createAdmin.js <email> --name "X" --password "Y" --phone 88001122
 *
 * Flags:
 *   --name     "Admin User"     display name (default: "Admin")
 *   --password "..."            explicit password (default: auto-generated)
 *   --phone    "99001122"       optional phone
 *
 * Exits:
 *   0 — created or promoted successfully
 *   1 — argument / DB failure
 */

import "dotenv/config";
import mongoose from "mongoose";
import crypto from "crypto";
import chalk from "chalk";
import User from "../Model/user.model.js";

// ── CLI flag parsing (zero-dep) ─────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (k) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : null;
};
const email    = args.find((a) => !a.startsWith("--") && /@/.test(a));
const name     = flag("name")     || "Admin";
const phone    = flag("phone")    || "";
const explicit = flag("password");

if (!email) {
  console.error(chalk.red("Usage: node scripts/createAdmin.js <email> [--name X] [--password Y] [--phone Z]"));
  process.exit(1);
}

// ── Password generator (matches admin/CLI reset format) ─────────────────
const SAFE = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const auto = () => {
  const b = crypto.randomBytes(8);
  const out = Array.from(b, (x) => SAFE[x % SAFE.length]).join("");
  return `Hicar-${out.slice(0, 4)}-${out.slice(4)}`;
};
const password = (explicit && explicit.length >= 6) ? explicit : (explicit ? null : auto());
if (!password) {
  console.error(chalk.red("--password must be at least 6 characters"));
  process.exit(1);
}

// ── Main ────────────────────────────────────────────────────────────────
try {
  console.log(chalk.gray(`Connecting to ${(process.env.MONGO_URI || "").replace(/\/\/[^@]+@/, "//***@")}…`));
  await mongoose.connect(process.env.MONGO_URI);

  const normalisedEmail = email.toLowerCase().trim();
  let user = await User.findOne({ email: normalisedEmail }).select("+password");
  let mode;

  if (user) {
    // Promote existing user; refresh password too if explicit OR if they're not admin yet
    mode = user.role === "admin" ? "password-reset" : "promote+reset";
    user.role = "admin";
    user.password = password;             // argon2 hook hashes
    if (phone) user.phone = phone;
    await user.save();
  } else {
    // Fresh create — the pre('save') hook hashes the password with argon2
    mode = "create";
    user = await User.create({
      name, email: normalisedEmail, password, phone,
      role: "admin",
    });
  }

  console.log(chalk.yellow(
    `[audit] cli-admin-${mode}  user=${user._id}  email=${user.email}  at=${new Date().toISOString()}`,
  ));

  console.log("");
  console.log(chalk.green(`✓ Admin ${mode === "create" ? "created" : "updated"}`));
  console.log("");
  console.log(chalk.bold("  user:     ") + user.email);
  console.log(chalk.bold("  name:     ") + user.name);
  console.log(chalk.bold("  role:     ") + user.role);
  console.log(chalk.bold("  password: ") + chalk.cyan(password));
  console.log("");
  console.log(chalk.gray("  Browser: http://localhost:3000/auth/login  → нэвтрээд нэн даруй нууц үгээ солино уу."));
  console.log("");

  await mongoose.disconnect();
  process.exit(0);
} catch (err) {
  console.error(chalk.red("✗ Failed:"), err.message);
  try { await mongoose.disconnect(); } catch { /* ignore */ }
  process.exit(1);
}
