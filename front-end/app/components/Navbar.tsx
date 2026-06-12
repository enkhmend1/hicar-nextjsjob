"use client";
import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCartStore, useAuthStore, useCarStore } from "@/store";
import { useT } from "@/lib/i18n";
import LangSwitcher from "./LangSwitcher";
import NotificationBell from "./NotificationBell";
import {
  ShoppingCart, User, Menu, X, LogOut, Package, Shield, Store, Heart, Car,
  Search, ChevronDown, Plus, ClipboardList, HelpCircle,
} from "lucide-react";

/**
 * Navbar — Phase Z.
 *
 * Two new interactive popovers replace the previously-static badges:
 *
 *   1. Vehicle dropdown (replaces the "→ /garage" link badge)
 *      Click the active vehicle chip → menu shows:
 *        • Other recent vehicles → one-tap switch (setActiveVehicle)
 *        • "Энэ машинаас гарах" → clearActiveVehicle()
 *        • "Машинаа удирдах →" → /garage
 *      Buyer no longer has to detour through /garage to swap cars.
 *
 *   2. User dropdown (replaces the static name chip + bare logout button)
 *      Click avatar/initials → menu shows:
 *        • Identity card (name + email)
 *        • Profile / Orders / Wishlist / Garage links
 *        • Seller dashboard or "Seller болох" depending on status
 *        • Admin shortcut for admins
 *        • Logout (red, separated)
 *
 * Both popovers:
 *   • Close on outside click (mousedown listener on document)
 *   • Close on ESC
 *   • Close on route change (pathname-effect)
 *   • Are mutually exclusive — opening one closes the other
 */

export default function Navbar() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  // ── Persistent search (Phase U.3) ─────────────────────────────────
  const [navQuery, setNavQuery] = useState("");
  const showNavSearch = pathname !== "/";
  const onSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = navQuery.trim();
    if (!q) { router.push("/shop"); return; }
    router.push(`/shop?q=${encodeURIComponent(q)}`);
  };

  // ── Cart badge (Phase O.4 hydration gate) ─────────────────────────
  const count        = useCartStore(s => s.count());
  const cartHydrated = useCartStore(s => s._hasHydrated);
  const showCartBadge = cartHydrated && count > 0;

  // ── Auth (Phase O.4 hydration gate) ───────────────────────────────
  const { user, logout, _hasHydrated: authHydrated } = useAuthStore();

  // ── Active vehicle + recents (Phase V.2 + Z.1 + AD) ───────────────
  const activeVehicle       = useCarStore((s) => s.activeVehicle);
  const recentVehicles      = useCarStore((s) => s.recentVehicles);
  const setActiveVehicle    = useCarStore((s) => s.setActiveVehicle);
  const clearActiveVehicle  = useCarStore((s) => s.clearActiveVehicle);
  const removeRecentVehicle = useCarStore((s) => s.removeRecentVehicle);
  const carHydrated         = useCarStore((s) => s._hasHydrated);
  const showVehicleBadge =
    carHydrated && !!activeVehicle && pathname !== "/garage";

  const t = useT();
  const showUserUI = authHydrated && !!user;
  const isAdmin  = showUserUI && user?.role === "admin";
  const isSeller = showUserUI && (user?.role === "seller" || user?.sellerStatus === "approved");

  // ── Popover state — mutually exclusive ────────────────────────────
  const [vehicleOpen, setVehicleOpen] = useState(false);
  const [userOpen,    setUserOpen]    = useState(false);
  const vehicleRef = useRef<HTMLDivElement | null>(null);
  const userRef    = useRef<HTMLDivElement | null>(null);

  // Outside-click + ESC + route-change → close both popovers.
  useEffect(() => {
    if (!vehicleOpen && !userOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (vehicleOpen && vehicleRef.current && !vehicleRef.current.contains(t)) {
        setVehicleOpen(false);
      }
      if (userOpen && userRef.current && !userRef.current.contains(t)) {
        setUserOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setVehicleOpen(false); setUserOpen(false); }
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      // Ensure popovers are closed if the component re-renders and the
      // effect re-runs (e.g., rapid navigation) — prevents stale-open UI.
      setVehicleOpen(false);
      setUserOpen(false);
    };
  }, [vehicleOpen, userOpen]);

  // Close popovers on navigation — Next router doesn't unmount Navbar.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVehicleOpen(false);
    setUserOpen(false);
    setOpen(false);
  }, [pathname]);

  // Other recents — exclude the currently-active vehicle.
  const otherRecents = (recentVehicles || []).filter(
    (v) => v.id !== activeVehicle?.id,
  );

  // Avatar initials — first letter of name + last word initial, max 2.
  const initials = (user?.name || "?")
    .trim().split(/\s+/).slice(0, 2).map(s => s[0]).join("").toUpperCase();

  return (
    <nav className="bg-white border-b border-gray-200 sticky top-0 z-50 shadow-sm">
      <div className="max-w-6xl mx-auto px-5 h-14 flex items-center justify-between gap-4">

        <Link href="/" className="text-[20px] font-semibold tracking-tight shrink-0">
          <em className="text-blue-600 not-italic">Hi</em>car
        </Link>

        {/* Persistent search */}
        {showNavSearch && (
          <form onSubmit={onSearch} className="hidden md:flex flex-1 max-w-md mx-2">
            <div className="relative w-full">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <input
                value={navQuery}
                onChange={(e) => setNavQuery(e.target.value)}
                placeholder="Сэлбэг хайх... (нэр, OEM, брэнд)"
                className="w-full bg-gray-50 hover:bg-white focus:bg-white border border-gray-200 hover:border-gray-300 focus:border-blue-500 rounded-xl pl-9 pr-3 py-2 text-[13px] outline-none transition-colors font-sans"
              />
            </div>
          </form>
        )}

        {/* ── VEHICLE DROPDOWN (Phase Z.1) ──────────────────────────── */}
        {showVehicleBadge && activeVehicle && (
          <div className="relative hidden md:block shrink-0" ref={vehicleRef}>
            <button
              type="button"
              onClick={() => { setVehicleOpen(v => !v); setUserOpen(false); }}
              aria-haspopup="menu"
              aria-expanded={vehicleOpen}
              title={`${activeVehicle.manufacturer} ${activeVehicle.model} · ${activeVehicle.plate}`}
              className="inline-flex items-center gap-1.5 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-full pl-2 pr-2 py-1 text-[12px] transition-colors cursor-pointer font-sans max-w-[210px]"
            >
              <Car size={11} className="text-blue-700 shrink-0" />
              <span className="font-semibold text-blue-700 truncate">
                {activeVehicle.manufacturer}
              </span>
              <span className="text-blue-600 truncate">
                {activeVehicle.model}
              </span>
              <ChevronDown
                size={11}
                className={`text-blue-600/60 shrink-0 transition-transform ${vehicleOpen ? "rotate-180" : ""}`}
              />
            </button>

            {vehicleOpen && (
              <div
                role="menu"
                className="absolute top-full right-0 mt-1.5 w-[280px] bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden z-50 animate-in fade-in slide-in-from-top-1 duration-150"
              >
                {/* Active vehicle header */}
                <div className="px-3 py-2.5 bg-gradient-to-br from-blue-50 to-amber-50 border-b border-gray-100">
                  <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">
                    Идэвхтэй машин
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-white border border-blue-200 flex items-center justify-center shrink-0">
                      <Car size={15} className="text-blue-700" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-semibold text-gray-900 truncate">
                        {activeVehicle.manufacturer} {activeVehicle.model}
                      </div>
                      <div className="text-[11px] text-gray-600 truncate">
                        {activeVehicle.plate}
                        {activeVehicle.generation && ` · ${activeVehicle.generation}`}
                        {activeVehicle.engineCode && ` · ${activeVehicle.engineCode}`}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Other recents — quick switch + per-row remove.
                    Hover нь зөвхөн full-width row дээр (parent group) — гүйх
                    үед remove товч харагдана. mousedown.stopPropagation нь
                    parent switch товчийг fire хийхээс сэргийлнэ. */}
                {otherRecents.length > 0 && (
                  <div className="py-1 border-b border-gray-100">
                    <div className="px-3 pt-1.5 pb-1 text-[10px] text-gray-500 uppercase tracking-wider font-medium">
                      Сүүлд ашигласан
                    </div>
                    {otherRecents.map((v) => (
                      <div
                        key={v.id}
                        className="group/row relative w-full flex items-center hover:bg-blue-50 transition-colors"
                      >
                        <button
                          type="button"
                          onClick={() => { setActiveVehicle(v); setVehicleOpen(false); }}
                          className="flex-1 min-w-0 flex items-center gap-2 px-3 py-1.5 text-left cursor-pointer bg-transparent border-none font-sans"
                        >
                          <div className="w-6 h-6 rounded-md bg-gray-100 flex items-center justify-center shrink-0">
                            <Car size={11} className="text-gray-500" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-[12px] font-medium text-gray-700 truncate">
                              {v.manufacturer} {v.model}
                            </div>
                            <div className="text-[10px] text-gray-500 truncate">{v.plate}</div>
                          </div>
                        </button>
                        <button
                          type="button"
                          aria-label={`${v.manufacturer} ${v.model}-г түүхээс хасах`}
                          title="Түүхээс хасах"
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            removeRecentVehicle(v.id);
                          }}
                          className="shrink-0 w-7 h-7 mr-2 inline-flex items-center justify-center rounded-md text-gray-300 hover:text-red-500 hover:bg-red-50 cursor-pointer bg-transparent border-none transition-colors opacity-0 group-hover/row:opacity-100"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                    {otherRecents.length > 1 && (
                      <button
                        type="button"
                        onClick={() => {
                          useCarStore.getState().clearRecentVehicles();
                          setVehicleOpen(false);
                        }}
                        className="w-full text-[10px] text-gray-500 hover:text-red-500 py-1 px-3 text-right cursor-pointer bg-transparent border-none font-sans"
                      >
                        Бүх түүхийг арилгах
                      </button>
                    )}
                  </div>
                )}

                {/* Actions */}
                <div className="py-1">
                  <Link
                    href="/garage"
                    onClick={() => setVehicleOpen(false)}
                    className="flex items-center gap-2 px-3 py-2 text-[12px] text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    <Plus size={13} className="text-blue-600" />
                    <span className="flex-1">Машин нэмэх / удирдах</span>
                    <span className="text-gray-300">→</span>
                  </Link>
                  <button
                    type="button"
                    onClick={() => { clearActiveVehicle(); setVehicleOpen(false); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-[12px] text-red-500 hover:bg-red-50 cursor-pointer bg-transparent border-none transition-colors font-sans"
                  >
                    <X size={13} />
                    Энэ машинаас гарах
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="hidden md:flex gap-5">
          <Link href="/shop" className="text-[14px] text-gray-600 hover:text-blue-600 transition-colors">{t("nav.shop")}</Link>
          <Link href="/lookup" className="text-[14px] text-gray-600 hover:text-blue-600 transition-colors">Улсын дугаар</Link>
          <Link href="/orders" className="text-[14px] text-gray-600 hover:text-blue-600 transition-colors">{t("nav.orders")}</Link>
          <Link href="/help" className="text-[14px] text-gray-600 hover:text-blue-600 transition-colors">{t("nav.help")}</Link>
          {isSeller && !isAdmin && (
            <Link href="/seller" className="flex items-center gap-1 text-[14px] text-amber-600 font-semibold hover:underline transition-colors">
              <Store size={13} /> {t("nav.seller")}
            </Link>
          )}
          {isAdmin && (
            <Link href="/admin" className="flex items-center gap-1 text-[14px] text-blue-600 font-semibold hover:underline transition-colors">
              <Shield size={13} /> {t("nav.admin")}
            </Link>
          )}
        </div>

        <div className="hidden md:flex items-center gap-2 shrink-0">
          <LangSwitcher compact />
          <NotificationBell />

          {/* ── USER DROPDOWN (Phase Z.2) ───────────────────────────── */}
          {showUserUI ? (
            <div className="relative" ref={userRef}>
              <button
                type="button"
                onClick={() => { setUserOpen(v => !v); setVehicleOpen(false); }}
                aria-haspopup="menu"
                aria-expanded={userOpen}
                title={user.name}
                className={`flex items-center gap-2 border rounded-lg pl-1 pr-2 py-1 cursor-pointer bg-transparent transition-colors font-sans ${
                  userOpen
                    ? "border-blue-300 bg-blue-50"
                    : "border-gray-200 hover:border-blue-300 hover:bg-blue-50/40"
                }`}
              >
                <span className="w-7 h-7 rounded-md bg-gradient-to-br from-blue-600 to-blue-800 text-white text-[11px] font-bold flex items-center justify-center shrink-0">
                  {initials || <User size={13} />}
                </span>
                <span className="text-[13px] text-gray-700 font-medium max-w-[80px] truncate">
                  {user.name.split(" ")[0]}
                </span>
                <ChevronDown
                  size={12}
                  className={`text-gray-400 transition-transform ${userOpen ? "rotate-180" : ""}`}
                />
              </button>

              {userOpen && (
                <div
                  role="menu"
                  className="absolute top-full right-0 mt-1.5 w-[260px] bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden z-50 animate-in fade-in slide-in-from-top-1 duration-150"
                >
                  {/* Identity card */}
                  <div className="flex items-center gap-2.5 px-3 py-3 bg-gradient-to-br from-blue-50 to-amber-50/50 border-b border-gray-100">
                    <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-blue-800 text-white text-[14px] font-bold flex items-center justify-center shrink-0 shadow-sm">
                      {initials || <User size={16} />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-semibold text-gray-900 truncate">
                        {user.name}
                      </div>
                      <div className="text-[11px] text-gray-600 truncate">
                        {user.email}
                      </div>
                      {isAdmin && (
                        <span className="inline-block mt-0.5 text-[9px] font-bold text-blue-700 bg-blue-100 px-1.5 py-0.5 rounded">
                          ADMIN
                        </span>
                      )}
                      {!isAdmin && isSeller && (
                        <span className="inline-block mt-0.5 text-[9px] font-bold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">
                          SELLER
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Primary links */}
                  <div className="py-1">
                    <DropdownLink href="/profile" icon={<User size={13} />} onClick={() => setUserOpen(false)}>
                      Профайл
                    </DropdownLink>
                    <DropdownLink href="/orders" icon={<ClipboardList size={13} />} onClick={() => setUserOpen(false)}>
                      Захиалгууд
                    </DropdownLink>
                    <DropdownLink href="/wishlist" icon={<Heart size={13} />} onClick={() => setUserOpen(false)}>
                      Хадгалсан
                    </DropdownLink>
                    <DropdownLink href="/garage" icon={<Car size={13} />} onClick={() => setUserOpen(false)}>
                      Миний машинууд
                    </DropdownLink>
                  </div>

                  {/* Role-based section */}
                  {(isSeller || isAdmin || (!isSeller && !isAdmin)) && (
                    <div className="py-1 border-t border-gray-100">
                      {isAdmin && (
                        <DropdownLink href="/admin" icon={<Shield size={13} className="text-blue-600" />} onClick={() => setUserOpen(false)}>
                          <span className="text-blue-600 font-semibold">Админ самбар</span>
                        </DropdownLink>
                      )}
                      {isSeller && !isAdmin && (
                        <DropdownLink href="/seller" icon={<Store size={13} className="text-amber-600" />} onClick={() => setUserOpen(false)}>
                          <span className="text-amber-600 font-semibold">Зарагч самбар</span>
                        </DropdownLink>
                      )}
                      {!isAdmin && !isSeller && (
                        <DropdownLink href="/seller/apply" icon={<Store size={13} />} onClick={() => setUserOpen(false)}>
                          <span className="text-amber-600">{t("nav.becomeSeller")}</span>
                        </DropdownLink>
                      )}
                    </div>
                  )}

                  {/* Logout */}
                  <div className="py-1 border-t border-gray-100">
                    <button
                      type="button"
                      onClick={() => { logout(); setUserOpen(false); }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-[12px] text-red-500 hover:bg-red-50 cursor-pointer bg-transparent border-none transition-colors font-sans"
                    >
                      <LogOut size={13} />
                      {t("nav.logout")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <>
              <Link href="/auth/login" className="border border-gray-200 rounded-lg px-4 py-1.5 text-[13px] text-gray-600 hover:border-blue-500 hover:text-blue-600 transition-colors">{t("nav.login")}</Link>
              <Link href="/auth/register" className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 py-1.5 text-[13px] font-medium transition-colors">{t("nav.register")}</Link>
            </>
          )}
          {showUserUI && (
            <Link href="/wishlist" className="w-9 h-9 flex items-center justify-center rounded-lg text-gray-500 hover:text-red-500 hover:bg-red-50 transition-colors" title="Wishlist">
              <Heart size={18} />
            </Link>
          )}
          <Link href="/cart" className="relative w-9 h-9 flex items-center justify-center rounded-lg text-gray-500 hover:text-blue-600 hover:bg-blue-50 transition-colors">
            <ShoppingCart size={19} />
            {showCartBadge && (
              <span className="absolute top-0.5 right-0.5 min-w-[16px] h-4 bg-blue-600 text-white text-[9px] rounded-full flex items-center justify-center px-0.5 font-semibold">{count}</span>
            )}
          </Link>
        </div>

        <button onClick={() => setOpen(!open)} className="md:hidden p-2 cursor-pointer bg-transparent border-none text-gray-700 rounded-lg hover:bg-gray-100 transition-colors">
          {open ? <X size={21} /> : <Menu size={21} />}
        </button>
      </div>

      {open && (
        <div className="md:hidden bg-white border-t border-gray-100 px-5 pb-4 pt-3 shadow-lg max-h-[calc(100dvh-3.5rem)] overflow-y-auto overscroll-contain">
          {/* Mobile search — the desktop bar is hidden below md, and a parts
              shop without search on the phone is unusable. 16px font prevents
              iOS Safari's focus auto-zoom. */}
          <form onSubmit={(e) => { onSearch(e); setOpen(false); }} className="relative mb-3">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              value={navQuery}
              onChange={(e) => setNavQuery(e.target.value)}
              placeholder="Сэлбэг хайх... (нэр, OEM, брэнд)"
              className="w-full bg-gray-50 focus:bg-white border border-gray-200 focus:border-blue-500 rounded-xl pl-9 pr-3 py-2.5 text-[16px] outline-none transition-colors font-sans"
            />
          </form>
          {/* Mobile: show identity card at top when signed-in. */}
          {showUserUI && (
            <div className="flex items-center gap-2.5 pb-3 mb-2 border-b border-gray-100">
              <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-blue-800 text-white text-[14px] font-bold flex items-center justify-center shrink-0">
                {initials || <User size={16} />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-semibold text-gray-900 truncate">{user.name}</div>
                <div className="text-[11px] text-gray-500 truncate">{user.email}</div>
              </div>
              <Link href="/profile" onClick={() => setOpen(false)}
                className="text-[11px] text-blue-600 font-medium px-2 py-1 rounded border border-blue-200">
                Профайл
              </Link>
            </div>
          )}

          {/* Mobile vehicle row — same switch/clear actions condensed. */}
          {showVehicleBadge && activeVehicle && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-2.5 mb-2">
              <div className="flex items-center gap-2 mb-1.5">
                <Car size={13} className="text-blue-700" />
                <div className="text-[12px] font-semibold text-blue-900 truncate flex-1">
                  {activeVehicle.manufacturer} {activeVehicle.model}
                </div>
                <span className="text-[11px] text-blue-700/90">{activeVehicle.plate}</span>
              </div>
              <div className="flex gap-1.5 mt-1.5">
                <Link href="/garage" onClick={() => setOpen(false)}
                  className="flex-1 text-center text-[11px] bg-white text-blue-700 border border-blue-300 rounded-md py-1.5 font-medium">
                  Машины жагсаалт
                </Link>
                <button
                  type="button"
                  onClick={() => { clearActiveVehicle(); setOpen(false); }}
                  className="text-[11px] text-red-500 border border-red-200 rounded-md px-3 py-1.5 cursor-pointer bg-white font-sans"
                >
                  Гарах
                </button>
              </div>
            </div>
          )}

          <Link href="/shop" className="flex items-center gap-3 text-[15px] text-gray-700 py-2.5 border-b border-gray-100" onClick={() => setOpen(false)}><Package size={16} />{t("nav.shop")}</Link>
          <Link href="/orders" className="flex items-center gap-3 text-[15px] text-gray-700 py-2.5 border-b border-gray-100" onClick={() => setOpen(false)}><Package size={16} />{t("nav.orders")}</Link>
          <Link href="/help" className="flex items-center gap-3 text-[15px] text-gray-700 py-2.5 border-b border-gray-100" onClick={() => setOpen(false)}><HelpCircle size={16} />{t("nav.help")}</Link>
          {isSeller && !isAdmin && (
            <Link href="/seller" className="flex items-center gap-3 text-[15px] text-amber-600 font-semibold py-2.5 border-b border-gray-100" onClick={() => setOpen(false)}><Store size={16} />{t("nav.seller")}</Link>
          )}
          {isAdmin && (
            <Link href="/admin" className="flex items-center gap-3 text-[15px] text-blue-600 font-semibold py-2.5 border-b border-gray-100" onClick={() => setOpen(false)}><Shield size={16} />{t("nav.admin")}</Link>
          )}
          {showUserUI && !isAdmin && !isSeller && (
            <Link href="/seller/apply" className="flex items-center gap-3 text-[15px] text-gray-700 py-2.5 border-b border-gray-100" onClick={() => setOpen(false)}><Store size={16} />{t("nav.becomeSeller")}</Link>
          )}
          {showUserUI && (
            <>
              <Link href="/wishlist" className="flex items-center gap-3 text-[15px] text-gray-700 py-2.5 border-b border-gray-100" onClick={() => setOpen(false)}><Heart size={16} />Wishlist</Link>
              <Link href="/garage" className="flex items-center gap-3 text-[15px] text-gray-700 py-2.5 border-b border-gray-100" onClick={() => setOpen(false)}><Car size={16} />Миний машинууд</Link>
            </>
          )}
          <Link href="/cart" className="flex items-center justify-between text-[15px] text-gray-700 py-2.5 border-b border-gray-100" onClick={() => setOpen(false)}>
            <span className="flex items-center gap-3"><ShoppingCart size={16} />{t("nav.cart")}</span>
            {showCartBadge && <span className="bg-blue-600 text-white text-[11px] px-2 py-0.5 rounded-full">{count}</span>}
          </Link>
          <div className="pt-3"><LangSwitcher /></div>
          {showUserUI ? (
            <div className="pt-3">
              <button onClick={() => { logout(); setOpen(false); }} className="w-full border border-red-200 text-red-500 rounded-lg py-2.5 text-[13px] cursor-pointer bg-transparent font-sans">
                <span className="inline-flex items-center gap-2 justify-center"><LogOut size={14} /> {t("nav.logout")}</span>
              </button>
            </div>
          ) : (
            <div className="pt-3 flex gap-2">
              <Link href="/auth/login" className="flex-1 border border-gray-200 rounded-lg py-2.5 text-[13px] text-gray-600 text-center" onClick={() => setOpen(false)}>{t("nav.login")}</Link>
              <Link href="/auth/register" className="flex-1 bg-blue-600 text-white rounded-lg py-2.5 text-[13px] font-medium text-center" onClick={() => setOpen(false)}>{t("nav.register")}</Link>
            </div>
          )}
        </div>
      )}
    </nav>
  );
}

/** Small helper for consistent dropdown rows. */
function DropdownLink({
  href, icon, onClick, children,
}: {
  href: string;
  icon: React.ReactNode;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className="flex items-center gap-2 px-3 py-2 text-[12px] text-gray-700 hover:bg-gray-50 transition-colors"
    >
      <span className="w-4 inline-flex items-center justify-center text-gray-400 shrink-0">
        {icon}
      </span>
      <span className="flex-1 truncate">{children}</span>
    </Link>
  );
}
