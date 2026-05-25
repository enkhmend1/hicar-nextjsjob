"use client";
import { useState } from "react";
import Link from "next/link";
import { useCartStore, useAuthStore } from "@/store";
import { useT } from "@/lib/i18n";
import LangSwitcher from "./LangSwitcher";
import NotificationBell from "./NotificationBell";
import { ShoppingCart, User, Menu, X, LogOut, Package, Shield, Store, Heart, Car } from "lucide-react";

export default function Navbar() {
  const [open, setOpen] = useState(false);
  // Phase O.4: gate the cart badge on `_hasHydrated` to avoid an SSR
  // hydration mismatch. Server renders items=[] (no localStorage), the
  // client rehydrates from localStorage and may show count > 0 → React
  // logs "server HTML didn't match client" because the <span> appears
  // from nowhere. We render the badge only after the persisted state
  // is loaded — same pattern as useAuthStore._hasHydrated.
  const count = useCartStore(s => s.count());
  const cartHydrated = useCartStore(s => s._hasHydrated);
  const showCartBadge = cartHydrated && count > 0;
  const { user, logout, _hasHydrated: authHydrated } = useAuthStore();
  const t = useT();
  // Same-pattern gate for user-dependent UI (login/register vs avatar+
  // logout, seller/admin nav badges). Before hydration completes we
  // render the SSR-matching "anonymous" shell, then swap in the
  // logged-in view after the persisted token rehydrates.
  const showUserUI = authHydrated && !!user;
  const isAdmin  = showUserUI && user?.role === "admin";
  const isSeller = showUserUI && (user?.role === "seller" || user?.sellerStatus === "approved");

  return (
    <nav className="bg-white border-b border-gray-200 sticky top-0 z-50 shadow-sm">
      <div className="max-w-6xl mx-auto px-5 h-14 flex items-center justify-between gap-4">

        <Link href="/" className="text-[20px] font-semibold tracking-tight shrink-0">
          <em className="text-blue-600 not-italic">Hi</em>car
        </Link>

        <div className="hidden md:flex gap-5">
          <Link href="/shop" className="text-[14px] text-gray-500 hover:text-blue-600 transition-colors">{t("nav.shop")}</Link>
          <Link href="/lookup" className="text-[14px] text-gray-500 hover:text-blue-600 transition-colors">Улсын дугаар</Link>
          <Link href="/orders" className="text-[14px] text-gray-500 hover:text-blue-600 transition-colors">{t("nav.orders")}</Link>
          <Link href="/#help" className="text-[14px] text-gray-500 hover:text-blue-600 transition-colors">{t("nav.help")}</Link>
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
          {showUserUI && !isAdmin && !isSeller && (
            <Link href="/seller/apply" className="text-[14px] text-gray-500 hover:text-amber-600 transition-colors">
              {t("nav.becomeSeller")}
            </Link>
          )}
        </div>

        <div className="hidden md:flex items-center gap-2 shrink-0">
          <LangSwitcher compact />
          <NotificationBell />
          {showUserUI ? (
            <>
              <div className="flex items-center gap-1.5 border border-gray-200 rounded-lg px-3 py-1.5 text-[13px] text-gray-600">
                <User size={13} />{user.name.split(" ")[0]}
              </div>
              <button onClick={logout} title={t("nav.logout")}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-red-400 hover:bg-red-50 transition-colors cursor-pointer bg-transparent border-none">
                <LogOut size={15} />
              </button>
            </>
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

        <button onClick={() => setOpen(!open)} className="md:hidden p-1.5 cursor-pointer bg-transparent border-none text-gray-700 rounded-lg hover:bg-gray-100 transition-colors">
          {open ? <X size={21} /> : <Menu size={21} />}
        </button>
      </div>

      {open && (
        <div className="md:hidden bg-white border-t border-gray-100 px-5 pb-4 pt-3 shadow-lg">
          <Link href="/shop" className="flex items-center gap-3 text-[15px] text-gray-700 py-2.5 border-b border-gray-100" onClick={() => setOpen(false)}><Package size={16} />{t("nav.shop")}</Link>
          <Link href="/orders" className="flex items-center gap-3 text-[15px] text-gray-700 py-2.5 border-b border-gray-100" onClick={() => setOpen(false)}><Package size={16} />{t("nav.orders")}</Link>
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
            <div className="pt-3 flex gap-2">
              <div className="flex-1 bg-blue-50 border border-blue-200 rounded-lg py-2.5 text-[13px] text-blue-700 font-medium text-center">{user.name}</div>
              <button onClick={() => { logout(); setOpen(false); }} className="flex-1 border border-gray-200 rounded-lg py-2.5 text-[13px] text-gray-500 cursor-pointer bg-transparent font-sans">{t("nav.logout")}</button>
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
