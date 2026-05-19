"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuthStore } from "@/store";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { User } from "@/app/types";
import { ArrowLeft, CheckCircle } from "lucide-react";

export default function RegisterPage() {
  const [f, setF] = useState({ name: "", email: "", phone: "", pass: "", pass2: "" });
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const { setSession } = useAuthStore();
  const router = useRouter();
  const t = useT();
  const upd = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF(p => ({ ...p, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(""); setLoading(true);
    if (f.pass !== f.pass2) { setErr(t("auth.passwordMismatch")); setLoading(false); return; }
    if (f.pass.length < 6) { setErr(t("auth.passwordTooShort")); setLoading(false); return; }
    try {
      const { user, token } = await api.post<{ user: User; token: string }>("/auth/register", {
        name: f.name, email: f.email, password: f.pass, phone: f.phone,
      });
      setSession(user, token);
      router.push("/");
    } catch (e) {
      setErr((e as Error).message || "Алдаа гарлаа");
    } finally {
      setLoading(false);
    }
  };

  const fields = [
    { k: "name", label: t("auth.name"), type: "text", ph: "Болд Баатар" },
    { k: "email", label: t("auth.email"), type: "email", ph: "example@mail.com" },
    { k: "phone", label: t("auth.phone"), type: "tel", ph: "9900 1122" },
    { k: "pass", label: t("auth.password"), type: "password", ph: "••••••••" },
    { k: "pass2", label: t("auth.passwordRepeat"), type: "password", ph: "••••••••" },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-violet-50 to-white flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-[380px]">
        <Link href="/" className="flex items-center gap-1.5 text-[13px] text-gray-500 hover:text-violet-600 mb-6 transition-colors" style={{ textDecoration: "none" }}>
          <ArrowLeft size={14} /> {t("auth.backHome")}
        </Link>
        <div className="text-center mb-7">
          <span className="text-[26px] font-semibold"><em className="text-violet-600 not-italic">Hi</em>car</span>
          <h1 className="text-[20px] font-semibold text-gray-900 mt-4 mb-1">{t("auth.registerTitle")}</h1>
          <p className="text-[13px] text-gray-500">{t("auth.registerSubtitle")}</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-xl shadow-gray-100">
          {err && <div className="bg-red-50 border border-red-200 text-red-600 text-[13px] rounded-xl px-3.5 py-2.5 mb-4">⚠️ {err}</div>}
          <form onSubmit={submit} className="space-y-3.5">
            {fields.map(({ k, label, type, ph }) => (
              <div key={k}>
                <label className="block text-[13px] font-medium text-gray-700 mb-1">{label}</label>
                <input type={type} value={f[k as keyof typeof f]} onChange={upd(k as keyof typeof f)} required
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-[14px] focus:border-violet-500 focus:bg-white transition-colors"
                  placeholder={ph} />
              </div>
            ))}
            <button type="submit" disabled={loading}
              className="w-full bg-violet-600 hover:bg-violet-700 disabled:bg-violet-300 text-white rounded-xl py-3 text-[14px] font-semibold transition-colors cursor-pointer font-sans">
              {loading ? t("auth.registering") : t("auth.registerTitle")}
            </button>
          </form>
          <div className="mt-4 pt-4 border-t border-gray-100">
            {["OEM баталгаатай сэлбэг", "Japan нийлүүлэгчтэй шууд", "QPay, Wallet төлбөр"].map(t => (
              <div key={t} className="flex items-center gap-2 text-[12px] text-gray-400 py-0.5">
                <CheckCircle size={11} className="text-emerald-400" />{t}
              </div>
            ))}
          </div>
          <div className="mt-3 text-center text-[13px] text-gray-500">
            {t("auth.haveAccount")}{" "}
            <Link href="/auth/login" className="text-violet-600 font-semibold" style={{ textDecoration: "none" }}>{t("auth.loginTitle")}</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
