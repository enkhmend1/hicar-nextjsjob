import crypto from "crypto";
import chalk from "chalk";
import User from "../Model/user.model.js";
import { notify } from "../Service/notification.service.js";

/**
 * Generate a cryptographically random temporary password.
 *
 *   Pattern: "Hicar-XXXX-XXXX"
 *   Charset: A-Z, 2-9 minus visually ambiguous chars (0/O/1/I/L)
 *
 * 8 random chars from a 30-char alphabet = log2(30^8) ≈ 39 bits of entropy.
 * Combined with the fixed "Hicar-" prefix it's both readable and bruteforce-
 * resistant for the short window before the seller logs in to change it.
 */
const SAFE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const generateTempPassword = () => {
  const bytes = crypto.randomBytes(8);
  const out = Array.from(bytes, (b) => SAFE_ALPHABET[b % SAFE_ALPHABET.length]).join("");
  return `Hicar-${out.slice(0, 4)}-${out.slice(4)}`;
};

const ensureNotLastAdmin = async (userId) => {
  const target = await User.findById(userId);
  if (!target) return { ok: false, status: 404, message: "Хэрэглэгч олдсонгүй" };
  if (target.role !== "admin") return { ok: true, target };
  const adminCount = await User.countDocuments({ role: "admin" });
  if (adminCount <= 1) {
    return { ok: false, status: 400, message: "Сүүлчийн admin-г устгах/буулгах боломжгүй" };
  }
  return { ok: true, target };
};

export const listUsers = async (_req, res) => {
  try {
    const users = await User.find().sort({ createdAt: -1 });
    return res.json({ users });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

export const updateRole = async (req, res) => {
  try {
    const { role } = req.body;
    if (!["user", "seller", "admin"].includes(role)) {
      return res.status(400).json({ message: "Role буруу" });
    }
    // Only check if demoting from admin
    if (role !== "admin") {
      const check = await ensureNotLastAdmin(req.params.id);
      if (!check.ok) return res.status(check.status).json({ message: check.message });
    }
    const user = await User.findByIdAndUpdate(req.params.id, { role }, { new: true });
    if (!user) return res.status(404).json({ message: "Хэрэглэгч олдсонгүй" });
    return res.json({ user });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

/** List all sellers who have applied (admin only). */
export const listSellers = async (req, res) => {
  try {
    const { status } = req.query;
    const filter = { sellerStatus: { $in: ["pending", "approved", "rejected"] } };
    if (status && status !== "all" && ["pending", "approved", "rejected"].includes(status)) {
      filter.sellerStatus = status;
    }
    const sellers = await User.find(filter).sort({ "sellerProfile.appliedAt": -1 });
    return res.json({ sellers });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * Approve / reject a pending seller.
 *
 * Body: { action: "approve"|"reject", reason?, platformFeePercent? }
 * `platformFeePercent` is optional on approve — admin can leave the default
 * (5%) and tune it later via PATCH /:id/economics. We accept the legacy
 * `commissionRate` field too so older clients keep working through the
 * transition window.
 */
export const moderateSeller = async (req, res) => {
  try {
    const { action, reason } = req.body;
    // Accept either the new name or the legacy alias.
    const incomingFee =
      typeof req.body.platformFeePercent === "number"
        ? req.body.platformFeePercent
        : typeof req.body.commissionRate === "number"
          ? req.body.commissionRate
          : undefined;
    if (!["approve", "reject"].includes(action)) {
      return res.status(400).json({ message: "action: approve | reject" });
    }
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "Хэрэглэгч олдсонгүй" });

    if (action === "approve") {
      user.sellerStatus = "approved";
      user.sellerProfile = {
        ...(user.sellerProfile || {}),
        approvedAt: new Date(),
        rejectedReason: "",
        ...(typeof incomingFee === "number"
          ? { platformFeePercent: Math.max(0, Math.min(50, incomingFee)) }
          : {}),
      };
      if (user.role === "user") user.role = "seller";
    } else {
      user.sellerStatus = "rejected";
      user.sellerProfile = {
        ...(user.sellerProfile || {}),
        rejectedReason: reason || "",
      };
    }
    await user.save();
    notify({
      user: user._id,
      type: action === "approve" ? "seller_approved" : "seller_rejected",
      title: action === "approve" ? "Та seller боллоо! 🎉" : "Seller хүсэлт татгалзагдсан",
      body: action === "approve"
        ? `Дэлгүүрээ удирдан бараа байршуулна уу. Хураамж: ${user.sellerProfile.platformFeePercent}%.`
        : `Шалтгаан: ${reason || "—"}`,
      link: action === "approve" ? "/seller" : "/seller/apply",
      email: true,
    });
    return res.json({ user });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

/**
 * Admin updates a seller's platform-fee percentage + bank payout details.
 * Replaces the old `adjustWallet` which had no place in a wallet-less system.
 */
export const updateSellerEconomics = async (req, res) => {
  try {
    const { platformFeePercent, bankName, bankAccount, bankHolderName } = req.body || {};

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "Хэрэглэгч олдсонгүй" });
    if (!["seller", "admin"].includes(user.role)) {
      return res.status(400).json({ message: "Зөвхөн seller-ийн тохиргоог өөрчилж болно" });
    }

    const sp = user.sellerProfile || {};
    if (platformFeePercent !== undefined) {
      const n = Number(platformFeePercent);
      if (!Number.isFinite(n) || n < 0 || n > 50) {
        return res.status(400).json({ message: "platformFeePercent 0-50 хооронд" });
      }
      sp.platformFeePercent = Math.round(n * 100) / 100; // 2-decimal precision
    }
    if (typeof bankName       === "string") sp.bankName       = bankName.trim();
    if (typeof bankAccount    === "string") sp.bankAccount    = bankAccount.trim();
    if (typeof bankHolderName === "string") sp.bankHolderName = bankHolderName.trim();

    user.sellerProfile = sp;
    user.markModified("sellerProfile");
    await user.save();
    return res.json({ user });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

/**
 * Admin-initiated password reset.
 *
 * Security model:
 *   • Admins can never *see* an existing password (one-way hash via argon2).
 *   • Admin can issue a *new* temporary password that the user must change
 *     after next login.
 *   • The plaintext is returned in the HTTP response ONCE — never logged,
 *     never stored elsewhere. The frontend must surface it on a one-time
 *     modal and warn the operator to copy it before closing.
 *   • An in-app + email notification informs the target user that a reset
 *     happened (so an unauthorised reset is immediately visible to them).
 *   • Admins cannot reset their OWN password through this endpoint — they
 *     must use the standard self-serve flow (prevents accidental lockout).
 */
export const resetUserPassword = async (req, res) => {
  try {
    if (String(req.user._id) === String(req.params.id)) {
      return res.status(400).json({
        message: "Өөрийн нууц үгийг энэ замаар сэргээх боломжгүй. Profile-аас өөрчилнө үү.",
      });
    }

    const user = await User.findById(req.params.id).select("+password");
    if (!user) return res.status(404).json({ message: "Хэрэглэгч олдсонгүй" });

    const tempPassword = generateTempPassword();
    user.password = tempPassword;                 // pre('save') hook hashes with argon2
    await user.save();

    // Audit — server console only, never includes the password
    console.log(chalk.yellow(
      `[audit] password-reset  admin=${req.user._id}  target=${user._id}  email=${user.email}  at=${new Date().toISOString()}`,
    ));

    // Notify the user so unauthorised resets are immediately visible
    notify({
      user: user._id,
      type: "system",
      title: "Таны нууц үг шинэчлэгдсэн",
      body: "Admin таны нууц үгийг шинэчлэв. Хэрэв та хүсэлт өгөөгүй бол даруй холбоо барина уу.",
      link: "/auth/login",
      email: true,
    }).catch(() => {});

    // SECURITY: only returned ONCE, frontend must show + advise the operator
    // to copy it. We deliberately do NOT echo it back if the same request
    // is replayed (the password is already hashed on disk).
    return res.json({
      ok: true,
      tempPassword,
      message: "Шинэ нууц үгийг нэг удаа л харуулна — copy хийгээд хаагаарай",
      user: { _id: user._id, name: user.name, email: user.email },
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

export const deleteUser = async (req, res) => {
  try {
    if (String(req.user._id) === String(req.params.id)) {
      return res.status(400).json({ message: "Өөрийгөө устгаж болохгүй" });
    }
    const check = await ensureNotLastAdmin(req.params.id);
    if (!check.ok) return res.status(check.status).json({ message: check.message });
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).json({ message: "Хэрэглэгч олдсонгүй" });
    return res.json({ ok: true });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};
