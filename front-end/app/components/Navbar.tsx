"use client";
import { useState } from "react";
import Link from "next/link";
import { useCartStore, useAuthStore } from "@/store";
import { useT } from "@/lib/i18n";
import LangSwitcher from "./LangSwitcher";
import NotificationBell from "./NotificationBell";
import { ShoppingCart, User, Menu, X, Wallet, LogOut, Package, Shield, Store, Heart, Car } from "lucide-react";

export default function Navbar() {
  const [open, setOpen] = useState(false);
  const count = useCartStore(s => s.count());
  const { user, logout } = useAuthStore();
  const t = useT();
  const isAdmin = user?.role === "admin";
  const isSeller = user?.role === "seller" || user?.sellerStatus === "approved";

  return (
    <nav className="bg-white border-b border-gray-200 sticky top-0 z-50 shadow-sm">
      <div className="max-w-6xl mx-auto px-5 h-14 flex items-center justify-between gap-4">

        <Link href="/" className="text-[20px] font-semibold tracking-tight shrink-0" style={{ textDecoration: "none", color: "inherit" }}>
          <em className="text-violet-600 not-italic">Hi</em>car
        </Link>

        <div className="hidden md:flex gap-5">
          <Link href="/shop" className="text-[14px] text-gray-500 hover:text-violet-600 transition-colors" style={{ textDecoration: "none" }}>{t("nav.shop")}</Link>
          <Link href="/lookup" className="text-[14px] text-gray-500 hover:text-violet-600 transition-colors" style={{ textDecoration: "none" }}>Улсын дугаар</Link>
          <Link href="/orders" className="text-[14px] text-gray-500 hover:text-violet-600 transition-colors" style={{ textDecoration: "none" }}>{t("nav.orders")}</Link>
          <Link href="/#help" className="text-[14px] text-gray-500 hover:text-violet-600 transition-colors" style={{ textDecoration: "none" }}>{t("nav.help")}</Link>
          {isSeller && !isAdmin && (
            <Link href="/seller" className="flex items-center gap-1 text-[14px] text-fuchsia-600 font-semibold hover:underline transition-colors" style={{ textDecoration: "none" }}>
              <Store size={13} /> {t("nav.seller")}
            </Link>
          )}
          {isAdmin && (
            <Link href="/admin" className="flex items-center gap-1 text-[14px] text-violet-600 font-semibold hover:underline transition-colors" style={{ textDecoration: "none" }}>
              <Shield size={13} /> {t("nav.admin")}
            </Link>
          )}
          {user && !isAdmin && !isSeller && (
            <Link href="/seller/apply" className="text-[14px] text-gray-500 hover:text-fuchsia-600 transition-colors" style={{ textDecoration: "none" }}>
              {t("nav.becomeSeller")}
            </Link>
          )}
        </div>

        <div className="hidden md:flex items-center gap-2 shrink-0">
          <LangSwitcher compact />
          <NotificationBell />
          {user ? (
            <>
              <div className="flex items-center gap-1.5 bg-violet-50 border border-violet-200 rounded-lg px-3 py-1.5 text-[13px] text-violet-700 font-medium cursor-default">
                <Wallet size={13} /> ₮{user.walletBalance.toLocaleString()}
              </div>
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
              <Link href="/auth/login" className="border border-gray-200 rounded-lg px-4 py-1.5 text-[13px] text-gray-600 hover:border-violet-500 hover:text-violet-600 transition-colors" style={{ textDecoration: "none" }}>{t("nav.login")}</Link>
              <Link href="/auth/register" className="bg-violet-600 hover:bg-violet-700 text-white rounded-lg px-4 py-1.5 text-[13px] font-medium transition-colors" style={{ textDecoration: "none" }}>{t("nav.register")}</Link>
            </>
          )}
          {user && (
            <Link href="/wishlist" className="w-9 h-9 flex items-center justify-center rounded-lg text-gray-500 hover:text-red-500 hover:bg-red-50 transition-colors" style={{ textDecoration: "none" }} title="Wishlist">
              <Heart size={18} />
            </Link>
          )}
          <Link href="/cart" className="relative w-9 h-9 flex items-center justify-center rounded-lg text-gray-500 hover:text-violet-600 hover:bg-violet-50 transition-colors" style={{ textDecoration: "none" }}>
            <ShoppingCart size={19} />
            {count > 0 && (
              <span className="absolute top-0.5 right-0.5 min-w-[16px] h-4 bg-violet-600 text-white text-[9px] rounded-full flex items-center justify-center px-0.5 font-semibold">{count}</span>
            )}
          </Link>
        </div>

        <button onClick={() => setOpen(!open)} className="md:hidden p-1.5 cursor-pointer bg-transparent border-none text-gray-700 rounded-lg hover:bg-gray-100 transition-colors">
          {open ? <X size={21} /> : <Menu size={21} />}
        </button>
      </div>

      {open && (
        <div className="md:hidden bg-white border-t border-gray-100 px-5 pb-4 pt-3 shadow-lg">
          <Link href="/shop" className="flex items-center gap-3 text-[15px] text-gray-700 py-2.5 border-b border-gray-100" style={{ textDecoration: "none" }} onClick={() => setOpen(false)}><Package size={16} />{t("nav.shop")}</Link>
          <Link href="/orders" className="flex items-center gap-3 text-[15px] text-gray-700 py-2.5 border-b border-gray-100" style={{ textDecoration: "none" }} onClick={() => setOpen(false)}><Package size={16} />{t("nav.orders")}</Link>
          {isSeller && !isAdmin && (
            <Link href="/seller" className="flex items-center gap-3 text-[15px] text-fuchsia-600 font-semibold py-2.5 border-b border-gray-100" style={{ textDecoration: "none" }} onClick={() => setOpen(false)}><Store size={16} />{t("nav.seller")}</Link>
          )}
          {isAdmin && (
            <Link href="/admin" className="flex items-center gap-3 text-[15px] text-violet-600 font-semibold py-2.5 border-b border-gray-100" style={{ textDecoration: "none" }} onClick={() => setOpen(false)}><Shield size={16} />{t("nav.admin")}</Link>
          )}
          {user && !isAdmin && !isSeller && (
            <Link href="/seller/apply" className="flex items-center gap-3 text-[15px] text-gray-700 py-2.5 border-b border-gray-100" style={{ textDecoration: "none" }} onClick={() => setOpen(false)}><Store size={16} />{t("nav.becomeSeller")}</Link>
          )}
          {user && (
            <>
              <Link href="/wishlist" className="flex items-center gap-3 text-[15px] text-gray-700 py-2.5 border-b border-gray-100" style={{ textDecoration: "none" }} onClick={() => setOpen(false)}><Heart size={16} />Wishlist</Link>
              <Link href="/garage" className="flex items-center gap-3 text-[15px] text-gray-700 py-2.5 border-b border-gray-100" style={{ textDecoration: "none" }} onClick={() => setOpen(false)}><Car size={16} />Миний машинууд</Link>
            </>
          )}
          <Link href="/cart" className="flex items-center justify-between text-[15px] text-gray-700 py-2.5 border-b border-gray-100" style={{ textDecoration: "none" }} onClick={() => setOpen(false)}>
            <span className="flex items-center gap-3"><ShoppingCart size={16} />{t("nav.cart")}</span>
            {count > 0 && <span className="bg-violet-600 text-white text-[11px] px-2 py-0.5 rounded-full">{count}</span>}
          </Link>
          <div className="pt-3"><LangSwitcher /></div>
          {user ? (
            <div className="pt-3 flex gap-2">
              <div className="flex-1 bg-violet-50 border border-violet-200 rounded-lg py-2.5 text-[13px] text-violet-700 font-medium text-center">{user.name}</div>
              <button onClick={() => { logout(); setOpen(false); }} className="flex-1 border border-gray-200 rounded-lg py-2.5 text-[13px] text-gray-500 cursor-pointer bg-transparent font-sans">{t("nav.logout")}</button>
            </div>
          ) : (
            <div className="pt-3 flex gap-2">
              <Link href="/auth/login" className="flex-1 border border-gray-200 rounded-lg py-2.5 text-[13px] text-gray-600 text-center" style={{ textDecoration: "none" }} onClick={() => setOpen(false)}>{t("nav.login")}</Link>
              <Link href="/auth/register" className="flex-1 bg-violet-600 text-white rounded-lg py-2.5 text-[13px] font-medium text-center" style={{ textDecoration: "none" }} onClick={() => setOpen(false)}>{t("nav.register")}</Link>
            </div>
          )}
        </div>
      )}
    </nav>
  );
}
