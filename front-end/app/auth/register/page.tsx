"use client";

/**
 * Register page — Phase E.5 senior-grade rewrite.
 *
 * Changes vs. v1:
 *   • React Hook Form + zodResolver(registerSchema) — same schema the
 *     backend validates against (one source of truth).
 *   • Live password-strength meter (0–4) using scorePassword() — gives
 *     immediate feedback without scolding the user with novelty rules.
 *   • Password mismatch checked INLINE via Zod refinement, not only at
 *     submit time. The 2nd password field shows a red border + message
 *     the moment it diverges (after blur).
 *   • Mongolian phone format validation (8 digits, optional). Phone is
 *     OPTIONAL on the backend — UI was incorrectly requiring it.
 *   • autoComplete attributes — new-password / family-name / tel-national.
 *   • inputMode=tel for the phone field → mobile numeric keyboard.
 *   • Per-field error display + auto-focus on first server-flagged field.
 *   • Show/hide password toggle (the v1 register page didn't have one).
 *   • Submit button stays disabled while RHF is validating + submitting,
 *     with a spinner. Better than a static "Бүртгэж байна…".
 */

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAuthStore } from "@/store";
import { api, ApiError } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { User } from "@/app/types";
import {
  registerSchema, scorePassword,
  type RegisterInput, type AuthErrorCode,
} from "@/app/lib/authSchema";
import { Eye, EyeOff, ArrowLeft, CheckCircle, Loader2, AlertCircle } from "lucide-react";

const messageFor = (code: AuthErrorCode | string | undefined, fallback: string): string => {
  const map: Record<string, string> = {
    EMAIL_TAKEN:       "Энэ имэйлээр бүртгэлтэй байна — нэвтэрнэ үү",
    VALIDATION_FAILED: "Оруулсан мэдээлэл буруу байна — талбараа шалгана уу",
    RATE_LIMITED:      "Хэт олон оролдлого хийсэн. Хэдэн минутын дараа дахин оролдоно уу.",
    PASSWORD_TOO_SHORT:"Нууц үг хамгийн багадаа 6 тэмдэгт байх ёстой",
    INTERNAL_ERROR:    "Дотоод алдаа гарлаа. Дахин оролдоно уу.",
  };
  return (code && map[code]) || fallback || "Алдаа гарлаа";
};

type FieldName = keyof RegisterInput;

export default function RegisterPage() {
  const [showPw, setShowPw] = useState(false);
  const [topErr, setTopErr] = useState("");
  const { setSession } = useAuthStore();
  const router = useRouter();
  const t = useT();

  const {
    register, handleSubmit, watch, setError, setFocus,
    formState: { errors, isSubmitting },
  } = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema) as never,
    defaultValues: { name: "", email: "", phone: "", password: "", passwordConfirm: "" },
    mode: "onTouched",
  });

  useEffect(() => { setFocus("name"); }, [setFocus]);

  // Live password strength — computed on every keystroke, cheap.
  const passwordValue = watch("password");
  const strength = scorePassword(passwordValue || "");

  const onSubmit = async (values: RegisterInput) => {
    setTopErr("");
    // The backend never sees passwordConfirm — strip it before sending.
    const { passwordConfirm: _ignored, ...payload } = values;
    void _ignored;

    try {
      const { user, token } = await api.post<{ user: User; token: string }>(
        "/auth/register", payload,
      );
      setSession(user, token);
      router.push("/");
    } catch (e) {
      const ae = e as ApiError;
      const code = (ae.data?.code as AuthErrorCode | undefined);
      const fields = (ae.data?.fields as Array<{ path: string; message: string }> | undefined);

      // Special-case: duplicate email → highlight email field + offer login.
      if (code === "EMAIL_TAKEN") {
        setError("email", { type: "server", message: "Энэ имэйлээр бүртгэлтэй байна" });
        setFocus("email");
      }

      if (fields?.length) {
        for (const f of fields) {
          // Only attach to known fields; ignore unknown server paths.
          if (["name", "email", "phone", "password"].includes(f.path)) {
            setError(f.path as FieldName, { type: "server", message: f.message });
          }
        }
        const firstField = fields.find((f) => ["name", "email", "phone", "password"].includes(f.path));
        if (firstField) setFocus(firstField.path as FieldName);
      }

      setTopErr(messageFor(code, ae.message || ""));
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-white flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-[380px]">
        <Link href="/" className="flex items-center gap-1.5 text-[13px] text-gray-500 hover:text-blue-600 mb-6 transition-colors">
          <ArrowLeft size={14} /> {t("auth.backHome")}
        </Link>

        <div className="text-center mb-7">
          <span className="text-[26px] font-semibold"><em className="text-blue-600 not-italic">Hi</em>car</span>
          <h1 className="text-[20px] font-semibold text-gray-900 mt-4 mb-1">{t("auth.registerTitle")}</h1>
          <p className="text-[13px] text-gray-500">{t("auth.registerSubtitle")}</p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-xl shadow-gray-100">
          {topErr && (
            <div role="alert" aria-live="polite"
                 className="bg-red-50 border border-red-200 text-red-700 text-[13px] rounded-xl px-3.5 py-2.5 mb-4 flex items-start gap-2">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              <span>{topErr}</span>
            </div>
          )}

          <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-3.5">
            {/* Name */}
            <Field label={t("auth.name")} error={errors.name?.message}>
              <input
                type="text"
                autoComplete="name"
                placeholder="Болд Баатар"
                aria-invalid={!!errors.name}
                {...register("name")}
                className={inputCls(!!errors.name)}
              />
            </Field>

            {/* Email */}
            <Field label={t("auth.email")} error={errors.email?.message}>
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="off"
                spellCheck={false}
                placeholder="example@mail.com"
                aria-invalid={!!errors.email}
                {...register("email")}
                className={inputCls(!!errors.email)}
              />
            </Field>

            {/* Phone — optional. Hint clarifies the 8-digit Mongolian format. */}
            <Field
              label={`${t("auth.phone")} (заавал биш)`}
              error={errors.phone?.message}
              hint="8 оронтой Монгол дугаар. Жнь: 9900 1122">
              <input
                type="tel"
                inputMode="tel"
                autoComplete="tel-national"
                placeholder="9900 1122"
                aria-invalid={!!errors.phone}
                {...register("phone")}
                className={inputCls(!!errors.phone)}
              />
            </Field>

            {/* Password + strength meter */}
            <Field label={t("auth.password")} error={errors.password?.message}>
              <div className="relative">
                <input
                  type={showPw ? "text" : "password"}
                  autoComplete="new-password"
                  placeholder="••••••••"
                  aria-invalid={!!errors.password}
                  {...register("password")}
                  className={inputCls(!!errors.password, "pr-11")}
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  tabIndex={-1}
                  aria-label={showPw ? "Нууц үг нуух" : "Нууц үг харуулах"}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 bg-transparent border-none cursor-pointer">
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {/* Strength meter — only shown when the user has typed something */}
              {passwordValue && (
                <div className="mt-1.5">
                  <div className="flex gap-1 mb-1" aria-hidden>
                    {[0, 1, 2, 3].map((i) => (
                      <div key={i}
                        className={`h-1 flex-1 rounded-full transition-colors ${
                          i < strength.score ? strength.color : "bg-gray-200"
                        }`}
                      />
                    ))}
                  </div>
                  <div className="text-[10px] text-gray-500">
                    Хүчтэй байдал:{" "}
                    <span className={`font-semibold ${
                      strength.score >= 3 ? "text-emerald-600"
                      : strength.score >= 2 ? "text-yellow-600"
                      : "text-red-600"
                    }`}>
                      {strength.label}
                    </span>
                  </div>
                </div>
              )}
            </Field>

            {/* Confirm password — Zod refinement catches mismatch */}
            <Field label={t("auth.passwordRepeat")} error={errors.passwordConfirm?.message}>
              <input
                type={showPw ? "text" : "password"}
                autoComplete="new-password"
                placeholder="••••••••"
                aria-invalid={!!errors.passwordConfirm}
                {...register("passwordConfirm")}
                className={inputCls(!!errors.passwordConfirm)}
              />
            </Field>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-xl py-3 text-[14px] font-semibold transition-colors cursor-pointer font-sans flex items-center justify-center gap-2">
              {isSubmitting && <Loader2 size={14} className="animate-spin" />}
              {isSubmitting ? t("auth.registering") : t("auth.registerTitle")}
            </button>
          </form>

          <div className="mt-4 pt-4 border-t border-gray-100">
            {["OEM баталгаатай сэлбэг", "Japan нийлүүлэгчтэй шууд", "QPay, Wallet төлбөр"].map((line) => (
              <div key={line} className="flex items-center gap-2 text-[12px] text-gray-400 py-0.5">
                <CheckCircle size={11} className="text-emerald-400" />{line}
              </div>
            ))}
          </div>

          <div className="mt-3 text-center text-[13px] text-gray-500">
            {t("auth.haveAccount")}{" "}
            <Link href="/auth/login" className="text-blue-600 font-semibold">
              {t("auth.loginTitle")}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Field wrapper — identical contract to the login page's Field. Kept
// as a local definition rather than a shared module because the visual
// treatment may diverge between flows (e.g. register adds the strength
// meter slot below the input).
// ────────────────────────────────────────────────────────────────────
function Field({
  label, error, hint, children,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-[13px] font-medium text-gray-700 mb-1">{label}</label>
      {children}
      {error && (
        <p role="alert" className="text-[11px] text-red-600 mt-1">{error}</p>
      )}
      {!error && hint && (
        <p className="text-[11px] text-gray-400 mt-1">{hint}</p>
      )}
    </div>
  );
}

const inputCls = (invalid: boolean, extra = "") =>
  `w-full bg-gray-50 border rounded-xl px-4 py-2.5 text-[16px] md:text-[14px] focus:bg-white outline-none transition-colors ${
    invalid
      ? "border-red-300 focus:border-red-500"
      : "border-gray-200 focus:border-blue-500"
  } ${extra}`;
