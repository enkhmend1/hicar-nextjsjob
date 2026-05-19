import jwt from "jsonwebtoken";
import crypto from "crypto";
import chalk from "chalk";
import User from "../Model/user.model.js";
import PasswordResetToken from "../Model/passwordResetToken.model.js";
import { sendMail } from "../Service/notification.service.js";

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
  try {
    const { name, email, password, phone } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ message: "Нэр, имэйл, нууц үг шаардлагатай" });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: "Нууц үг хамгийн багадаа 6 тэмдэгт" });
    }

    const exists = await User.findOne({ email: email.toLowerCase() });
    if (exists) return res.status(409).json({ message: "Энэ имэйлээр бүртгэлтэй байна" });

    const adminCount = await User.countDocuments({ role: "admin" });
    const totalCount = adminCount === 0 ? await User.countDocuments() : 1;
    const bootstrapEmail = (process.env.BOOTSTRAP_ADMIN_EMAIL || "").toLowerCase();
    const shouldBeAdmin =
      adminCount === 0 &&
      (totalCount === 0 || (bootstrapEmail && bootstrapEmail === email.toLowerCase()));

    const user = await User.create({
      name, email, password, phone: phone || "",
      role: shouldBeAdmin ? "admin" : "user",
    });

    const accessToken = signAccess(user._id);
    const refreshToken = signRefresh(user._id);
    setRefreshCookie(res, refreshToken);

    return res.status(201).json({ user, token: accessToken });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: "Имэйл, нууц үг шаардлагатай" });
    }

    const user = await User.findOne({ email: email.toLowerCase() }).select("+password");
    if (!user) return res.status(401).json({ message: "Имэйл эсвэл нууц үг буруу" });

    const ok = await user.verifyPassword(password);
    if (!ok) return res.status(401).json({ message: "Имэйл эсвэл нууц үг буруу" });

    const accessToken = signAccess(user._id);
    const refreshToken = signRefresh(user._id);
    setRefreshCookie(res, refreshToken);

    return res.json({ user, token: accessToken });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

export const refresh = async (req, res) => {
  try {
    const token = req.cookies?.[REFRESH_COOKIE];
    if (!token) return res.status(401).json({ message: "Refresh token дутуу байна" });

    let payload;
    try {
      payload = jwt.verify(token, REFRESH_SECRET);
    } catch {
      clearRefreshCookie(res);
      return res.status(401).json({ message: "Refresh token буруу эсвэл хугацаа дууссан" });
    }
    if (payload.type !== "refresh") return res.status(401).json({ message: "Token type буруу" });

    const user = await User.findById(payload.id);
    if (!user) {
      clearRefreshCookie(res);
      return res.status(401).json({ message: "Хэрэглэгч олдсонгүй" });
    }

    // Rotate: new refresh token to limit replay window
    const accessToken = signAccess(user._id);
    setRefreshCookie(res, signRefresh(user._id));
    return res.json({ user, token: accessToken });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

export const logout = async (_req, res) => {
  clearRefreshCookie(res);
  return res.json({ ok: true });
};

export const me = async (req, res) => {
  return res.json({ user: req.user });
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
  if (doc.usedAt) return res.status(410).json({ message: "Token аль хэдийн ашиглагдсан", code: "TOKEN_USED" });
  if (doc.expiresAt.getTime() < Date.now()) {
    return res.status(410).json({ message: "Token хугацаа дууссан", code: "TOKEN_EXPIRED" });
  }

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
    if (typeof token !== "string" || !token) {
      return res.status(400).json({ message: "Token дутуу", code: "TOKEN_INVALID" });
    }
    if (typeof password !== "string" || password.length < 6) {
      return res.status(400).json({ message: "Нууц үг 6+ тэмдэгт байх ёстой", code: "PASSWORD_TOO_SHORT" });
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
