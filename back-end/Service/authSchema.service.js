/**
 * Auth input validation — single source of truth (backend + frontend
 * mirror lives at front-end/app/lib/authSchema.ts).
 *
 * Why a dedicated service:
 *   The auth controller previously did ad-hoc `if (!email)` checks that
 *   diverged from the frontend's HTML5 `required` attributes — leading
 *   to inconsistent error messages and edge cases like "10-char password
 *   with leading whitespace" passing the client and failing the server.
 *
 *   Putting the rules in Zod lets us:
 *     • Run the SAME validation on both sides (one source of truth)
 *     • Return structured field-level errors the UI can highlight
 *     • Mirror to the frontend without runtime coupling (just keep
 *       the two files in sync via the existing productSchema pattern)
 *
 * Mongolian phone rule:
 *   The marketplace operates in Mongolia. Phone numbers are exactly
 *   8 digits (no country code stored; +976 is implicit). Optional on
 *   register because some users only have email contact.
 */

import { z } from "zod";

// ────────────────────────────────────────────────────────────────────
// Atomic field schemas — reused across multiple top-level schemas.
// ────────────────────────────────────────────────────────────────────

const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .min(3,   "Имэйл оруулна уу")
  .max(120, "Имэйл хэт урт байна")
  .email("Имэйл хаяг буруу форматтай");

// Argon2-driven; we don't pre-hash anything client-side, so the only
// hard rule is a meaningful minimum length. Common-password lists are
// out of scope for v1.
const passwordField = z
  .string()
  .min(6,   "Нууц үг хамгийн багадаа 6 тэмдэгт")
  .max(128, "Нууц үг хэт урт байна");

const nameField = z
  .string()
  .trim()
  .min(2,   "Нэр хамгийн багадаа 2 үсэг")
  .max(80,  "Нэр хэт урт байна");

// Optional phone — 8 digits, OR empty string. We accept the empty case
// explicitly (rather than .optional()) so the frontend can hand us "" and
// not have to delete the key.
const phoneField = z
  .string()
  .trim()
  .default("")
  .refine(
    (v) => v === "" || /^\d{8}$/.test(v.replace(/\D/g, "")),
    "Утасны дугаар нь 8 оронтой тоо байх ёстой (жнь 9900 1122)",
  )
  // Normalise to digits-only for storage.
  .transform((v) => v.replace(/\D/g, ""));

// ────────────────────────────────────────────────────────────────────
// Top-level schemas
// ────────────────────────────────────────────────────────────────────

export const registerSchema = z.object({
  name:     nameField,
  email:    emailField,
  password: passwordField,
  phone:    phoneField,
});

export const loginSchema = z.object({
  email:    emailField,
  password: z.string().min(1, "Нууц үг оруулна уу"), // intentionally lax on length —
  //                                                 // legacy accounts may have shorter
  //                                                 // hashes that we can't break with
  //                                                 // a stricter client-side gate.
});

export const forgotPasswordSchema = z.object({
  email: emailField,
});

export const resetPasswordSchema = z.object({
  token:    z.string().trim().min(20, "Token буруу").max(128, "Token хэт урт"),
  password: passwordField,
});

// ── Phase Z.3: self-service profile editing ────────────────────────
// Used by the buyer-side /profile page. Keeps the same atomic field
// schemas (name + phone) so error wording matches what the user saw
// during register. Both fields are required here — partial PATCH is
// modelled at the controller level by only writing the fields the
// caller actually sent.

export const updateProfileSchema = z.object({
  name:  nameField,
  phone: phoneField,
});

// Change-password requires the CURRENT password before granting the
// change — this is what stops a stolen-cookie-but-still-valid session
// from being able to lock the legitimate owner out by rotating creds.
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Одоогийн нууц үг оруулна уу"),
  newPassword:     passwordField,
});

// ────────────────────────────────────────────────────────────────────
// Validator helpers — controllers call these instead of touching Zod
// directly so the error shape stays consistent.
// ────────────────────────────────────────────────────────────────────

/**
 * Run schema.safeParse(input) and turn a failure into a stable HTTP
 * error envelope: `{ code, message, fields }`.
 *
 *   fields = [{ path: "email", message: "Имэйл хаяг буруу форматтай" }, …]
 *
 * Returns { success: true, data } on success.
 */
export const validateAuth = (schema, input) => {
  const r = schema.safeParse(input);
  if (r.success) return { success: true, data: r.data };

  const fields = r.error.issues.map((iss) => ({
    path: Array.isArray(iss.path) ? iss.path.join(".") : String(iss.path || ""),
    message: iss.message,
  }));
  return {
    success: false,
    code: "VALIDATION_FAILED",
    message: fields[0]?.message || "Оруулсан мэдээлэл буруу байна",
    fields,
  };
};

// ────────────────────────────────────────────────────────────────────
// Error code catalogue — single list, used by both ends.
//
// Backend emits one of these as `body.code`; frontend looks the code up
// in messages/<locale>.json under "auth.errors.<CODE>". This keeps the
// wire format language-neutral and makes l10n a frontend-only change.
// ────────────────────────────────────────────────────────────────────
export const AUTH_ERROR_CODES = Object.freeze({
  VALIDATION_FAILED:    "VALIDATION_FAILED",
  EMAIL_TAKEN:          "EMAIL_TAKEN",
  INVALID_CREDS:        "INVALID_CREDS",
  TOKEN_INVALID:        "TOKEN_INVALID",
  TOKEN_EXPIRED:        "TOKEN_EXPIRED",
  TOKEN_USED:           "TOKEN_USED",
  PASSWORD_TOO_SHORT:   "PASSWORD_TOO_SHORT",
  USER_NOT_FOUND:       "USER_NOT_FOUND",
  RATE_LIMITED:         "RATE_LIMITED",
  INTERNAL_ERROR:       "INTERNAL_ERROR",
});
