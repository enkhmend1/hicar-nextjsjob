"use client";
import { useEffect, useState } from "react";
import Image from "next/image";
import { api } from "@/lib/api";
import { User } from "@/app/types";
import {
  Check, X, Store, Clock, CheckCircle2, XCircle, Pencil, Banknote, Save, AlertTriangle,
} from "lucide-react";

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

/**
 * Per-seller economics editor. Wired to PATCH /api/users/:id/economics, which
 * persists `sellerProfile.platformFeePercent` + bank info. Snapshots taken at
 * order-payment time use whatever values exist HERE at that moment — so
 * editing an approved seller's commission only affects future orders, never
 * in-flight escrowed ones. (See escrow.service.js for the freeze logic.)
 */
function EconomicsModal({
  seller, onClose, onSaved,
}: { seller: User; onClose: () => void; onSaved: () => void }) {
  const sp = seller.sellerProfile ?? {};
  const [fee, setFee]   = useState(String(sp.platformFeePercent ?? 5));
  const [bank, setBank] = useState(sp.bankName ?? "");
  const [acct, setAcct] = useState(sp.bankAccount ?? "");
  const [hold, setHold] = useState(sp.bankHolderName ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState("");

  const save = async () => {
    const n = Number(fee);
    if (!Number.isFinite(n) || n < 0 || n > 50) {
      setErr("Хураамж 0-50 хооронд байх ёстой");
      return;
    }
    setBusy(true); setErr("");
    try {
      await api.patch(`/users/${seller._id ?? seller.id}/economics`, {
        platformFeePercent: n,
        bankName:       bank.trim(),
        bankAccount:    acct.trim(),
        bankHolderName: hold.trim(),
      });
      onSaved();
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <header className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-gray-900 flex items-center gap-2">
            <Banknote size={15} className="text-emerald-600" /> Эдийн засаг — {sp.shopName || seller.name}
          </h2>
          <button onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 cursor-pointer bg-transparent border-none">
            <X size={15} />
          </button>
        </header>

        <div className="p-5 space-y-3">
          <div>
            <label className="block text-[12px] font-medium text-gray-700 mb-1">
              Платформын хураамж (%)
            </label>
            <input
              value={fee}
              onChange={(e) => setFee(e.target.value)}
              type="number" min={0} max={50} step={0.5}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] focus:border-blue-500 outline-none"
            />
            <p className="text-[11px] text-gray-500 mt-1">
              0-50 хооронд. Захиалга төлөгдөх агшинд snapshot хийгдэх ба тэр захиалгад
              хожимын өөрчлөлт нөлөөлөхгүй.
            </p>
          </div>

          <div className="border-t border-gray-100 pt-3">
            <div className="text-[12px] font-medium text-gray-700 mb-1.5">
              Дансны мэдээлэл (escrow гаргалга)
            </div>
            <div className="space-y-2">
              <input
                value={bank}
                onChange={(e) => setBank(e.target.value)}
                placeholder='Банкны нэр (жнь "Хаан банк")'
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] focus:border-blue-500 outline-none"
              />
              <input
                value={acct}
                onChange={(e) => setAcct(e.target.value)}
                placeholder="Дансны дугаар"
                className="w-full font-mono border border-gray-200 rounded-lg px-3 py-2 text-[13px] focus:border-blue-500 outline-none"
              />
              <input
                value={hold}
                onChange={(e) => setHold(e.target.value)}
                placeholder="Данс эзэмшигчийн нэр"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] focus:border-blue-500 outline-none"
              />
            </div>
          </div>

          {err && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg p-2.5 text-[12px]">
              <AlertTriangle size={13} className="shrink-0 mt-0.5" />
              <span>{err}</span>
            </div>
          )}
        </div>

        <footer className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onClose}
            className="bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg px-4 py-2 text-[12px] font-semibold cursor-pointer border-none transition-colors font-sans">
            Болих
          </button>
          <button onClick={save} disabled={busy}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg px-4 py-2 text-[12px] font-semibold cursor-pointer border-none transition-colors font-sans inline-flex items-center gap-1.5">
            <Save size={12} /> {busy ? "Хадгалж байна..." : "Хадгалах"}
          </button>
        </footer>
      </div>
    </div>
  );
}

export default function AdminSellersPage() {
  const [sellers, setSellers] = useState<User[]>([]);
  const [filter, setFilter] = useState("pending");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<User | null>(null);

  const reload = () => {
    setLoading(true);
    api.get<{ sellers: User[] }>(`/users/sellers?status=${filter}`)
      .then(d => setSellers(d.sellers))
      .finally(() => setLoading(false));
  };

  // queueMicrotask defers reload()'s setLoading(true) past the effect
  // commit — React 19 warns on sync setState in effect bodies.
  useEffect(() => { queueMicrotask(reload); /* eslint-disable-next-line */ }, [filter]);

  // Approval flow now just toggles seller status — commission + bank info are
  // edited from the modal AFTER approval. Keeping the approve action simple
  // means admins can OK a seller in one click and tune the fee later.
  const approve = async (u: User) => {
    if (!confirm(`${u.sellerProfile?.shopName || u.name}-г seller болгох уу?`)) return;
    setBusy(u._id ?? null);
    try {
      await api.patch(`/users/${u._id ?? u.id}/seller`, { action: "approve" });
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
              filter === s.id ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 border-gray-200 hover:border-blue-400"
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
              const sp = s.sellerProfile ?? {};
              const id = s._id ?? s.id;
              return (
                <div key={id} className="p-4 flex flex-wrap items-start gap-3">
                  <div className="relative w-12 h-12 rounded-2xl bg-amber-50 overflow-hidden flex items-center justify-center shrink-0">
                    {sp.logo
                      ? <Image src={sp.logo} alt="" fill sizes="48px" className="object-cover" unoptimized />
                      : <Store size={20} className="text-amber-400" />
                    }
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[14px] font-semibold text-gray-900 truncate">{sp.shopName || "(нэр оруулаагүй)"}</span>
                      <span className={`inline-flex items-center gap-1 text-[10px] font-medium border px-2 py-0.5 rounded-full ${st.color}`}>
                        <StIcon size={10} /> {st.label}
                      </span>
                    </div>
                    <div className="text-[12px] text-gray-500 mt-0.5 truncate">
                      {s.name} · {s.email} · {s.phone || "—"}
                    </div>
                    {sp.description && (
                      <p className="text-[12px] text-gray-600 mt-1 line-clamp-2">{sp.description}</p>
                    )}
                    <div className="flex flex-wrap gap-3 mt-1 text-[11px] text-gray-400">
                      {sp.appliedAt && <span>📅 {new Date(sp.appliedAt).toLocaleDateString("mn-MN")}</span>}
                      {sp.platformFeePercent !== undefined && <span>💸 {sp.platformFeePercent}%</span>}
                      {sp.trustScore !== undefined && (
                        <span className={
                          sp.trustScore >= 70 ? "text-emerald-600"
                          : sp.trustScore <= 30 ? "text-rose-600"
                          : "text-amber-600"
                        }>🛡️ Trust {Math.round(sp.trustScore)}/100</span>
                      )}
                      {sp.bankName && sp.bankAccount && (
                        <span className="font-mono">🏦 {sp.bankName} · {sp.bankAccount}</span>
                      )}
                      {sp.bankHolderName && <span>👤 {sp.bankHolderName}</span>}
                    </div>
                    {s.sellerStatus === "rejected" && sp.rejectedReason && (
                      <div className="text-[11px] text-red-500 mt-1">Шалтгаан: {sp.rejectedReason}</div>
                    )}
                  </div>

                  <div className="flex gap-1.5 shrink-0">
                    {s.sellerStatus === "pending" && (
                      <>
                        <button onClick={() => approve(s)} disabled={busy === id}
                          className="flex items-center gap-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg px-3 py-1.5 text-[12px] font-semibold cursor-pointer border-none transition-colors disabled:opacity-50 font-sans">
                          <Check size={12} /> Зөвшөөрөх
                        </button>
                        <button onClick={() => reject(s)} disabled={busy === id}
                          className="flex items-center gap-1 border border-red-200 text-red-600 hover:bg-red-50 rounded-lg px-3 py-1.5 text-[12px] font-semibold cursor-pointer bg-white transition-colors disabled:opacity-50 font-sans">
                          <X size={12} /> Татгалзах
                        </button>
                      </>
                    )}
                    {(s.sellerStatus === "approved" || s.sellerStatus === "pending") && (
                      <button onClick={() => setEditing(s)}
                        className="flex items-center gap-1 border border-blue-200 text-blue-700 hover:bg-blue-50 rounded-lg px-3 py-1.5 text-[12px] font-semibold cursor-pointer bg-white transition-colors font-sans">
                        <Pencil size={12} /> Хураамж/Данс
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {editing && (
        <EconomicsModal
          seller={editing}
          onClose={() => setEditing(null)}
          onSaved={reload}
        />
      )}
    </div>
  );
}
