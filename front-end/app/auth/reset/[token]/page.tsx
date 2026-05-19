"use client";
import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import {
  ArrowLeft, Lock, Eye, EyeOff, CheckCircle, Loader2, AlertTriangle, KeyRound,
} from "lucide-react";

/**
 * /auth/reset/[token] — single-use password reset redemption page.
 *
 * Flow:
 *   1. On mount → GET /auth/reset-password/check/:token
 *        • 200 → show "Set new password" form
 *        • 410 → show targeted error (used / expired / invalid)
 *   2. User submits new password → POST /auth/reset-password
 *        • 200 → success screen with "Login now" CTA
 *        • 410 → token became invalid between steps → show error
 *
 * The masked email returned by /check is shown so the user can sanity-check
 * they're resetting the right account (e.g. shared family device).
 */
interface CheckResp {
  ok: boolean;
  maskedEmail: string;
  expiresAt: string;
}

const MIN_LENGTH = 6;

export default function ResetPasswordPage({
  params,
}: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const router = useRouter();

  const [status, setStatus] = useState<"checking" | "valid" | "invalid">("checking");
  const [maskedEmail, setMaskedEmail] = useState("");
  const [errorCode, setErrorCode] = useState<string>("");

  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);

  // ── Step 1: verify token on mount ──────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api.get<CheckResp>(`/auth/reset-password/check/${encodeURIComponent(token)}`);
        if (cancelled) return;
        setMaskedEmail(r.maskedEmail);
        setStatus("valid");
      } catch (e) {
        if (cancelled) return;
        const ae = e as ApiError;
        setErrorCode((ae.data?.code as string) || "TOKEN_INVALID");
        setStatus("invalid");
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  // ── Step 2: submit new password ─────────────────────────────────────
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    if (pw.length < MIN_LENGTH) { setErr(`Нууц үг хамгийн багадаа ${MIN_LENGTH} тэмдэгт`); return; }
    if (pw !== pw2)             { setErr("Нууц үг таарахгүй байна"); return; }

    setBusy(true);
    try {
      await api.post("/auth/reset-password", { token, password: pw });
      setDone(true);
    } catch (e) {
      const ae = e as ApiError;
      if (ae.status === 410) {
        // Token aged out between check and submit
        setStatus("invalid");
        setErrorCode((ae.data?.code as string) || "TOKEN_INVALID");
      } else {
        setErr(ae.message || "Алдаа гарлаа");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-violet-50 to-white flex items-center justify-center px-4">
      <div className="w-full max-w-[380px]">
        <Link href="/auth/login"
          className="flex items-center gap-1.5 text-[13px] text-gray-500 hover:text-violet-600 mb-6 transition-colors"
          style={{ textDecoration: "none" }}>
          <ArrowLeft size={14} /> Нэвтрэх
        </Link>

        <div className="text-center mb-6">
          <span className="text-[26px] font-semibold">
            <em className="text-violet-600 not-italic">Hi</em>car
          </span>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-xl shadow-gray-100">
          {status === "checking" && (
            <div className="text-center py-6">
              <Loader2 className="inline animate-spin text-violet-500" size={20} />
              <p className="text-[13px] text-gray-500 mt-3">Token шалгаж байна...</p>
            </div>
          )}

          {status === "invalid" && <InvalidTokenPanel code={errorCode} />}

          {status === "valid" && !done && (
            <>
              <div className="w-11 h-11 bg-violet-50 text-violet-600 rounded-2xl flex items-center justify-center mb-3">
                <KeyRound size={20} />
              </div>
              <h1 className="text-[20px] font-semibold text-gray-900 mb-1">Шинэ нууц үг</h1>
              <p className="text-[13px] text-gray-500 mb-5">
                <span className="font-mono text-gray-700">{maskedEmail}</span> акаунтын нууц үгийг шинэчилнэ үү.
              </p>

              {err && (
                <div className="bg-red-50 border border-red-200 text-red-600 text-[12px] rounded-xl px-3 py-2 mb-3">
                  ⚠ {err}
                </div>
              )}

              <form onSubmit={submit} className="space-y-3">
                <PasswordField label="Шинэ нууц үг" value={pw} onChange={setPw}
                  show={show} onToggleShow={() => setShow(!show)} autoFocus />
                <PasswordField label="Дахин оруулна уу" value={pw2} onChange={setPw2} show={show} />

                <div className="text-[10px] text-gray-400 flex items-center gap-1.5">
                  <Lock size={10} /> Багадаа {MIN_LENGTH} тэмдэгт. Үсэг, тоо хослуулаарай.
                </div>

                <button type="submit" disabled={busy || !pw || !pw2}
                  className="w-full bg-violet-600 hover:bg-violet-700 disabled:bg-violet-300 text-white rounded-xl py-3 text-[14px] font-semibold cursor-pointer border-none transition-colors font-sans flex items-center justify-center gap-2">
                  {busy && <Loader2 size={14} className="animate-spin" />}
                  {busy ? "Шинэчилж байна..." : "Нууц үг шинэчлэх"}
                </button>
              </form>
            </>
          )}

          {done && <DonePanel onLogin={() => router.push("/auth/login")} />}
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────
function PasswordField({
  label, value, onChange, show, onToggleShow, autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  onToggleShow?: () => void;
  autoFocus?: boolean;
}) {
  return (
    <div>
      <label className="block text-[13px] font-medium text-gray-700 mb-1.5">{label}</label>
      <div className="relative">
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoFocus={autoFocus}
          required
          className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-[14px] focus:border-violet-500 focus:bg-white outline-none transition-colors pr-11"
          placeholder="••••••••"
        />
        {onToggleShow && (
          <button type="button" onClick={onToggleShow}
            className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 bg-transparent border-none cursor-pointer">
            {show ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        )}
      </div>
    </div>
  );
}

const INVALID_COPY: Record<string, { title: string; body: string }> = {
  TOKEN_INVALID: {
    title: "Линк буруу",
    body: "Энэ сэргээх линк хүчингүй байна. Та шинээр хүсэлт илгээнэ үү.",
  },
  TOKEN_EXPIRED: {
    title: "Линкийн хугацаа дууссан",
    body: "Линк 30 минутын дотор хүчинтэй. Шинээр хүсэлт илгээнэ үү.",
  },
  TOKEN_USED: {
    title: "Линк аль хэдийн ашиглагдсан",
    body: "Нууц үг сэргээх линкийг зөвхөн нэг л удаа ашиглаж болно. Шинэ хүсэлт илгээнэ үү.",
  },
};

function InvalidTokenPanel({ code }: { code: string }) {
  const copy = INVALID_COPY[code] ?? INVALID_COPY.TOKEN_INVALID;
  return (
    <div className="text-center py-2">
      <div className="w-12 h-12 bg-red-50 text-red-500 rounded-2xl flex items-center justify-center mx-auto mb-3">
        <AlertTriangle size={22} />
      </div>
      <h1 className="text-[18px] font-semibold text-gray-900 mb-1.5">{copy.title}</h1>
      <p className="text-[13px] text-gray-500 leading-relaxed">{copy.body}</p>
      <Link href="/auth/forgot"
        className="inline-block mt-5 bg-violet-600 hover:bg-violet-700 text-white rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-colors"
        style={{ textDecoration: "none" }}>
        Шинэ линк авах
      </Link>
    </div>
  );
}

function DonePanel({ onLogin }: { onLogin: () => void }) {
  return (
    <div className="text-center py-2">
      <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto mb-3">
        <CheckCircle size={22} />
      </div>
      <h1 className="text-[18px] font-semibold text-gray-900 mb-1.5">Шинэчлэгдлээ ✓</h1>
      <p className="text-[13px] text-gray-500 leading-relaxed">
        Таны нууц үг амжилттай шинэчлэгдлээ. Шинэ нууц үгээрээ нэвтэрнэ үү.
      </p>
      <button onClick={onLogin}
        className="mt-5 w-full bg-violet-600 hover:bg-violet-700 text-white rounded-xl py-2.5 text-[13px] font-semibold cursor-pointer border-none transition-colors font-sans">
        Нэвтрэх
      </button>
    </div>
  );
}
