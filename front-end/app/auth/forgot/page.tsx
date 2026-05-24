"use client";
import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { ArrowLeft, Mail, CheckCircle, Loader2 } from "lucide-react";

/**
 * /auth/forgot — request a password-reset email.
 *
 * Anti-enumeration: the backend ALWAYS responds 200 regardless of whether
 * the email exists, and we mirror that here by showing the same success
 * screen unconditionally. Never indicate "email not found" — that would
 * leak account existence to anonymous visitors.
 */
export default function ForgotPasswordPage() {
  const t = useT();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      await api.post("/auth/forgot-password", { email: email.trim() });
      setSubmitted(true);
    } catch (e) {
      // The endpoint is rate-limited; surface 429 to the user but keep
      // everything else opaque to avoid enumeration.
      const msg = (e as Error).message || "Алдаа гарлаа";
      if (/limit|too many|429/i.test(msg)) {
        setErr("Хэт олон оролдлого. Хэдхэн минутын дараа дахин оролдоно уу.");
      } else {
        // Treat unknown errors as success too — the backend already does.
        setSubmitted(true);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-white flex items-center justify-center px-4">
      <div className="w-full max-w-[380px]">
        <Link href="/auth/login"
          className="flex items-center gap-1.5 text-[13px] text-gray-500 hover:text-blue-600 mb-6 transition-colors"
         >
          <ArrowLeft size={14} /> {t("auth.loginTitle") || "Нэвтрэх"}
        </Link>

        <div className="text-center mb-6">
          <span className="text-[26px] font-semibold">
            <em className="text-blue-600 not-italic">Hi</em>car
          </span>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-xl shadow-gray-100">
          {submitted ? (
            <SuccessPanel email={email} />
          ) : (
            <>
              <div className="w-11 h-11 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mb-3">
                <Mail size={20} />
              </div>
              <h1 className="text-[20px] font-semibold text-gray-900 mb-1">Нууц үг мартсан уу?</h1>
              <p className="text-[13px] text-gray-500 mb-5">
                Бүртгэлтэй имэйлээ оруулна уу. Бид сэргээх линкийг 30 минут хүчинтэй илгээнэ.
              </p>

              {err && (
                <div className="bg-red-50 border border-red-200 text-red-600 text-[12px] rounded-xl px-3 py-2 mb-3">
                  ⚠ {err}
                </div>
              )}

              <form onSubmit={submit} className="space-y-3">
                <div>
                  <label className="block text-[13px] font-medium text-gray-700 mb-1.5">Имэйл</label>
                  <input
                    type="email"
                    required
                    autoFocus
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="example@mail.com"
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-[14px] focus:border-blue-500 focus:bg-white outline-none transition-colors"
                  />
                </div>

                <button type="submit" disabled={busy || !email.trim()}
                  className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-xl py-3 text-[14px] font-semibold cursor-pointer border-none transition-colors font-sans flex items-center justify-center gap-2">
                  {busy && <Loader2 size={14} className="animate-spin" />}
                  {busy ? "Илгээж байна..." : "Сэргээх линк илгээх"}
                </button>
              </form>

              <div className="mt-4 pt-4 border-t border-gray-100 text-center text-[13px] text-gray-500">
                Нууц үгээ санасан уу?{" "}
                <Link href="/auth/login" className="text-blue-600 font-semibold"
                 >
                  Нэвтрэх
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SuccessPanel({ email }: { email: string }) {
  return (
    <div className="text-center py-2">
      <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto mb-3">
        <CheckCircle size={22} />
      </div>
      <h1 className="text-[18px] font-semibold text-gray-900 mb-1.5">Имэйлээ шалгана уу</h1>
      <p className="text-[13px] text-gray-500 leading-relaxed">
        Хэрэв <strong className="text-gray-700">{email}</strong> хаягаар бүртгэлтэй бол сэргээх линк дөнгөж саяхан явсан.
      </p>
      <p className="text-[11px] text-gray-400 mt-3 leading-relaxed">
        • Inbox-аас өгсөнгүй бол spam folder-аа шалгана уу<br />
        • Линк <strong>30 минут</strong> хүчинтэй<br />
        • Хүсэлт хүлээж аваагүй бол дахин оролдоно уу
      </p>
      <Link href="/auth/login"
        className="inline-block mt-5 text-[13px] text-blue-600 font-semibold"
       >
        ← Нэвтрэх рүү буцах
      </Link>
    </div>
  );
}
