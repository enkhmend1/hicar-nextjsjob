import mongoose from "mongoose";

/**
 * Single-use password reset token.
 *
 *  ┌─────────────────────────────────────────────────────────────────┐
 *  │ Security model                                                  │
 *  ├─────────────────────────────────────────────────────────────────┤
 *  │ • The plaintext token is ONLY ever in the URL we email the user │
 *  │   and in their browser. On disk we keep `sha256(raw)`.          │
 *  │ • TTL index on `expiresAt` makes Mongo physically delete expired│
 *  │   tokens within ~60 seconds of expiry — no manual cleanup job.  │
 *  │ • `usedAt` is set the moment a token is consumed → replay-proof │
 *  │   even within the validity window.                              │
 *  │ • Issuing a new token revokes all prior unused tokens for that  │
 *  │   user (controller-level invariant).                            │
 *  │ • `requestedFrom` is purely audit; never exposed to the API.    │
 *  └─────────────────────────────────────────────────────────────────┘
 */
const passwordResetTokenSchema = new mongoose.Schema(
  {
    user:      { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

    // sha256 of the raw token. Indexed for O(1) lookup on redeem.
    tokenHash: { type: String, required: true, unique: true, index: true },

    expiresAt: { type: Date,   required: true },

    // null while pending, populated at the moment of redemption.
    usedAt:    { type: Date,   default: null, index: true },

    // Forensic context — never returned to clients.
    requestedFrom: {
      ip:        { type: String, default: "" },
      userAgent: { type: String, default: "" },
    },
  },
  { timestamps: true },
);

// Auto-delete expired tokens (Mongo background TTL monitor; ~60s granularity)
passwordResetTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model("PasswordResetToken", passwordResetTokenSchema);
