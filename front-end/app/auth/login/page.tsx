"use client";

/**
 * Login page — Phase E.4 senior-grade rewrite.
 *
 * What changed vs. the v1 page:
 *   • React Hook Form + zodResolver — shared loginSchema with the
 *     backend so validation rules can't diverge silently.
 *   • Structured error codes — backend returns { code, message, fields[] }
 *     instead of bare strings. The form maps each code to a friendly
 *     localised message AND focuses the offending field.
 *   • Browser conveniences — autoComplete, inputMode, name attrs so
 *     password managers, mobile keyboards, and 1Password just work.
 *   • CAPS LOCK detection on the password field — flips a warning
 *     when the OS reports caps active during keypress.
 *   • Inline field errors (under each input) AND a top error banner
 *     for "non-field" failures (invalid creds, rate limited, etc.).
 *   • Admin credentials hint removed (was a HARD security leak).
 *   • Submit button stays disabled while RHF is validating + submitting;
 *     a spinner is shown so the user sees feedback < 16ms.
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
import { loginSchema, type LoginInput, type AuthErrorCode } from "@/app/lib/authSchema";
import { Eye, EyeOff, ArrowLeft, CheckCircle, Loader2, AlertCircle } from "lucide-react";

/**
 * Map a backend error code to a friendly Mongolian message. Falls back
 * to the server's `message` field when the code is unknown, and to a
 * truly generic copy when even that is missing.
 */
const messageFor = (code: AuthErrorCode | string | undefined, fallback: string): string => {
  const map: Record<string, string> = {
    INVALID_CREDS:      "Имэйл эсвэл нууц үг буруу байна",
    EMAIL_TAKEN:        "Энэ имэйлээр бүртгэлтэй байна — нэвтэрнэ үү",
    VALIDATION_FAILED:  "Оруулсан мэдээлэл буруу байна — талбараа шалгана уу",
    RATE_LIMITED:       "Хэт олон оролдлого хийсэн. Хэдэн минутын дараа дахин оролдоно уу.",
    TOKEN_INVALID:      "Сесс хугацаа дууссан. Дахин нэвтэрнэ үү.",
    TOKEN_EXPIRED:      "Сесс хугацаа дууссан. Дахин нэвтэрнэ үү.",
    INTERNAL_ERROR:     "Дотоод алдаа гарлаа. Дахин оролдоно уу.",
  };
  return (code && map[code]) || fallback || "Алдаа гарлаа";
};

export default function LoginPage() {
  const [show, setShow] = useState(false);
  const [capsOn, setCapsOn] = useState(false);
  const [topErr, setTopErr] = useState("");
  const { setSession } = useAuthStore();
  const router = useRouter();
  const t = useT();

  const {
    register, handleSubmit, setError, setFocus,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema) as never,
    defaultValues: { email: "", password: "" },
    mode: "onTouched",  // Validate on blur — less noisy than onChange.
  });

  // Auto-focus the email field on first mount so keyboard users can
  // start typing immediately.
  useEffect(() => { setFocus("email"); }, [setFocus]);

  const onSubmit = async (values: LoginInput) => {
    setTopErr("");
    try {
      const { user, token } = await api.post<{ user: User; token: string }>(
        "/auth/login", values,
      );
      setSession(user, token);
      router.push(user.role === "admin" ? "/admin" : "/");
    } catch (e) {
      const ae = e as ApiError;
      const code = (ae.data?.code as AuthErrorCode | undefined);
      const fields = (ae.data?.fields as Array<{ path: string; message: string }> | undefined);

      // ── Field-level errors → attach to specific inputs ─────────────
      if (fields?.length) {
        for (const f of fields) {
          if (f.path === "email" || f.path === "password") {
            setError(f.path, { type: "server", message: f.message });
          }
        }
        // Focus the first offending field for keyboard recovery.
        const firstField = fields.find((f) => f.path === "email" || f.path === "password");
        if (firstField) setFocus(firstField.path as "email" | "password");
      }

      // ── Top-level message (banner) ─────────────────────────────────
      setTopErr(messageFor(code, ae.message || ""));
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-white flex items-center justify-center px-4">
      <div className="w-full max-w-[380px]">
        <Link href="/" className="flex items-center gap-1.5 text-[13px] text-gray-500 hover:text-blue-600 mb-6 transition-colors">
          <ArrowLeft size={14} /> {t("auth.backHome")}
        </Link>

        <div className="text-center mb-7">
          <span className="text-[26px] font-semibold"><em className="text-blue-600 not-italic">Hi</em>car</span>
          <h1 className="text-[20px] font-semibold text-gray-900 mt-4 mb-1">{t("auth.loginTitle")}</h1>
          <p className="text-[13px] text-gray-500">{t("auth.loginSubtitle")}</p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-xl shadow-gray-100">
          {topErr && (
            <div role="alert" aria-live="polite"
                 className="bg-red-50 border border-red-200 text-red-700 text-[13px] rounded-xl px-3.5 py-2.5 mb-4 flex items-start gap-2">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              <span>{topErr}</span>
            </div>
          )}

          <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
            {/* Email — autoComplete=email + inputMode=email triggers
                the right mobile keyboard layout. */}
            <Field
              label={t("auth.email")}
              error={errors.email?.message}>
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

            {/* Password — CapsLock detection runs on every keypress and
                shows a hint inline (no toast, no extra render). */}
            <Field
              label={t("auth.password")}
              error={errors.password?.message}
              hint={capsOn ? "⚠ CAPS LOCK идэвхтэй байна" : undefined}>
              <div className="relative">
                <input
                  type={show ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  aria-invalid={!!errors.password}
                  {...register("password")}
                  onKeyUp={(e) => setCapsOn((e as React.KeyboardEvent<HTMLInputElement>).getModifierState?.("CapsLock") ?? false)}
                  className={inputCls(!!errors.password, "pr-11")}
                />
                <button
                  type="button"
                  onClick={() => setShow((v) => !v)}
                  tabIndex={-1}
                  aria-label={show ? "Нууц үг нуух" : "Нууц үг харуулах"}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 bg-transparent border-none cursor-pointer">
                  {show ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </Field>

            <div className="flex justify-end">
              <Link href="/auth/forgot"
                className="text-[12px] text-blue-600 hover:text-blue-700 font-medium"
               >
                Нууц үг мартсан уу?
              </Link>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-xl py-3 text-[14px] font-semibold transition-colors cursor-pointer font-sans flex items-center justify-center gap-2">
              {isSubmitting && <Loader2 size={14} className="animate-spin" />}
              {isSubmitting ? t("auth.loggingIn") : t("auth.loginTitle")}
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
            {t("auth.noAccount")}{" "}
            <Link href="/auth/register" className="text-blue-600 font-semibold">
              {t("auth.registerTitle")}
            </Link>
          </div>
        </div>

        {/* SECURITY: admin credential hints removed in Phase E.1 — never
            ship real credentials in HTML, even with weak defaults. Use
            createAdmin.js for the bootstrap admin and the seed script
            for fresh deploys. */}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Tiny field wrapper — label + error + optional hint slot. Kept inline
// (not in its own file) because the only consumer is this page and the
// register page below; promoting once a third caller appears.
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
      <label className="block text-[13px] font-medium text-gray-700 mb-1.5">{label}</label>
      {children}
      {error && (
        <p role="alert" className="text-[11px] text-red-600 mt-1">
          {error}
        </p>
      )}
      {!error && hint && (
        <p className="text-[11px] text-amber-600 mt-1">{hint}</p>
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
