"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuthStore } from "@/store";
import { ArrowLeft, CheckCircle } from "lucide-react";

export default function RegisterPage() {
  const [f, setF] = useState({ name: "", email: "", phone: "", pass: "", pass2: "" });
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const { login } = useAuthStore();
  const router = useRouter();
  const upd = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF(p => ({ ...p, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(""); setLoading(true);
    await new Promise(r => setTimeout(r, 800));
    if (f.pass !== f.pass2) { setErr("Нууц үг таарахгүй байна."); setLoading(false); return; }
    if (f.pass.length < 6) { setErr("Нууц үг хамгийн багадаа 6 тэмдэгт."); setLoading(false); return; }
    login({ id: "u" + Date.now(), name: f.name, email: f.email, phone: f.phone, walletBalance: 0 });
    router.push("/");
  };

  const fields = [
    { k: "name", label: "Нэр", type: "text", ph: "Болд Баатар" },
    { k: "email", label: "Имэйл", type: "email", ph: "example@mail.com" },
    { k: "phone", label: "Утасны дугаар", type: "tel", ph: "9900 1122" },
    { k: "pass", label: "Нууц үг", type: "password", ph: "••••••••" },
    { k: "pass2", label: "Нууц үг давтах", type: "password", ph: "••••••••" },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-violet-50 to-white flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-[380px]">
        <Link href="/" className="flex items-center gap-1.5 text-[13px] text-gray-500 hover:text-violet-600 mb-6 transition-colors" style={{ textDecoration: "none" }}>
          <ArrowLeft size={14} /> Нүүр хуудас
        </Link>
        <div className="text-center mb-7">
          <span className="text-[26px] font-semibold"><em className="text-violet-600 not-italic">Hi</em>car</span>
          <h1 className="text-[20px] font-semibold text-gray-900 mt-4 mb-1">Бүртгүүлэх</h1>
          <p className="text-[13px] text-gray-500">Шинэ бүртгэл үүсгэх</p>
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
              {loading ? "Бүртгэж байна..." : "Бүртгүүлэх"}
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
            Бүртгэлтэй юу?{" "}
            <Link href="/auth/login" className="text-violet-600 font-semibold" style={{ textDecoration: "none" }}>Нэвтрэх</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
