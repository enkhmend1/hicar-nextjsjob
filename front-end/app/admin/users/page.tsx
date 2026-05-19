"use client";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { User } from "@/app/types";
import { useAuthStore } from "@/store";
import {
  Shield, ShieldOff, Trash2, KeyRound, Copy, Check, AlertTriangle, X,
} from "lucide-react";

interface PasswordReset {
  user: { _id: string; name: string; email: string };
  tempPassword: string;
}

export default function AdminUsersPage() {
  const me = useAuthStore((s) => s.user);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [resetResult, setResetResult] = useState<PasswordReset | null>(null);
  const [copied, setCopied] = useState(false);

  const reload = () => {
    setLoading(true);
    api.get<{ users: User[] }>("/users")
      .then((d) => setUsers(d.users))
      .finally(() => setLoading(false));
  };

  useEffect(() => { reload(); }, []);

  const toggleRole = async (u: User) => {
    const nextRole = u.role === "admin" ? "user" : "admin";
    if (!confirm(`${u.name}-ийн эрхийг "${nextRole}" болгох уу?`)) return;
    await api.patch(`/users/${u._id ?? u.id}/role`, { role: nextRole });
    reload();
  };

  const remove = async (u: User) => {
    if (!confirm(`${u.name}-г устгах уу?`)) return;
    try {
      await api.delete(`/users/${u._id ?? u.id}`);
      reload();
    } catch (e) { alert((e as Error).message); }
  };

  const resetPassword = async (u: User) => {
    const id = u._id ?? u.id;
    if (!id) return;
    const confirmed = confirm(
      `${u.name}-ийн нууц үгийг шинэчлэх үү?\n\n` +
      `• Шинэ түр нууц үг үүснэ\n` +
      `• Зөвхөн 1 удаа харагдана — copy хийгээд хадгална уу\n` +
      `• Хэрэглэгчид мэдэгдэл явна`,
    );
    if (!confirmed) return;
    setBusyId(id);
    try {
      const r = await api.post<PasswordReset>(`/users/${id}/reset-password`, {});
      setResetResult(r);
      setCopied(false);
    } catch (e) {
      alert((e as ApiError).message);
    } finally {
      setBusyId(null);
    }
  };

  const copyPassword = async () => {
    if (!resetResult) return;
    try {
      await navigator.clipboard.writeText(resetResult.tempPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // clipboard may be blocked — user can still copy manually from the modal
    }
  };

  const filtered = q
    ? users.filter((u) => u.name.toLowerCase().includes(q.toLowerCase()) || u.email.toLowerCase().includes(q.toLowerCase()))
    : users;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[22px] font-semibold text-gray-900">Хэрэглэгч</h1>
        <p className="text-[13px] text-gray-500">{users.length} хэрэглэгч</p>
      </div>

      <input value={q} onChange={(e) => setQ(e.target.value)}
        className="w-full max-w-sm bg-white border border-gray-200 rounded-lg px-3 py-2 text-[13px] focus:border-violet-500 outline-none"
        placeholder="Нэр эсвэл имэйлээр хайх..." />

      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-gray-500 text-[12px]">
                <th className="text-left px-4 py-2.5 font-medium">Нэр</th>
                <th className="text-left px-4 py-2.5 font-medium">Имэйл</th>
                <th className="text-left px-4 py-2.5 font-medium">Утас</th>
                <th className="text-center px-4 py-2.5 font-medium">Эрх</th>
                <th className="text-right px-4 py-2.5 font-medium">Үйлдэл</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">Уншиж байна...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">Хэрэглэгч байхгүй</td></tr>
              ) : filtered.map((u) => {
                const id = u._id ?? u.id ?? "";
                const isMe = String(id) === String(me?._id ?? me?.id);
                const busy = busyId === id;
                return (
                  <tr key={id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                    <td className="px-4 py-2.5 font-medium text-gray-900">
                      {u.name}
                      {isMe && <span className="ml-1.5 text-[10px] bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded">Та</span>}
                    </td>
                    <td className="px-4 py-2.5 text-gray-500">{u.email}</td>
                    <td className="px-4 py-2.5 text-gray-500">{u.phone || "—"}</td>
                    <td className="px-4 py-2.5 text-center">
                      <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${
                        u.role === "admin"  ? "bg-violet-50 text-violet-700"
                        : u.role === "seller" ? "bg-fuchsia-50 text-fuchsia-700"
                        : "bg-gray-100 text-gray-600"
                      }`}>
                        {u.role === "admin" ? "Admin" : u.role === "seller" ? "Seller" : "User"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      <ActionBtn onClick={() => resetPassword(u)} title="Нууц үг шинэчлэх" color="amber" disabled={isMe || busy}>
                        <KeyRound size={13} />
                      </ActionBtn>
                      <ActionBtn onClick={() => toggleRole(u)} title="Эрх солих" color="violet" disabled={isMe}>
                        {u.role === "admin" ? <ShieldOff size={13} /> : <Shield size={13} />}
                      </ActionBtn>
                      <ActionBtn onClick={() => remove(u)} title="Устгах" color="red" disabled={isMe}>
                        <Trash2 size={13} />
                      </ActionBtn>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ───────── One-time password reveal modal ───────── */}
      {resetResult && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setResetResult(null)}>
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <header className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-[15px] font-semibold text-gray-900 flex items-center gap-2">
                <KeyRound size={15} className="text-amber-500" /> Шинэ түр нууц үг
              </h2>
              <button onClick={() => setResetResult(null)}
                className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 cursor-pointer bg-transparent border-none">
                <X size={15} />
              </button>
            </header>

            <div className="p-5 space-y-3">
              <div className="bg-amber-50 border border-amber-200 text-amber-800 text-[12px] rounded-xl p-3 flex items-start gap-2">
                <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold mb-0.5">Зөвхөн НЭГ удаа харагдана</div>
                  <div>Энэ цонхыг хаахад нууц үгийг дахин сэргээх боломжгүй — copy хийгээд seller-руу хүргэнэ үү.</div>
                </div>
              </div>

              <div>
                <label className="block text-[11px] text-gray-500 mb-1">Хэрэглэгч</label>
                <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-[13px]">
                  {resetResult.user.name} · <span className="text-gray-500">{resetResult.user.email}</span>
                </div>
              </div>

              <div>
                <label className="block text-[11px] text-gray-500 mb-1">Шинэ нууц үг</label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-violet-50 border-2 border-violet-200 rounded-lg px-3 py-2.5 text-[16px] font-mono font-semibold text-violet-800 tracking-wider select-all">
                    {resetResult.tempPassword}
                  </code>
                  <button onClick={copyPassword}
                    className={`shrink-0 inline-flex items-center gap-1 px-3 py-2.5 rounded-lg text-[12px] font-semibold cursor-pointer border transition-colors font-sans ${
                      copied
                        ? "bg-emerald-600 text-white border-emerald-600"
                        : "bg-white text-violet-700 border-violet-300 hover:bg-violet-50"
                    }`}>
                    {copied ? <><Check size={12} /> Хуулсан</> : <><Copy size={12} /> Хуулах</>}
                  </button>
                </div>
              </div>

              <div className="text-[11px] text-gray-500 leading-relaxed">
                Seller дараагийн нэвтрэлтийн үед энэ нууц үгээ оруулж, Profile-аас өөрчилнө үү.
                Бид нууц үгийг hashed хэлбэрээр (argon2) хадгалсан учраас дахин харах боломжгүй.
              </div>
            </div>

            <footer className="px-5 py-3 border-t border-gray-100 flex justify-end">
              <button onClick={() => setResetResult(null)}
                className="bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg px-4 py-2 text-[12px] font-semibold cursor-pointer border-none transition-colors font-sans">
                Хаах
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}

function ActionBtn({ onClick, title, color, disabled, children }: {
  onClick: () => void; title: string;
  color: "emerald" | "amber" | "violet" | "red";
  disabled?: boolean; children: React.ReactNode;
}) {
  const cls = {
    emerald: "hover:text-emerald-600 hover:bg-emerald-50",
    amber:   "hover:text-amber-600 hover:bg-amber-50",
    violet:  "hover:text-violet-600 hover:bg-violet-50",
    red:     "hover:text-red-500 hover:bg-red-50",
  }[color];
  return (
    <button onClick={onClick} disabled={disabled} title={title}
      className={`w-7 h-7 inline-flex items-center justify-center rounded-lg text-gray-400 cursor-pointer bg-transparent border-none transition-colors disabled:opacity-30 disabled:cursor-not-allowed mr-1 ${cls}`}>
      {children}
    </button>
  );
}
