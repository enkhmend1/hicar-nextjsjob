"use client";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useAuthStore } from "@/store";
import { api } from "@/lib/api";
import { User } from "@/app/types";
import { Save, ImagePlus, Loader2, Bell, Package } from "lucide-react";

export default function SellerProfilePage() {
  const { user, setUser } = useAuthStore();
  const [tab, setTab] = useState<"shop" | "inventory">("shop");
  const [shopForm, setShopForm] = useState({ shopName: "", description: "", bankAccount: "", logo: "" });
  const [invForm, setInvForm] = useState({ defaultLowStockThreshold: 5, emailAlertsEnabled: true });
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!user?.sellerProfile) return;
    const sp = user.sellerProfile;
    setShopForm({
      shopName: sp.shopName ?? "",
      description: sp.description ?? "",
      bankAccount: sp.bankAccount ?? "",
      logo: sp.logo ?? "",
    });
    setInvForm({
      defaultLowStockThreshold: sp.defaultLowStockThreshold ?? 5,
      emailAlertsEnabled: sp.emailAlertsEnabled !== false,
    });
  }, [user]);

  const persist = async (endpoint: string, body: unknown) => {
    setBusy(true); setErr(""); setMsg("");
    try {
      const { user: updated } = await api.patch<{ user: User }>(endpoint, body);
      setUser(updated);
      setMsg("Хадгалагдлаа ✓");
      setTimeout(() => setMsg(""), 2200);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveShop = (e: React.FormEvent) => { e.preventDefault(); persist("/seller/profile", shopForm); };
  const saveInventory = (e: React.FormEvent) => {
    e.preventDefault();
    persist("/seller/settings", {
      defaultLowStockThreshold: Number(invForm.defaultLowStockThreshold),
      emailAlertsEnabled: invForm.emailAlertsEnabled,
    });
  };

  const handleLogoUpload = async (f: File | null) => {
    if (!f) return;
    setUploading(true); setErr("");
    try {
      const { url } = await api.uploadImage(f);
      setShopForm((p) => ({ ...p, logo: url }));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  if (!user) return null;

  return (
    <div className="max-w-xl">
      <header className="mb-5">
        <h1 className="text-[22px] font-semibold text-gray-900">Профайл ба тохиргоо</h1>
        <p className="text-[13px] text-gray-500">Дэлгүүрийн мэдээлэл болон бараа материалын сэрэмжлүүлгийн тохиргоо</p>
      </header>

      <div className="flex gap-1 border-b border-gray-200 mb-4">
        {([
          { id: "shop", label: "Дэлгүүр", icon: ImagePlus },
          { id: "inventory", label: "Inventory тохиргоо", icon: Package },
        ] as const).map((t) => {
          const Icon = t.icon;
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-4 py-2 text-[13px] font-medium cursor-pointer bg-transparent border-none border-b-2 transition-colors font-sans ${
                tab === t.id ? "border-violet-600 text-violet-700" : "border-transparent text-gray-500 hover:text-gray-700"
              }`}>
              <Icon size={13} /> {t.label}
            </button>
          );
        })}
      </div>

      {msg && <div className="mb-3 bg-emerald-50 border border-emerald-200 text-emerald-700 text-[12px] rounded-xl px-3 py-2">{msg}</div>}
      {err && <div className="mb-3 bg-red-50 border border-red-200 text-red-600 text-[12px] rounded-xl px-3 py-2">{err}</div>}

      {tab === "shop" && (
        <div className="bg-white border border-gray-200 rounded-2xl p-5">
          <form onSubmit={saveShop} className="space-y-4">
            <div>
              <label className="block text-[12px] font-medium text-gray-700 mb-1.5">Лого</label>
              <div className="flex items-center gap-3">
                <div className="relative w-20 h-20 rounded-2xl overflow-hidden border border-gray-200 bg-gray-50 flex items-center justify-center">
                  {shopForm.logo
                    ? <Image src={shopForm.logo} alt="logo" fill sizes="80px" className="object-cover" unoptimized />
                    : <ImagePlus size={20} className="text-gray-300" />}
                </div>
                <div className="flex-1">
                  <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading}
                    className="text-[12px] border border-gray-200 rounded-lg px-3 py-1.5 hover:border-violet-400 text-gray-600 cursor-pointer bg-white transition-colors disabled:opacity-50 font-sans">
                    {uploading ? <Loader2 size={12} className="inline animate-spin" /> : "Зураг сонгох"}
                  </button>
                  <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={(e) => handleLogoUpload(e.target.files?.[0] || null)} />
                  <p className="text-[10px] text-gray-400 mt-1">200x200 PNG/JPG.</p>
                </div>
              </div>
            </div>

            <Field label="Дэлгүүрийн нэр">
              <input value={shopForm.shopName} onChange={(e) => setShopForm((f) => ({ ...f, shopName: e.target.value }))}
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-[14px] focus:border-violet-500 focus:bg-white outline-none transition-colors" />
            </Field>
            <Field label="Танилцуулга">
              <textarea value={shopForm.description} onChange={(e) => setShopForm((f) => ({ ...f, description: e.target.value }))}
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-[13px] focus:border-violet-500 focus:bg-white outline-none transition-colors resize-none h-20 font-sans" />
            </Field>
            <Field label="Дансны мэдээлэл">
              <input value={shopForm.bankAccount} onChange={(e) => setShopForm((f) => ({ ...f, bankAccount: e.target.value }))}
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-[13px] focus:border-violet-500 focus:bg-white outline-none transition-colors font-mono" />
            </Field>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t border-gray-100">
              <Stat label="Хураамж"  value={`${user.sellerProfile?.platformFeePercent ?? 5}%`} />
              <Stat
                label="Trust score"
                value={`${Math.round(user.sellerProfile?.trustScore ?? 50)}/100`}
              />
              <Stat label="Үнэлгээ"  value={user.sellerProfile?.rating ? `${user.sellerProfile.rating.toFixed(1)} (${user.sellerProfile.ratingCount ?? 0})` : "—"} />
              <Stat label="Нийт бор." value={`₮${(user.sellerProfile?.totalSales ?? 0).toLocaleString()}`} />
            </div>
            <p className="text-[11px] text-gray-400 leading-snug">
              Trust score нь escrow төлбөрийн хадгалалтын хугацааг тодорхойлно — өндөр оноо
              шуурхай төлбөр (3 хоног), бага оноо удаан хадгалалт (14 хоног). Бүрэн буцаалт
              −3, хэсэгчилсэн буцаалт −1.5, маргаан гарсан боловч таны талд шийдэгдвэл +0.5 / +1.5.
            </p>

            <button type="submit" disabled={busy}
              className="w-full bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-700 hover:to-fuchsia-700 disabled:from-gray-300 disabled:to-gray-400 text-white rounded-xl py-3 text-[14px] font-semibold cursor-pointer border-none transition-all flex items-center justify-center gap-2 font-sans">
              <Save size={14} /> {busy ? "Хадгалж байна..." : "Хадгалах"}
            </button>
          </form>
        </div>
      )}

      {tab === "inventory" && (
        <div className="bg-white border border-gray-200 rounded-2xl p-5">
          <form onSubmit={saveInventory} className="space-y-4">
            <Field
              label="Default low-stock threshold"
              hint="Энэ тоо болон түүнээс доош ширхэг үлдсэн үед сэрэмжлүүлэх. Бараа болгонд тусдаа threshold тавьж болно."
            >
              <input type="number" min={0} max={1000}
                value={invForm.defaultLowStockThreshold}
                onChange={(e) => setInvForm((f) => ({ ...f, defaultLowStockThreshold: Number(e.target.value) }))}
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-[14px] focus:border-violet-500 focus:bg-white outline-none transition-colors" />
            </Field>

            <label className="flex items-start gap-3 cursor-pointer bg-violet-50/40 border border-violet-100 rounded-xl p-3">
              <input type="checkbox"
                checked={invForm.emailAlertsEnabled}
                onChange={(e) => setInvForm((f) => ({ ...f, emailAlertsEnabled: e.target.checked }))}
                className="accent-violet-600 w-4 h-4 mt-0.5" />
              <div>
                <div className="text-[13px] font-medium text-gray-900 flex items-center gap-1.5">
                  <Bell size={12} className="text-violet-600" /> Email сэрэмжлүүлэг
                </div>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  Low-stock болон захиалгын статус өөрчлөгдөх үед {user.email}-руу мэйл явуулна.
                </p>
              </div>
            </label>

            <button type="submit" disabled={busy}
              className="w-full bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-700 hover:to-fuchsia-700 disabled:from-gray-300 disabled:to-gray-400 text-white rounded-xl py-3 text-[14px] font-semibold cursor-pointer border-none transition-all flex items-center justify-center gap-2 font-sans">
              <Save size={14} /> {busy ? "Хадгалж байна..." : "Хадгалах"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[12px] font-medium text-gray-700 mb-1">{label}</label>
      {children}
      {hint && <p className="text-[10px] text-gray-400 mt-1">{hint}</p>}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] text-gray-400">{label}</div>
      <div className="text-[15px] font-semibold text-gray-900">{value}</div>
    </div>
  );
}
