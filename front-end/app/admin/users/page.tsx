"use client";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { User } from "@/app/types";
import { useAuthStore } from "@/store";
import {
  Shield, ShieldOff, Trash2, KeyRound, Copy, Check, AlertTriangle, X, Users as UsersIcon,
} from "lucide-react";
import {
  PageHeader, TableShell, THead, Th, Td, TableSkeleton, StatusChip,
} from "@/app/admin/_components/ui";

const ROLE_META: Record<string, { label: string; color: string }> = {
  admin:  { label: "Admin",  color: "bg-blue-50 text-blue-700 border-blue-200" },
  seller: { label: "Seller", color: "bg-amber-50 text-amber-700 border-amber-200" },
  user:   { label: "User",   color: "bg-gray-100 text-gray-600 border-gray-200" },
};

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

  // queueMicrotask — defer reload() past the effect commit so the
  // setLoading(true) inside it doesn't fire synchronously and trigger
  // React 19's cascading-render warning.
  useEffect(() => { queueMicrotask(reload); }, []);

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
      <PageHeader title="Хэрэглэгч" subtitle={`${users.length} хэрэглэгч`} icon={UsersIcon} />

      <input value={q} onChange={(e) => setQ(e.target.value)}
        className="w-full max-w-sm bg-white border border-gray-200 rounded-lg px-3 py-2 text-[16px] md:text-[13px] focus:border-blue-500 outline-none"
        placeholder="Нэр эсвэл имэйлээр хайх..." />

      <TableShell minWidth={620}>
        <THead>
          <Th>Нэр</Th>
          <Th>Имэйл</Th>
          <Th>Утас</Th>
          <Th align="center">Эрх</Th>
          <Th align="right">Үйлдэл</Th>
        </THead>
        {loading ? (
          <TableSkeleton cols={5} />
        ) : (
          <tbody>
            {filtered.length === 0 ? (
              <tr><Td colSpan={5} align="center" className="py-8 text-gray-400">Хэрэглэгч байхгүй</Td></tr>
            ) : filtered.map((u) => {
                const id = u._id ?? u.id ?? "";
                const isMe = String(id) === String(me?._id ?? me?.id);
                const busy = busyId === id;
                const role = ROLE_META[u.role ?? "user"] ?? ROLE_META.user;
                return (
                  <tr key={id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                    <Td className="font-medium text-gray-900">
                      {u.name}
                      {isMe && <span className="ml-1.5 text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">Та</span>}
                    </Td>
                    <Td className="text-gray-500"><span className="break-all">{u.email}</span></Td>
                    <Td className="text-gray-500 whitespace-nowrap">{u.phone || "—"}</Td>
                    <Td align="center">
                      <StatusChip color={role.color}>{role.label}</StatusChip>
                    </Td>
                    <Td align="right" className="whitespace-nowrap">
                      <ActionBtn onClick={() => resetPassword(u)} title="Нууц үг шинэчлэх" color="amber" disabled={isMe || busy}>
                        <KeyRound size={13} />
                      </ActionBtn>
                      <ActionBtn onClick={() => toggleRole(u)} title="Эрх солих" color="blue" disabled={isMe}>
                        {u.role === "admin" ? <ShieldOff size={13} /> : <Shield size={13} />}
                      </ActionBtn>
                      <ActionBtn onClick={() => remove(u)} title="Устгах" color="red" disabled={isMe}>
                        <Trash2 size={13} />
                      </ActionBtn>
                    </Td>
                  </tr>
                );
              })}
          </tbody>
        )}
      </TableShell>

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
                  <code className="flex-1 bg-blue-50 border-2 border-blue-200 rounded-lg px-3 py-2.5 text-[16px] font-mono font-semibold text-blue-800 tracking-wider select-all">
                    {resetResult.tempPassword}
                  </code>
                  <button onClick={copyPassword}
                    className={`shrink-0 inline-flex items-center gap-1 px-3 py-2.5 rounded-lg text-[12px] font-semibold cursor-pointer border transition-colors font-sans ${
                      copied
                        ? "bg-emerald-600 text-white border-emerald-600"
                        : "bg-white text-blue-700 border-blue-300 hover:bg-blue-50"
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
  color: "emerald" | "amber" | "blue" | "red";
  disabled?: boolean; children: React.ReactNode;
}) {
  const cls = {
    emerald: "hover:text-emerald-600 hover:bg-emerald-50",
    amber:   "hover:text-amber-600 hover:bg-amber-50",
    blue:  "hover:text-blue-600 hover:bg-blue-50",
    red:     "hover:text-red-500 hover:bg-red-50",
  }[color];
  return (
    <button onClick={onClick} disabled={disabled} title={title}
      className={`w-7 h-7 inline-flex items-center justify-center rounded-lg text-gray-400 cursor-pointer bg-transparent border-none transition-colors disabled:opacity-30 disabled:cursor-not-allowed mr-1 ${cls}`}>
      {children}
    </button>
  );
}
