"use client";

/**
 * /profile — Phase Z.3 buyer profile page.
 *
 * Previously the only place a buyer's identity surfaced was a tiny name
 * chip in the Navbar. That meant a logged-in user had no way to:
 *   • Edit their display name or phone number
 *   • Change their password without using the forgot-password flow
 *   • See their account stats (orders + wishlist) at a glance
 *   • Find shortcuts to their key surfaces (orders, wishlist, garage)
 *
 * Layout (Amazon "Your Account" pattern):
 *   ┌───────────────────────────────────────────────────────────────┐
 *   │ Avatar + name + email + role-chip + "member since"            │
 *   ├──────────────┬──────────────┬──────────────┬──────────────────┤
 *   │  Orders  N   │  Wishlist M  │  Garage  K   │  Become seller?  │
 *   ├──────────────┴──────────────┴──────────────┴──────────────────┤
 *   │  Tab: Profile | Password                                       │
 *   │  Profile tab: name + phone form, with email read-only          │
 *   │  Password tab: current + new + confirm                         │
 *   └───────────────────────────────────────────────────────────────┘
 *
 * Backed by:
 *   PATCH /api/auth/me              (name + phone)
 *   POST  /api/auth/change-password (current → new)
 *
 * Both endpoints return { code, fields[] } on validation failure so we
 * can highlight per-field errors. The Mongolian phone validator (8 digits)
 * is mirrored from the backend's auth schema.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import BuyerShell from "@/app/components/BuyerShell";
import { useAuthStore } from "@/store";
import { useWishlistStore } from "@/store/wishlist";
import { api, ApiError } from "@/lib/api";
import { toast } from "@/app/lib/toast";
import { User as UserType, Order } from "@/app/types";
import {
  User, Mail, Phone, Lock, Eye, EyeOff, Save, Loader2,
  ClipboardList, Heart, Car, Store, Shield, ShieldCheck,
  Calendar, AlertCircle, ArrowRight,
} from "lucide-react";

type Tab = "profile" | "password";

export default function ProfilePage() {
  const router = useRouter();
  const { user, setUser, _hasHydrated: authHydrated } = useAuthStore();
  const wishlistIds = useWishlistStore((s) => s.ids);

  // Gate routing on hydration: avoids the brief "you're logged out"
  // flicker that bounces the user to /auth/login when they actually have
  // a session in localStorage that hasn't deserialised yet.
  useEffect(() => {
    if (!authHydrated) return;
    if (!user) router.replace("/auth/login?redirect=/profile");
  }, [authHydrated, user, router]);

  const [tab, setTab] = useState<Tab>("profile");

  // ── Stats (live-fetched) ──────────────────────────────────────────
  const [orderCount, setOrderCount] = useState<number | null>(null);
  const [vehicleCount, setVehicleCount] = useState<number | null>(null);
  useEffect(() => {
    if (!authHydrated || !user) return;
    let cancelled = false;
    (async () => {
      try {
        const [orders, vehicles] = await Promise.all([
          api.get<{ items: Order[] } | Order[]>("/orders/mine").catch(() => []),
          api.get<{ items: unknown[] } | unknown[]>("/garage").catch(() => []),
        ]);
        if (cancelled) return;
        const oArr = Array.isArray(orders) ? orders : orders?.items ?? [];
        const vArr = Array.isArray(vehicles) ? vehicles : vehicles?.items ?? [];
        setOrderCount(oArr.length);
        setVehicleCount(vArr.length);
      } catch {
        if (!cancelled) { setOrderCount(0); setVehicleCount(0); }
      }
    })();
    return () => { cancelled = true; };
  }, [authHydrated, user]);

  // ── Profile form state ────────────────────────────────────────────
  const [name, setName]       = useState("");
  const [phone, setPhone]     = useState("");
  const [savingProfile, setSP]= useState(false);
  const [profileErrors, setProfileErrors] =
    useState<Record<string, string>>({});
  // Sync form to user object on hydrate / external setUser.
  useEffect(() => {
    if (user) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setName(user.name || "");
      setPhone(user.phone || "");
    }
  }, [user]);

  // ── Password form state ───────────────────────────────────────────
  const [currentPassword, setCP] = useState("");
  const [newPassword,     setNP] = useState("");
  const [confirmPassword, setCfP]= useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew,     setShowNew]     = useState(false);
  const [savingPw, setSavingPw]       = useState(false);
  const [pwErrors, setPwErrors]       = useState<Record<string, string>>({});

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileErrors({});
    const trimmedName  = name.trim();
    const trimmedPhone = phone.trim();

    // Mirror of backend phone validator: 8 digits or empty.
    const errs: Record<string, string> = {};
    if (trimmedName.length < 2) errs.name = "Нэр хамгийн багадаа 2 үсэг";
    if (trimmedPhone && !/^\d{8}$/.test(trimmedPhone.replace(/\D/g, ""))) {
      errs.phone = "Утасны дугаар 8 оронтой байх ёстой";
    }
    if (Object.keys(errs).length) {
      setProfileErrors(errs);
      return;
    }

    setSP(true);
    try {
      const { user: updated } = await api.patch<{ user: UserType }>(
        "/auth/me",
        { name: trimmedName, phone: trimmedPhone },
      );
      setUser(updated);
      toast.success("Профайл хадгалагдлаа");
    } catch (e) {
      if (e instanceof ApiError) {
        const fields = (e.data?.fields as Array<{ path: string; message: string }>) || [];
        const map: Record<string, string> = {};
        for (const f of fields) map[f.path] = f.message;
        setProfileErrors(map);
        toast.error(e.message || "Хадгалж чадсангүй");
      } else {
        toast.error("Хадгалж чадсангүй");
      }
    } finally {
      setSP(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwErrors({});
    const errs: Record<string, string> = {};
    if (!currentPassword) errs.currentPassword = "Одоогийн нууц үг оруулна уу";
    if (newPassword.length < 6) errs.newPassword = "Нууц үг хамгийн багадаа 6 тэмдэгт";
    if (newPassword !== confirmPassword) errs.confirmPassword = "Нууц үг таарахгүй байна";
    if (newPassword && currentPassword === newPassword) {
      errs.newPassword = "Шинэ нууц үг хуучнаасаа өөр байх ёстой";
    }
    if (Object.keys(errs).length) {
      setPwErrors(errs);
      return;
    }

    setSavingPw(true);
    try {
      await api.post("/auth/change-password", {
        currentPassword,
        newPassword,
      });
      toast.success("Нууц үг шинэчлэгдлээ");
      setCP(""); setNP(""); setCfP("");
    } catch (e) {
      if (e instanceof ApiError) {
        const fields = (e.data?.fields as Array<{ path: string; message: string }>) || [];
        const map: Record<string, string> = {};
        for (const f of fields) map[f.path] = f.message;
        setPwErrors(map);
        toast.error(e.message || "Алдаа гарлаа");
      } else {
        toast.error("Алдаа гарлаа");
      }
    } finally {
      setSavingPw(false);
    }
  };

  const memberSince = useMemo(() => {
    if (!user?.createdAt) return null;
    const d = new Date(user.createdAt);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString("mn-MN", {
      year: "numeric", month: "long", day: "numeric",
    });
  }, [user]);

  const initials = (user?.name || "?")
    .trim().split(/\s+/).slice(0, 2).map(s => s[0]).join("").toUpperCase();

  const isAdmin  = user?.role === "admin";
  const isSeller = user?.role === "seller" || user?.sellerStatus === "approved";
  const sellerPending = user?.sellerStatus === "pending";

  // Don't render anything before hydration to keep SSR/CSR markup matched.
  if (!authHydrated || !user) {
    return (
      <BuyerShell>
        <div className="max-w-4xl mx-auto px-5 py-10">
          <div className="h-32 bg-gray-100 rounded-2xl animate-pulse" />
        </div>
      </BuyerShell>
    );
  }

  return (
    <BuyerShell>
      <div className="max-w-4xl mx-auto px-5 py-6 space-y-5">

        {/* ── Identity card ────────────────────────────────────────── */}
        <section className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
          <div className="h-20 bg-gradient-to-r from-blue-600 via-blue-700 to-amber-500" />
          <div className="px-6 pb-5 -mt-10">
            <div className="flex items-end gap-4">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-600 to-blue-800 text-white text-[26px] font-bold flex items-center justify-center border-4 border-white shadow-md shrink-0">
                {initials || <User size={28} />}
              </div>
              <div className="flex-1 min-w-0 pb-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-[22px] font-semibold text-gray-900 truncate">
                    {user.name}
                  </h1>
                  {isAdmin && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-blue-700 bg-blue-100 px-2 py-0.5 rounded">
                      <Shield size={10} /> ADMIN
                    </span>
                  )}
                  {!isAdmin && isSeller && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded">
                      <Store size={10} /> SELLER
                    </span>
                  )}
                  {!isAdmin && !isSeller && sellerPending && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-orange-700 bg-orange-100 px-2 py-0.5 rounded">
                      Хүсэлт хүлээгдэж байна
                    </span>
                  )}
                </div>
                <div className="text-[13px] text-gray-500 mt-0.5 flex items-center gap-3 flex-wrap">
                  <span className="flex items-center gap-1"><Mail size={11} />{user.email}</span>
                  {user.phone && <span className="flex items-center gap-1"><Phone size={11} />{user.phone}</span>}
                  {memberSince && (
                    <span className="flex items-center gap-1 text-gray-400">
                      <Calendar size={11} /> {memberSince}-с гишүүн
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Stat grid ────────────────────────────────────────────── */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard
            href="/orders"
            icon={<ClipboardList size={16} />}
            label="Захиалга"
            value={orderCount}
            color="blue"
          />
          <StatCard
            href="/wishlist"
            icon={<Heart size={16} />}
            label="Хадгалсан"
            value={wishlistIds?.size ?? 0}
            color="red"
          />
          <StatCard
            href="/garage"
            icon={<Car size={16} />}
            label="Машин"
            value={vehicleCount}
            color="amber"
          />
          {isAdmin ? (
            <StatCard
              href="/admin"
              icon={<Shield size={16} />}
              label="Админ"
              value="→"
              color="blue"
              text
            />
          ) : isSeller ? (
            <StatCard
              href="/seller"
              icon={<Store size={16} />}
              label="Зарагч самбар"
              value="→"
              color="amber"
              text
            />
          ) : sellerPending ? (
            <StatCard
              href="/seller/apply"
              icon={<Store size={16} />}
              label="Хүсэлт"
              value="..."
              color="orange"
              text
            />
          ) : (
            <StatCard
              href="/seller/apply"
              icon={<Store size={16} />}
              label="Зарагч болох"
              value="→"
              color="amber"
              text
            />
          )}
        </section>

        {/* ── Tabs ─────────────────────────────────────────────────── */}
        <section className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
          <div className="flex border-b border-gray-200">
            <TabBtn active={tab === "profile"} onClick={() => setTab("profile")}>
              <User size={13} /> Профайл
            </TabBtn>
            <TabBtn active={tab === "password"} onClick={() => setTab("password")}>
              <Lock size={13} /> Нууц үг
            </TabBtn>
          </div>

          {/* ── PROFILE TAB ─────────────────────────────────────── */}
          {tab === "profile" && (
            <form onSubmit={handleSaveProfile} className="p-5 md:p-6 space-y-4 max-w-lg">
              <Field
                label="Нэр"
                icon={<User size={13} />}
                error={profileErrors.name}
              >
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2.5 text-[14px] outline-none focus:border-blue-500 transition-colors font-sans"
                  placeholder="Таны нэр"
                  maxLength={80}
                />
              </Field>

              <Field
                label="И-мэйл"
                icon={<Mail size={13} />}
                hint="И-мэйл хаягийг солих боломжгүй"
              >
                <input
                  type="email"
                  value={user.email}
                  readOnly
                  className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 text-[14px] text-gray-500 cursor-not-allowed font-sans"
                />
              </Field>

              <Field
                label="Утас"
                icon={<Phone size={13} />}
                hint="8 оронтой утасны дугаар. Орхиж болно."
                error={profileErrors.phone}
              >
                <div className="flex">
                  <span className="bg-gray-100 border border-r-0 border-gray-200 rounded-l-lg px-3 py-2.5 text-[14px] text-gray-500">
                    +976
                  </span>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
                    inputMode="numeric"
                    maxLength={8}
                    placeholder="99001122"
                    className="flex-1 bg-white border border-gray-200 rounded-r-lg px-3 py-2.5 text-[14px] outline-none focus:border-blue-500 transition-colors font-sans"
                  />
                </div>
              </Field>

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="submit"
                  disabled={savingProfile}
                  className="inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white rounded-lg px-4 py-2 text-[13px] font-semibold cursor-pointer border-none transition-colors font-sans"
                >
                  {savingProfile
                    ? <><Loader2 size={13} className="animate-spin" /> Хадгалж байна…</>
                    : <><Save size={13} /> Хадгалах</>}
                </button>
                {!savingProfile && (
                  <button
                    type="button"
                    onClick={() => {
                      setName(user.name || "");
                      setPhone(user.phone || "");
                      setProfileErrors({});
                    }}
                    className="text-[12px] text-gray-500 hover:text-gray-700 cursor-pointer bg-transparent border-none font-sans"
                  >
                    Цуцлах
                  </button>
                )}
              </div>
            </form>
          )}

          {/* ── PASSWORD TAB ────────────────────────────────────── */}
          {tab === "password" && (
            <form onSubmit={handleChangePassword} className="p-5 md:p-6 space-y-4 max-w-lg">
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-start gap-2 text-[12px] text-amber-800">
                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                <span>
                  Шинэ нууц үг үүсгэхэд одоогийн нууц үгээ оруулна. Аюулгүй
                  байдлын үүднээс ийм байх ёстой.
                </span>
              </div>

              <PasswordField
                label="Одоогийн нууц үг"
                value={currentPassword}
                onChange={setCP}
                show={showCurrent}
                onToggleShow={() => setShowCurrent(s => !s)}
                error={pwErrors.currentPassword}
                placeholder="••••••••"
                autoComplete="current-password"
              />

              <PasswordField
                label="Шинэ нууц үг"
                value={newPassword}
                onChange={setNP}
                show={showNew}
                onToggleShow={() => setShowNew(s => !s)}
                error={pwErrors.newPassword}
                placeholder="Хамгийн багадаа 6 тэмдэгт"
                autoComplete="new-password"
              />

              <PasswordField
                label="Шинэ нууц үг (давтах)"
                value={confirmPassword}
                onChange={setCfP}
                show={showNew}
                onToggleShow={() => setShowNew(s => !s)}
                error={pwErrors.confirmPassword}
                placeholder="Дахин оруулна уу"
                autoComplete="new-password"
              />

              {/* Strength signal — purely informational. */}
              {newPassword && (
                <PasswordStrength value={newPassword} />
              )}

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="submit"
                  disabled={savingPw}
                  className="inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white rounded-lg px-4 py-2 text-[13px] font-semibold cursor-pointer border-none transition-colors font-sans"
                >
                  {savingPw
                    ? <><Loader2 size={13} className="animate-spin" /> Шинэчилж байна…</>
                    : <><ShieldCheck size={13} /> Нууц үг шинэчлэх</>}
                </button>
                <Link href="/auth/forgot" className="text-[12px] text-gray-500 hover:text-blue-600">
                  Нууц үг мартсан?
                </Link>
              </div>
            </form>
          )}
        </section>

        {/* ── Quick links footer ────────────────────────────────── */}
        <section className="bg-white border border-gray-200 rounded-2xl p-4">
          <div className="text-[11px] text-gray-400 uppercase tracking-wider font-medium mb-2">
            Хурдан холбоос
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <QuickLink href="/orders"   icon={<ClipboardList size={14} />}>Захиалгууд</QuickLink>
            <QuickLink href="/wishlist" icon={<Heart size={14} />}>Хадгалсан</QuickLink>
            <QuickLink href="/garage"   icon={<Car size={14} />}>Машинууд</QuickLink>
            <QuickLink href="/cart"     icon={<ArrowRight size={14} />}>Сагс</QuickLink>
          </div>
        </section>
      </div>
    </BuyerShell>
  );
}

/* ──────────────────────────────────────────────────────────────────
 * Sub-components — kept local to the page since they're tightly
 * coupled to the form styling above (would just be noise as exports).
 * ────────────────────────────────────────────────────────────────── */

function StatCard({
  href, icon, label, value, color, text,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  value: number | string | null;
  color: "blue" | "amber" | "red" | "orange";
  text?: boolean;
}) {
  const colorMap = {
    blue:   "bg-blue-50 text-blue-700",
    amber:  "bg-amber-50 text-amber-700",
    red:    "bg-red-50 text-red-700",
    orange: "bg-orange-50 text-orange-700",
  } as const;
  return (
    <Link
      href={href}
      className="bg-white border border-gray-200 rounded-xl p-3 hover:border-blue-300 hover:shadow-sm transition-all group"
    >
      <div className="flex items-center gap-2 mb-1">
        <span className={`w-7 h-7 rounded-lg ${colorMap[color]} flex items-center justify-center`}>
          {icon}
        </span>
        <span className="text-[11px] text-gray-500 truncate">{label}</span>
      </div>
      <div className={`text-[20px] font-bold text-gray-900 group-hover:text-blue-700 transition-colors ${text ? "text-blue-600" : ""}`}>
        {value === null ? <span className="text-gray-300 text-[14px]">…</span> : value}
      </div>
    </Link>
  );
}

function TabBtn({
  active, onClick, children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-5 py-3 text-[13px] font-medium cursor-pointer bg-transparent border-none font-sans transition-colors ${
        active
          ? "text-blue-700 border-b-2 border-blue-600 -mb-px"
          : "text-gray-500 hover:text-gray-800 border-b-2 border-transparent"
      }`}
    >
      {children}
    </button>
  );
}

function Field({
  label, icon, hint, error, children,
}: {
  label: string;
  icon?: React.ReactNode;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="flex items-center gap-1.5 text-[12px] font-medium text-gray-700 mb-1.5">
        {icon && <span className="text-gray-400">{icon}</span>}
        {label}
      </label>
      {children}
      {error && (
        <div className="flex items-center gap-1 text-[11px] text-red-600 mt-1">
          <AlertCircle size={11} /> {error}
        </div>
      )}
      {!error && hint && (
        <div className="text-[11px] text-gray-400 mt-1">{hint}</div>
      )}
    </div>
  );
}

function PasswordField({
  label, value, onChange, show, onToggleShow, error, placeholder, autoComplete,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  onToggleShow: () => void;
  error?: string;
  placeholder?: string;
  autoComplete?: string;
}) {
  return (
    <Field label={label} icon={<Lock size={13} />} error={error}>
      <div className="relative">
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          className="w-full bg-white border border-gray-200 rounded-lg pl-3 pr-10 py-2.5 text-[14px] outline-none focus:border-blue-500 transition-colors font-sans"
        />
        <button
          type="button"
          onClick={onToggleShow}
          aria-label={show ? "Нуух" : "Харах"}
          className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 inline-flex items-center justify-center text-gray-400 hover:text-gray-700 cursor-pointer bg-transparent border-none rounded"
        >
          {show ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
    </Field>
  );
}

function PasswordStrength({ value }: { value: string }) {
  const score = scorePassword(value);
  const levels = [
    { label: "Сул",     color: "bg-red-400",    text: "text-red-600" },
    { label: "Дунд",    color: "bg-amber-400",  text: "text-amber-600" },
    { label: "Сайн",    color: "bg-emerald-400",text: "text-emerald-600" },
    { label: "Маш сайн",color: "bg-emerald-600",text: "text-emerald-700" },
  ];
  const idx = Math.max(0, Math.min(3, score));
  const cur = levels[idx];
  return (
    <div>
      <div className="flex gap-1 h-1 rounded-full overflow-hidden bg-gray-100">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={`flex-1 ${i <= idx ? cur.color : "bg-gray-100"} transition-colors`} />
        ))}
      </div>
      <div className={`text-[10px] font-medium mt-1 ${cur.text}`}>
        Нууц үгийн хүчтэй байдал: {cur.label}
      </div>
    </div>
  );
}

function scorePassword(pw: string): number {
  let s = 0;
  if (pw.length >= 8)  s++;
  if (pw.length >= 12) s++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) s++;
  return s - 1; // 0..3
}

function QuickLink({
  href, icon, children,
}: {
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2 px-3 py-2 bg-gray-50 hover:bg-blue-50 border border-gray-100 hover:border-blue-200 rounded-lg text-[12px] text-gray-700 transition-colors"
    >
      <span className="text-gray-400">{icon}</span>
      <span className="truncate">{children}</span>
    </Link>
  );
}
