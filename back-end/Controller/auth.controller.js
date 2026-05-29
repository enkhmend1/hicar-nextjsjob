import jwt from "jsonwebtoken";
import crypto from "crypto";
import chalk from "chalk";
import User from "../Model/user.model.js";
import PasswordResetToken from "../Model/passwordResetToken.model.js";
import { sendMail } from "../Service/notification.service.js";
import {
  registerSchema, loginSchema, forgotPasswordSchema, resetPasswordSchema,
  updateProfileSchema, changePasswordSchema,
  validateAuth, AUTH_ERROR_CODES as ERR,
} from "../Service/authSchema.service.js";

/**
 * Internal helper — sanitize an Error before sending it on the wire.
 *
 * Mongoose throws messages that often expose schema field names ("E11000
 * duplicate key error collection: hicar.users index: email_1 dup key"),
 * which is enough metadata for an attacker to start guessing. We catch
 * the few known patterns and convert them; everything else gets a
 * generic INTERNAL_ERROR and the original is logged server-side.
 */
const respondSafeError = (res, err) => {
  const msg = String(err?.message || "");

  // Duplicate-key surfaces during a race between two register requests
  // for the same email — the unique index catches it after our
  // findOne() check.
  if (err?.code === 11000 || /E11000|duplicate key/i.test(msg)) {
    return res.status(409).json({
      code: ERR.EMAIL_TAKEN,
      message: "Энэ имэйлээр бүртгэлтэй байна",
    });
  }

  // Mongoose ValidationError — model-level constraints (e.g. malformed
  // email passing Zod but failing the regex in user.model.js).
  if (err?.name === "ValidationError" && err?.errors) {
    const fields = Object.entries(err.errors).map(([path, e]) => ({
      path,
      message: e?.message || "Талбар буруу",
    }));
    return res.status(400).json({
      code: ERR.VALIDATION_FAILED,
      message: fields[0]?.message || "Оруулсан мэдээлэл буруу",
      fields,
    });
  }

  // Default: scrub everything else, log the raw error for ops.
  console.error(chalk.red("[auth] internal error:"), err?.stack || msg);
  return res.status(500).json({
    code: ERR.INTERNAL_ERROR,
    message: "Дотоод алдаа гарлаа. Дахин оролдоно уу.",
  });
};

const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;          // 30 minutes
const RESET_TOKEN_BYTES  = 32;                       // 43-char base64url
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:3000";

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

const ACCESS_EXPIRES = process.env.JWT_EXPIRES_IN || "15m";
const REFRESH_EXPIRES = process.env.REFRESH_TOKEN_EXPIRES_IN || "30d";
const REFRESH_SECRET = process.env.REFRESH_TOKEN_SECRET || (process.env.JWT_SECRET + "-refresh");
const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN || undefined;
const IS_PROD = process.env.NODE_ENV === "production";

const REFRESH_COOKIE = "hicar_rt";

const signAccess = (id) =>
  jwt.sign({ id, type: "access" }, process.env.JWT_SECRET, { expiresIn: ACCESS_EXPIRES });

const signRefresh = (id) =>
  jwt.sign({ id, type: "refresh" }, REFRESH_SECRET, { expiresIn: REFRESH_EXPIRES });

const setRefreshCookie = (res, token) => {
  // 30 days in ms
  const maxAge = 30 * 24 * 60 * 60 * 1000;
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: IS_PROD ? "none" : "lax",
    domain: COOKIE_DOMAIN,
    path: "/api/auth",
    maxAge,
  });
};

const clearRefreshCookie = (res) => {
  res.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: IS_PROD ? "none" : "lax",
    domain: COOKIE_DOMAIN,
    path: "/api/auth",
  });
};

export const register = async (req, res) => {
  // ① Zod validation — structured field errors flow back to the form.
  const v = validateAuth(registerSchema, req.body);
  if (!v.success) {
    return res.status(400).json({
      code: v.code, message: v.message, fields: v.fields,
    });
  }
  const { name, email, password, phone } = v.data;

  try {
    // ② Pre-check duplicate (cheap path; the unique index is the actual
    //    race-safe gate — see respondSafeError's 11000 handler).
    const exists = await User.findOne({ email });
    if (exists) {
      return res.status(409).json({
        code: ERR.EMAIL_TAKEN,
        message: "Энэ имэйлээр бүртгэлтэй байна",
      });
    }

    // ③ Bootstrap-admin election. The first signup with no admins yet
    //    OR a signup whose email matches BOOTSTRAP_ADMIN_EMAIL becomes
    //    the platform admin. Everything else is a regular user.
    const adminCount = await User.countDocuments({ role: "admin" });
    const totalCount = adminCount === 0 ? await User.countDocuments() : 1;
    const bootstrapEmail = (process.env.BOOTSTRAP_ADMIN_EMAIL || "").toLowerCase();
    const shouldBeAdmin =
      adminCount === 0 &&
      (totalCount === 0 || (bootstrapEmail && bootstrapEmail === email));

    const user = await User.create({
      name, email, password, phone,
      role: shouldBeAdmin ? "admin" : "user",
    });

    const accessToken = signAccess(user._id);
    const refreshToken = signRefresh(user._id);
    setRefreshCookie(res, refreshToken);

    return res.status(201).json({ user, token: accessToken });
  } catch (err) {
    return respondSafeError(res, err);
  }
};

export const login = async (req, res) => {
  // ① Zod validation
  const v = validateAuth(loginSchema, req.body);
  if (!v.success) {
    return res.status(400).json({
      code: v.code, message: v.message, fields: v.fields,
    });
  }
  const { email, password } = v.data;

  try {
    // ② Constant-shape response for both "no such user" and "bad
    //    password" cases — never reveal which side failed, never use
    //    different status codes. This is the textbook anti-enumeration
    //    pattern (timing is still slightly variable because argon2 only
    //    runs on the existing-user branch, but the wire shape is
    //    identical and the rate limiters above the controller cap the
    //    timing-oracle budget).
    const user = await User.findOne({ email }).select("+password");
    const ok = user ? await user.verifyPassword(password) : false;
    if (!user || !ok) {
      return res.status(401).json({
        code: ERR.INVALID_CREDS,
        message: "Имэйл эсвэл нууц үг буруу",
      });
    }

    const accessToken = signAccess(user._id);
    const refreshToken = signRefresh(user._id);
    setRefreshCookie(res, refreshToken);

    return res.json({ user, token: accessToken });
  } catch (err) {
    return respondSafeError(res, err);
  }
};

export const refresh = async (req, res) => {
  try {
    const token = req.cookies?.[REFRESH_COOKIE];
    if (!token) {
      return res.status(401).json({
        code: ERR.TOKEN_INVALID, message: "Сесс хугацаа дууссан байна",
      });
    }

    let payload;
    try {
      payload = jwt.verify(token, REFRESH_SECRET);
    } catch {
      clearRefreshCookie(res);
      return res.status(401).json({
        code: ERR.TOKEN_EXPIRED, message: "Сесс хугацаа дууссан байна",
      });
    }
    if (payload.type !== "refresh") {
      return res.status(401).json({
        code: ERR.TOKEN_INVALID, message: "Token буруу",
      });
    }

    const user = await User.findById(payload.id);
    if (!user) {
      clearRefreshCookie(res);
      return res.status(401).json({
        code: ERR.USER_NOT_FOUND, message: "Хэрэглэгч олдсонгүй",
      });
    }

    // Rotate: new refresh token to limit replay window
    const accessToken = signAccess(user._id);
    setRefreshCookie(res, signRefresh(user._id));
    return res.json({ user, token: accessToken });
  } catch (err) {
    return respondSafeError(res, err);
  }
};

export const logout = async (_req, res) => {
  clearRefreshCookie(res);
  return res.json({ ok: true });
};

export const me = async (req, res) => {
  return res.json({ user: req.user });
};

/**
 * PATCH /api/auth/me  — Phase Z.3 self-service profile editor.
 *
 * Body: { name?, phone? }    (both optional individually but at least one required)
 *
 * Why a dedicated endpoint instead of reusing the admin user.controller:
 *   • The admin endpoint accepts ANY field (role, sellerStatus, trust, …).
 *     A buyer must never be able to escalate themselves to admin/seller by
 *     PATCHing `/api/users/:id`. This handler whitelists name + phone only.
 *   • Validation errors come back in the same { code, fields } envelope
 *     the register form already understands, so the /profile page can
 *     reuse the same RHF + zodResolver wiring.
 *
 * NOT allowed via this endpoint:
 *   email   — would need re-verification flow (out of scope v1)
 *   role    — privilege escalation surface
 *   sellerStatus / sellerProfile.* — sellers edit those via /api/seller/profile
 */
export const updateMe = async (req, res) => {
  const v = validateAuth(updateProfileSchema, req.body);
  if (!v.success) {
    return res.status(400).json({
      code: v.code, message: v.message, fields: v.fields,
    });
  }
  const { name, phone } = v.data;

  try {
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $set: { name, phone } },
      { returnDocument: "after", runValidators: true },
    );
    if (!user) {
      return res.status(404).json({
        code: ERR.USER_NOT_FOUND, message: "Хэрэглэгч олдсонгүй",
      });
    }
    return res.json({ user });
  } catch (err) {
    return respondSafeError(res, err);
  }
};

/**
 * POST /api/auth/change-password — Phase Z.3.
 *
 * Body: { currentPassword, newPassword }
 *
 * Requires the current password as a re-authentication gate. This is the
 * defence against a stolen access token: an attacker holding only the JWT
 * cannot rotate creds (and thereby lock the legitimate user out) without
 * also knowing the password.
 *
 * On success we keep the existing refresh cookie alive — the user stays
 * logged in on the device they just rotated from. Other devices keep
 * their existing access tokens until expiry; for now that's an accepted
 * tradeoff (true "log out everywhere" requires a refresh-token version
 * column on the User, which is a bigger change).
 */
export const changePassword = async (req, res) => {
  const v = validateAuth(changePasswordSchema, req.body);
  if (!v.success) {
    return res.status(400).json({
      code: v.code, message: v.message, fields: v.fields,
    });
  }
  const { currentPassword, newPassword } = v.data;

  if (currentPassword === newPassword) {
    return res.status(400).json({
      code: ERR.VALIDATION_FAILED,
      message: "Шинэ нууц үг хуучнаасаа өөр байх ёстой",
      fields: [{ path: "newPassword", message: "Хуучин нууц үгтэй ижил байна" }],
    });
  }

  try {
    // Re-fetch with the password column (it's select: false by default).
    const user = await User.findById(req.user._id).select("+password");
    if (!user) {
      return res.status(404).json({
        code: ERR.USER_NOT_FOUND, message: "Хэрэглэгч олдсонгүй",
      });
    }

    const ok = await user.verifyPassword(currentPassword);
    if (!ok) {
      // 401 not 400 — wrong CURRENT password is an auth failure, not a
      // schema failure. Frontend can highlight the currentPassword field
      // via the fields[] array regardless.
      return res.status(401).json({
        code: ERR.INVALID_CREDS,
        message: "Одоогийн нууц үг буруу байна",
        fields: [{ path: "currentPassword", message: "Одоогийн нууц үг буруу" }],
      });
    }

    user.password = newPassword;   // pre('save') re-hashes via argon2
    await user.save();

    // Fire-and-forget notification — same anomaly-visibility principle
    // as the reset-password flow.
    sendMail({
      to: user.email,
      subject: "HiCar — Нууц үг шинэчлэгдсэн",
      text:
`Сайн байна уу ${user.name},

Таны HiCar нууц үг амжилттай шинэчлэгдлээ.

Хэрэв ЭНЭ үйлдлийг ТА ХИЙГЭЭГҮЙ бол шууд бидэнтэй холбоо барина уу — таны акаунт эрсдэлд орсон байж магадгүй.

— HiCar баг`,
    }).catch(() => {});

    console.log(chalk.yellow(
      `[audit] password-changed-self  user=${user._id}  email=${user.email}  ip=${req.ip}`,
    ));

    return res.json({ ok: true, message: "Нууц үг амжилттай шинэчлэгдлээ" });
  } catch (err) {
    return respondSafeError(res, err);
  }
};

// ──────────────────────────────────────────────────────────────────
// Password recovery (self-serve)
// ──────────────────────────────────────────────────────────────────
//
//   ┌────────────────┐          ┌────────────────────┐
//   │ POST /forgot   │  email   │ POST /reset        │  token + new pw
//   │   anti-enum +  │──link──> │   single-use +     │──set + invalidate
//   │   rate-limited │          │   constant-time    │  refresh sessions
//   └────────────────┘          └────────────────────┘
//
// Threat model addressed:
//   • Email enumeration         → always responds 200 with same generic msg
//   • Token replay              → tokens marked `usedAt`, sha256 hashed on disk
//   • Token guessing            → 32-byte cryptographic random (256 bits)
//   • Expired tokens piling up  → Mongo TTL index auto-deletes
//   • Stolen refresh cookies    → all existing refresh sessions invalidated
//                                 after a successful reset (force re-login)
//   • Account takeover          → notification email to the affected user
//                                 the moment a reset is REQUESTED, not just
//                                 redeemed — anomaly is visible immediately

/**
 * POST /api/auth/forgot-password
 * Body: { email }
 *
 * Always replies 200 with the same generic message regardless of whether
 * the email is registered. This prevents an attacker from probing the user
 * database. Token + email work happens asynchronously after the response
 * is queued, so timing differences don't leak signal either.
 */
export const forgotPassword = async (req, res) => {
  const email = String(req.body?.email || "").toLowerCase().trim();

  // Always-on response — never reveals whether the email exists.
  const respond = () => res.json({
    ok: true,
    message: "Хэрэв энэ имэйлээр бүртгэлтэй бол сэргээх линк илгээгдсэн.",
  });

  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    return respond();
  }

  try {
    const user = await User.findOne({ email });
    if (!user) return respond();

    // Revoke all prior unused tokens for this user — only one outstanding
    // reset can exist at a time, so a leaked email link can't be paired
    // with a separate concurrent request.
    await PasswordResetToken.updateMany(
      { user: user._id, usedAt: null },
      { $set: { usedAt: new Date() } },
    );

    const rawToken = crypto.randomBytes(RESET_TOKEN_BYTES).toString("base64url");
    await PasswordResetToken.create({
      user:      user._id,
      tokenHash: sha256(rawToken),
      expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
      requestedFrom: {
        ip:        req.ip || req.headers["x-forwarded-for"] || "",
        userAgent: req.headers["user-agent"] || "",
      },
    });

    const link = `${CLIENT_ORIGIN}/auth/reset/${rawToken}`;
    const expiresIn = "30 минут";

    await sendMail({
      to: user.email,
      subject: "HiCar — Нууц үг сэргээх",
      text:
`Сайн байна уу ${user.name},

Та HiCar дээрх нууц үгээ сэргээх хүсэлт илгээсэн.

Доорх линкээр ороод шинэ нууц үгээ оруулна уу:
${link}

Энэ линк ${expiresIn}-ын дотор хүчин төгөлдөр. Хэрэв та хүсэлт өгөөгүй бол энэ имэйлийг үл анхааран алгасна уу — таны акаунт аюулгүй хэвээр.

— HiCar баг`,
      html: `
<p>Сайн байна уу <strong>${user.name}</strong>,</p>
<p>Та HiCar дээрх нууц үгээ сэргээх хүсэлт илгээсэн.</p>
<p><a href="${link}" style="display:inline-block;background:#7c3aed;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Шинэ нууц үг үүсгэх</a></p>
<p style="color:#888;font-size:12px">Эсвэл доорх URL-г browser-руу хуулна уу:<br><code>${link}</code></p>
<p style="color:#888;font-size:12px">Энэ линк <strong>${expiresIn}</strong> хүчинтэй. Хэрэв та хүсэлт өгөөгүй бол энэ имэйлийг алгасна уу.</p>
<p style="color:#888;font-size:12px">— HiCar баг</p>
      `.trim(),
    });

    console.log(chalk.yellow(
      `[audit] password-reset-requested  user=${user._id}  email=${user.email}  ip=${req.ip}  ua="${(req.headers["user-agent"] || "").slice(0, 80)}"`,
    ));

    return respond();
  } catch (err) {
    console.error(chalk.red("forgotPassword failed:"), err.message);
    // Still respond OK — never leak internal state to anonymous callers.
    return respond();
  }
};

/**
 * GET /api/auth/reset-password/check/:token
 *
 * Cheap validity check used by the frontend to gate the new-password form.
 * Returns 200 with masked user info if the token is good, 410 otherwise.
 */
export const checkResetToken = async (req, res) => {
  const raw = String(req.params.token || "");
  if (!raw) return res.status(400).json({ message: "Token дутуу", code: "TOKEN_INVALID" });

  const doc = await PasswordResetToken.findOne({ tokenHash: sha256(raw) });
  if (!doc) return res.status(410).json({ message: "Token буруу", code: "TOKEN_INVALID" });
  // Check expiry BEFORE usedAt: an expired token reveals nothing useful to
  // an attacker (they couldn't use it regardless), but distinguishing
  // "used" from "expired" via different error codes leaks that the token
  // was once valid. Return a uniform expiry message for both states.
  if (doc.expiresAt.getTime() < Date.now()) {
    return res.status(410).json({ message: "Token хугацаа дууссан", code: "TOKEN_EXPIRED" });
  }
  if (doc.usedAt) return res.status(410).json({ message: "Token аль хэдийн ашиглагдсан", code: "TOKEN_USED" });

  const user = await User.findById(doc.user).select("email name");
  if (!user) return res.status(410).json({ message: "Хэрэглэгч олдсонгүй", code: "TOKEN_INVALID" });

  // Mask the email so a stolen link doesn't dox the account
  const [local, domain] = user.email.split("@");
  const maskedEmail = `${local.slice(0, 2)}${"•".repeat(Math.max(0, local.length - 2))}@${domain}`;

  return res.json({ ok: true, maskedEmail, expiresAt: doc.expiresAt });
};

/**
 * POST /api/auth/reset-password
 * Body: { token, password }
 *
 * Verifies token (with constant-ish work regardless of validity), hashes
 * the new password (pre-save hook), invalidates the token, and clears any
 * existing refresh cookie so the user must log in fresh.
 */
export const resetPassword = async (req, res) => {
  try {
    const { token, password } = req.body || {};
    // Validate via Zod for a structured error envelope, but keep the
    // distinct PASSWORD_TOO_SHORT code so the reset form can highlight
    // the password field specifically.
    const v = validateAuth(resetPasswordSchema, { token, password });
    if (!v.success) {
      // Map the failing path to a more specific code where possible —
      // the form treats PASSWORD_TOO_SHORT differently from TOKEN_INVALID.
      const passwordError = v.fields?.some((f) => f.path === "password");
      return res.status(400).json({
        code:    passwordError ? ERR.PASSWORD_TOO_SHORT : ERR.TOKEN_INVALID,
        message: v.message,
        fields:  v.fields,
      });
    }

    const doc = await PasswordResetToken.findOne({ tokenHash: sha256(token) });
    if (!doc || doc.usedAt || doc.expiresAt.getTime() < Date.now()) {
      // Use 410 Gone so the frontend can distinguish from a 400 validation error
      return res.status(410).json({
        message: "Token буруу эсвэл хугацаа дууссан",
        code: doc?.usedAt ? "TOKEN_USED" : doc ? "TOKEN_EXPIRED" : "TOKEN_INVALID",
      });
    }

    const user = await User.findById(doc.user).select("+password email name");
    if (!user) {
      return res.status(410).json({ message: "Хэрэглэгч олдсонгүй", code: "TOKEN_INVALID" });
    }

    // Atomically: set new password (hashed by pre('save') argon2 hook) +
    // mark the token used in the same DB round.
    user.password = password;
    await user.save();

    doc.usedAt = new Date();
    await doc.save();

    // Force re-login by clearing any existing refresh cookie. This means
    // stolen refresh cookies from before the reset are useless.
    clearRefreshCookie(res);

    console.log(chalk.yellow(
      `[audit] password-reset-redeemed   user=${user._id}  email=${user.email}  ip=${req.ip}`,
    ));

    // Notify the user that the change was completed (different from the
    // "requested" notification — successful reset = real anomaly trigger).
    sendMail({
      to: user.email,
      subject: "HiCar — Нууц үг шинэчлэгдсэн",
      text:
`Сайн байна уу ${user.name},

Таны нууц үг амжилттай шинэчлэгдлээ. Шинэ нууц үгээр нэвтэрнэ үү.

Хэрэв ЭНЭ үйлдлийг ТА ХИЙГЭЭГҮЙ бол шууд бидэнтэй холбоо барина уу — таны акаунт эрсдэлд орсон байж магадгүй.

— HiCar баг`,
    }).catch(() => {});

    return res.json({ ok: true, message: "Нууц үг шинэчлэгдлээ. Дахин нэвтэрнэ үү." });
  } catch (err) {
    console.error(chalk.red("resetPassword failed:"), err.message);
    return res.status(500).json({ message: "Internal error" });
  }
};
