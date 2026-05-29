/**
 * Auth Zod schemas — mirror of back-end/Service/authSchema.service.js.
 *
 * The two files MUST stay in sync. Any rule added on the backend must
 * land here too so the form catches the error BEFORE round-tripping
 * to the server (better UX + saves an HTTP call + saves rate-limit
 * quota). This mirror pattern is the same one productSchema.ts uses
 * — see comment header there for the full rationale.
 *
 * Inferred types are exported so the form's RHF generics stay typed.
 */

import { z } from "zod";

// ────────────────────────────────────────────────────────────────────
// Atomic fields — keep identical to the backend file
// ────────────────────────────────────────────────────────────────────

const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .min(3,   "Имэйл оруулна уу")
  .max(120, "Имэйл хэт урт байна")
  .email("Имэйл хаяг буруу форматтай");

const passwordField = z
  .string()
  .min(6,   "Нууц үг хамгийн багадаа 6 тэмдэгт")
  .max(128, "Нууц үг хэт урт байна");

const nameField = z
  .string()
  .trim()
  .min(2,   "Нэр хамгийн багадаа 2 үсэг")
  .max(40,  "Нэр хэт урт байна");

const phoneField = z
  .string()
  .trim()
  .default("")
  .refine(
    (v) => v === "" || /^\d{8}$/.test(v.replace(/\D/g, "")),
    "Утасны дугаар нь 8 оронтой тоо байх ёстой (жишээ 9900 1122)",
  )
  .transform((v) => v.replace(/\D/g, ""));

// ────────────────────────────────────────────────────────────────────
// Top-level schemas
// ────────────────────────────────────────────────────────────────────

export const loginSchema = z.object({
  email:    emailField,
  password: z.string().min(1, "Нууц үг оруулна уу"),
});

// Register's password-confirmation field is FRONTEND-ONLY — the server
// never sees `passwordConfirm`. We use a Zod refinement so the mismatch
// surfaces inline next to the second password field instead of as a
// top-level banner.
export const registerSchema = z
  .object({
    name:            nameField,
    email:           emailField,
    phone:           phoneField,
    password:        passwordField,
    passwordConfirm: z.string().min(1, "Нууц үгээ давтан оруулна уу"),
  })
  .refine((d) => d.password === d.passwordConfirm, {
    path:    ["passwordConfirm"],
    message: "Нууц үг тохирохгүй байна",
  });

export const forgotPasswordSchema = z.object({
  email: emailField,
});

export const resetPasswordSchema = z
  .object({
    password:        passwordField,
    passwordConfirm: z.string().min(1, "Нууц үгээ давтан оруулна уу"),
  })
  .refine((d) => d.password === d.passwordConfirm, {
    path:    ["passwordConfirm"],
    message: "Нууц үг тохирохгүй байна",
  });

// ────────────────────────────────────────────────────────────────────
// Inferred types — used by RHF + the network adapters
// ────────────────────────────────────────────────────────────────────

export type LoginInput    = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type ForgotInput   = z.infer<typeof forgotPasswordSchema>;
export type ResetInput    = z.infer<typeof resetPasswordSchema>;

// ────────────────────────────────────────────────────────────────────
// Password strength meter — used by the register page UI.
//
// Returns a 0–4 score + a human label. Pure function, no deps. The
// scoring is deliberately conservative: we only credit categories that
// genuinely raise entropy (length tiers, character classes), not novelty
// rules ("must contain @" etc.) that drive users to bad patterns.
// ────────────────────────────────────────────────────────────────────

export interface PasswordStrength {
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  color: string;
}

export const scorePassword = (pw: string): PasswordStrength => {
  if (!pw) return { score: 0, label: "Хоосон",          color: "bg-gray-200" };
  if (pw.length < 6) return { score: 0, label: "Хэт богино", color: "bg-red-400" };

  let s = 0;
  if (pw.length >= 8)   s++;
  if (pw.length >= 12)  s++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
  if (/\d/.test(pw))    s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;

  // Cap to 4
  const score = Math.min(4, s) as 0 | 1 | 2 | 3 | 4;
  const map: Record<number, Omit<PasswordStrength, "score">> = {
    0: { label: "Маш сул",    color: "bg-red-400" },
    1: { label: "Сул",        color: "bg-orange-400" },
    2: { label: "Дунд",       color: "bg-yellow-400" },
    3: { label: "Хүчтэй",     color: "bg-lime-500" },
    4: { label: "Маш хүчтэй", color: "bg-emerald-500" },
  };
  return { score, ...map[score] };
};

// ────────────────────────────────────────────────────────────────────
// Error-code map (mirror of AUTH_ERROR_CODES in the backend file).
//
// The frontend looks each code up in messages/<locale>.json under
// `auth.errors.<CODE>`. Unknown codes fall back to a generic message.
// ────────────────────────────────────────────────────────────────────

export const AUTH_ERROR_CODES = [
  "VALIDATION_FAILED",
  "EMAIL_TAKEN",
  "INVALID_CREDS",
  "TOKEN_INVALID",
  "TOKEN_EXPIRED",
  "TOKEN_USED",
  "PASSWORD_TOO_SHORT",
  "USER_NOT_FOUND",
  "RATE_LIMITED",
  "INTERNAL_ERROR",
] as const;

export type AuthErrorCode = typeof AUTH_ERROR_CODES[number];
