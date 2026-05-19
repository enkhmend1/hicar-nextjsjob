"use client";
import { useEffect, useState } from "react";
import Image from "next/image";
import { api } from "@/lib/api";
import { User } from "@/app/types";
import { Check, X, Store, Clock, CheckCircle2, XCircle } from "lucide-react";

const STATUS_FILTER = [
  { id: "all", label: "Бүгд" },
  { id: "pending", label: "Хүлээгдэж буй" },
  { id: "approved", label: "Зөвшөөрсөн" },
  { id: "rejected", label: "Татгалзсан" },
];

const STATUS_BADGE: Record<string, { color: string; icon: typeof Clock; label: string }> = {
  pending: { color: "bg-amber-50 text-amber-700 border-amber-200", icon: Clock, label: "Хүлээгдэж буй" },
  approved: { color: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: CheckCircle2, label: "Зөвшөөрсөн" },
  rejected: { color: "bg-red-50 text-red-700 border-red-200", icon: XCircle, label: "Татгалзсан" },
};

export default function AdminSellersPage() {
  const [sellers, setSellers] = useState<User[]>([]);
  const [filter, setFilter] = useState("pending");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = () => {
    setLoading(true);
    api.get<{ sellers: User[] }>(`/users/sellers?status=${filter}`)
      .then(d => setSellers(d.sellers))
      .finally(() => setLoading(false));
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [filter]);

  const approve = async (u: User) => {
    const cr = prompt("Хураамж % (0-50)?", String(u.sellerProfile?.commissionRate ?? 10));
    if (cr === null) return;
    setBusy(u._id ?? null);
    try {
      await api.patch(`/users/${u._id ?? u.id}/seller`, { action: "approve", commissionRate: Number(cr) });
      reload();
    } catch (e) { alert((e as Error).message); }
    finally { setBusy(null); }
  };

  const reject = async (u: User) => {
    const reason = prompt(`${u.name}-ийн хүсэлтийг татгалзах шалтгаан:`);
    if (reason === null) return;
    setBusy(u._id ?? null);
    try {
      await api.patch(`/users/${u._id ?? u.id}/seller`, { action: "reject", reason });
      reload();
    } catch (e) { alert((e as Error).message); }
    finally { setBusy(null); }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[22px] font-semibold text-gray-900">Seller-үүд</h1>
        <p className="text-[13px] text-gray-500">{sellers.length} seller</p>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {STATUS_FILTER.map(s => (
          <button key={s.id} onClick={() => setFilter(s.id)}
            className={`shrink-0 px-3 py-1.5 rounded-full text-[12px] font-medium cursor-pointer border transition-all font-sans ${
              filter === s.id ? "bg-violet-600 text-white border-violet-600" : "bg-white text-gray-600 border-gray-200 hover:border-violet-400"
            }`}>
            {s.label}
          </button>
        ))}
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-400 text-[13px]">Уншиж байна...</div>
        ) : sellers.length === 0 ? (
          <div className="p-12 text-center">
            <Store size={32} className="mx-auto text-gray-300 mb-2" />
            <p className="text-[13px] text-gray-400">Seller байхгүй</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {sellers.map(s => {
              const st = STATUS_BADGE[s.sellerStatus ?? "pending"] ?? STATUS_BADGE.pending;
              const StIcon = st.icon;
              const id = s._id ?? s.id;
              return (
                <div key={id} className="p-4 flex flex-wrap items-start gap-3">
                  <div className="relative w-12 h-12 rounded-2xl bg-fuchsia-50 overflow-hidden flex items-center justify-center shrink-0">
                    {s.sellerProfile?.logo
                      ? <Image src={s.sellerProfile.logo} alt="" fill sizes="48px" className="object-cover" unoptimized />
                      : <Store size={20} className="text-fuchsia-400" />
                    }
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[14px] font-semibold text-gray-900 truncate">{s.sellerProfile?.shopName || "(нэр оруулаагүй)"}</span>
                      <span className={`inline-flex items-center gap-1 text-[10px] font-medium border px-2 py-0.5 rounded-full ${st.color}`}>
                        <StIcon size={10} /> {st.label}
                      </span>
                    </div>
                    <div className="text-[12px] text-gray-500 mt-0.5 truncate">
                      {s.name} · {s.email} · {s.phone || "—"}
                    </div>
                    {s.sellerProfile?.description && (
                      <p className="text-[12px] text-gray-600 mt-1 line-clamp-2">{s.sellerProfile.description}</p>
                    )}
                    <div className="flex flex-wrap gap-3 mt-1 text-[11px] text-gray-400">
                      {s.sellerProfile?.appliedAt && <span>📅 {new Date(s.sellerProfile.appliedAt).toLocaleDateString("mn-MN")}</span>}
                      {s.sellerProfile?.commissionRate !== undefined && <span>💸 {s.sellerProfile.commissionRate}%</span>}
                      {s.sellerProfile?.bankAccount && <span className="font-mono">🏦 {s.sellerProfile.bankAccount}</span>}
                    </div>
                    {s.sellerStatus === "rejected" && s.sellerProfile?.rejectedReason && (
                      <div className="text-[11px] text-red-500 mt-1">Шалтгаан: {s.sellerProfile.rejectedReason}</div>
                    )}
                  </div>
                  {s.sellerStatus === "pending" && (
                    <div className="flex gap-1.5 shrink-0">
                      <button onClick={() => approve(s)} disabled={busy === id}
                        className="flex items-center gap-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg px-3 py-1.5 text-[12px] font-semibold cursor-pointer border-none transition-colors disabled:opacity-50 font-sans">
                        <Check size={12} /> Зөвшөөрөх
                      </button>
                      <button onClick={() => reject(s)} disabled={busy === id}
                        className="flex items-center gap-1 border border-red-200 text-red-600 hover:bg-red-50 rounded-lg px-3 py-1.5 text-[12px] font-semibold cursor-pointer bg-white transition-colors disabled:opacity-50 font-sans">
                        <X size={12} /> Татгалзах
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
