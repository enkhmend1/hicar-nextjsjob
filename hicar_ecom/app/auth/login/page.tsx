"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuthStore } from "@/store";
import { Eye, EyeOff, ArrowLeft, CheckCircle } from "lucide-react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [show, setShow] = useState(false);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const { login } = useAuthStore();
  const router = useRouter();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(""); setLoading(true);
    await new Promise(r => setTimeout(r, 700));
    if (email && pass.length >= 6) {
      login({ id: "u1", name: "Болд Баатар", email, phone: "99001122", walletBalance: 150000 });
      router.push("/");
    } else {
      setErr("Имэйл эсвэл нууц үг буруу байна.");
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-violet-50 to-white flex items-center justify-center px-4">
      <div className="w-full max-w-[380px]">
        <Link href="/" className="flex items-center gap-1.5 text-[13px] text-gray-500 hover:text-violet-600 mb-6 transition-colors" style={{ textDecoration: "none" }}>
          <ArrowLeft size={14} /> Нүүр хуудас
        </Link>
        <div className="text-center mb-7">
          <span className="text-[26px] font-semibold"><em className="text-violet-600 not-italic">Hi</em>car</span>
          <h1 className="text-[20px] font-semibold text-gray-900 mt-4 mb-1">Нэвтрэх</h1>
          <p className="text-[13px] text-gray-500">Тавтай морил!</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-xl shadow-gray-100">
          {err && (
            <div className="bg-red-50 border border-red-200 text-red-600 text-[13px] rounded-xl px-3.5 py-2.5 mb-4">⚠️ {err}</div>
          )}
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="block text-[13px] font-medium text-gray-700 mb-1.5">Имэйл</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-[14px] focus:border-violet-500 focus:bg-white transition-colors"
                placeholder="example@mail.com" />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-gray-700 mb-1.5">Нууц үг</label>
              <div className="relative">
                <input type={show ? "text" : "password"} value={pass} onChange={e => setPass(e.target.value)} required
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-[14px] focus:border-violet-500 focus:bg-white transition-colors pr-11"
                  placeholder="••••••••" />
                <button type="button" onClick={() => setShow(!show)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 bg-transparent border-none cursor-pointer">
                  {show ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            <button type="submit" disabled={loading}
              className="w-full bg-violet-600 hover:bg-violet-700 disabled:bg-violet-300 text-white rounded-xl py-3 text-[14px] font-semibold transition-colors cursor-pointer font-sans">
              {loading ? "Нэвтэрч байна..." : "Нэвтрэх"}
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
            Бүртгэл байхгүй юу?{" "}
            <Link href="/auth/register" className="text-violet-600 font-semibold" style={{ textDecoration: "none" }}>Бүртгүүлэх</Link>
          </div>
        </div>
        <p className="text-center text-[11px] text-gray-400 mt-4">Туршилтын данс: any@email.com / 123456</p>
      </div>
    </div>
  );
}
