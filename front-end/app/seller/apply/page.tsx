"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuthStore } from "@/store";
import { api } from "@/lib/api";
import { User } from "@/app/types";
import { ArrowLeft, Store, CheckCircle, Clock, AlertCircle } from "lucide-react";

export default function SellerApplyPage() {
  const router = useRouter();
  const { user, setUser, _hasHydrated } = useAuthStore();
  const [form, setForm] = useState({ shopName: "", description: "", bankAccount: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!_hasHydrated) return;
    if (!user) router.replace("/auth/login");
  }, [user, _hasHydrated, router]);

  // Pre-fill form from existing sellerProfile snapshot on auth hydrate.
  useEffect(() => {
    if (user?.sellerProfile) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setForm({
        shopName: user.sellerProfile.shopName ?? "",
        description: user.sellerProfile.description ?? "",
        bankAccount: user.sellerProfile.bankAccount ?? "",
      });
    }
  }, [user]);

  if (!_hasHydrated || !user) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(""); setBusy(true);
    try {
      const { user: updated } = await api.post<{ user: User }>("/seller/apply", form);
      setUser(updated);
      if (updated.sellerStatus === "approved") router.push("/seller");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const status = user.sellerStatus;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-amber-50 flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-md">
        <Link href="/" className="flex items-center gap-1.5 text-[13px] text-gray-500 hover:text-blue-600 mb-6 transition-colors">
          <ArrowLeft size={14} /> Нүүр хуудас
        </Link>

        <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-xl shadow-gray-100">
          <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-amber-500 rounded-2xl flex items-center justify-center mb-3">
            <Store size={20} className="text-white" />
          </div>
          <h1 className="text-[20px] font-semibold text-gray-900 mb-1">Seller болох</h1>
          <p className="text-[13px] text-gray-500 mb-5">HiCar дээр өөрийн дэлгүүрээ нээгээд автомашины сэлбэг зар.</p>

          {status === "pending" && (
            <div className="bg-amber-50 border border-amber-200 text-amber-800 text-[12px] rounded-xl p-3 mb-4 flex items-start gap-2">
              <Clock size={14} className="shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold">Хүсэлт хянагдаж байна</div>
                <div>Admin таны хүсэлтийг шалгах хүртэл түр хүлээнэ үү.</div>
              </div>
            </div>
          )}

          {status === "approved" && (
            <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-[12px] rounded-xl p-3 mb-4 flex items-start gap-2">
              <CheckCircle size={14} className="shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold">Та seller боллоо!</div>
                <Link href="/seller" className="underline" style={{ textDecoration: "underline" }}>Самбар руу очих →</Link>
              </div>
            </div>
          )}

          {status === "rejected" && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-[12px] rounded-xl p-3 mb-4 flex items-start gap-2">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold">Хүсэлт татгалзагдсан</div>
                {user.sellerProfile?.rejectedReason && <div>Шалтгаан: {user.sellerProfile.rejectedReason}</div>}
                <div className="mt-1">Мэдээллээ шинэчлээд дахин илгээнэ үү.</div>
              </div>
            </div>
          )}

          {err && <div className="bg-red-50 border border-red-200 text-red-600 text-[12px] rounded-xl px-3 py-2 mb-3">{err}</div>}

          <form onSubmit={submit} className="space-y-3">
            <div>
              <label className="block text-[12px] font-medium text-gray-700 mb-1">Дэлгүүрийн нэр *</label>
              <input required value={form.shopName} onChange={e => setForm(f => ({ ...f, shopName: e.target.value }))}
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-[14px] focus:border-blue-500 focus:bg-white transition-colors"
                placeholder="HiAuto Parts" />
            </div>
            <div>
              <label className="block text-[12px] font-medium text-gray-700 mb-1">Танилцуулга</label>
              <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-[13px] focus:border-blue-500 focus:bg-white transition-colors resize-none h-20 font-sans"
                placeholder="Япон, Солонгосын OEM сэлбэгийн нийлүүлэгч..." />
            </div>
            <div>
              <label className="block text-[12px] font-medium text-gray-700 mb-1">Дансны мэдээлэл</label>
              <input value={form.bankAccount} onChange={e => setForm(f => ({ ...f, bankAccount: e.target.value }))}
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-[13px] focus:border-blue-500 focus:bg-white transition-colors font-mono"
                placeholder="Хаан банк — 5001 1234 5678" />
            </div>

            <button type="submit" disabled={busy || status === "approved"}
              className="w-full bg-gradient-to-r from-blue-600 to-amber-600 hover:from-blue-700 hover:to-amber-700 disabled:from-gray-300 disabled:to-gray-400 text-white rounded-xl py-3 text-[14px] font-semibold transition-all cursor-pointer border-none font-sans shadow-lg shadow-blue-200">
              {busy ? "Илгээж байна..." : status === "pending" ? "Дахин илгээх" : status === "approved" ? "Аль хэдийн зөвшөөрөгдсөн" : "Хүсэлт илгээх"}
            </button>
          </form>

          <div className="mt-4 pt-4 border-t border-gray-100 text-[11px] text-gray-400 space-y-1">
            <div>• Admin таны хүсэлтийг 24 цагт шалгана</div>
            <div>• Хураамж: борлуулалтын 10% (тохиролцоогоор өөрчилж болно)</div>
            <div>• Барааг admin зөвшөөрсний дараа танай дэлгүүрт харагдана</div>
          </div>
        </div>
      </div>
    </div>
  );
}
