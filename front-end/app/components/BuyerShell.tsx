"use client";

/**
 * BuyerShell — Phase U.1.
 *
 * The shared chrome for every BUYER-surface page:
 *   • Top: Navbar
 *   • Bottom (mobile): MobileBottomNav (sticky 5-icon tab bar)
 *   • Bottom (footer): dark marketplace footer with payment + help links
 *
 * Why a shell component instead of a route-group layout:
 *   • Avoids moving 10 page files into app/(buyer)/, which would force
 *     every existing /shop, /cart, /garage URL through an invisible
 *     route-group segment + rebuild every import path.
 *   • Pages opt in by wrapping their content in <BuyerShell>{...}</BuyerShell>,
 *     so seller (/seller/*) and admin (/admin/*) pages — which have
 *     their own self-contained sidebar layouts — never accidentally
 *     pick up buyer chrome.
 *   • Padding-bottom on mobile so the bottom tab bar doesn't cover
 *     page content (54px h-bar + iOS safe-area inset).
 *
 * Auth pages (/auth/*) also skip this shell — they have a centered,
 * minimal layout that doesn't need the marketplace chrome.
 */

import Link from "next/link";
import { useT } from "@/lib/i18n";
import Navbar from "./Navbar";
import MobileBottomNav from "./MobileBottomNav";
import CartDrawer from "./CartDrawer";

export default function BuyerShell({ children }: { children: React.ReactNode }) {
  const t = useT();
  return (
    <>
      <Navbar />

      {/* Mobile bottom padding = 56px MobileBottomNav + iOS safe-area
          inset, so content is never hidden behind the tab bar on notch
          devices. md:pb-0 on desktop where the bottom nav is hidden. */}
      <main className="pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">
        {children}
      </main>

      {/* Site-wide footer — was previously inline on app/page.tsx only,
          so every other buyer page rendered without it. Hoisted here
          so /shop, /cart, /garage etc. all get the same trust-building
          chrome at the bottom of the scroll. */}
      <footer className="bg-gray-900 text-gray-300 mt-8 hidden md:block">
        <div className="max-w-6xl mx-auto px-5 py-10">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-8">
            <div className="col-span-2 md:col-span-1">
              <div className="text-[22px] font-semibold text-white mb-3">
                <em className="text-amber-400 not-italic">Hi</em>car
              </div>
              <p className="text-[12px] text-gray-400 leading-relaxed mb-4 max-w-xs">
                {t("home.subtitle")}
              </p>
              <div className="flex gap-2 text-[10px] text-gray-500">
                <span className="bg-gray-800 border border-gray-700 px-2 py-1 rounded">QPay</span>
                <span className="bg-gray-800 border border-gray-700 px-2 py-1 rounded">Khan Bank</span>
                <span className="bg-gray-800 border border-gray-700 px-2 py-1 rounded">Golomt</span>
              </div>
            </div>

            <div>
              <div className="text-[12px] font-semibold text-white mb-3 uppercase tracking-wider">{t("home.footerHelp")}</div>
              <ul className="space-y-2 text-[13px]">
                <li><Link href="/shop"   className="text-gray-400 hover:text-amber-400 transition-colors">{t("nav.shop")}</Link></li>
                <li><Link href="/lookup" className="text-gray-400 hover:text-amber-400 transition-colors">Улсын дугаар</Link></li>
                <li><Link href="/orders" className="text-gray-400 hover:text-amber-400 transition-colors">{t("nav.orders")}</Link></li>
                <li><Link href="/garage" className="text-gray-400 hover:text-amber-400 transition-colors">Миний машинууд</Link></li>
                <li><Link href="/help"   className="text-gray-400 hover:text-amber-400 transition-colors">{t("nav.help")}</Link></li>
              </ul>
            </div>

            <div>
              <div className="text-[12px] font-semibold text-white mb-3 uppercase tracking-wider">{t("home.footerAbout")}</div>
              <ul className="space-y-2 text-[13px]">
                <li><Link href="/help#shipping" className="text-gray-400 hover:text-amber-400 transition-colors">{t("home.footerShipping")}</Link></li>
                <li><Link href="/help#returns" className="text-gray-400 hover:text-amber-400 transition-colors">{t("home.footerReturn")}</Link></li>
                <li><Link href="/seller/apply" className="text-gray-400 hover:text-amber-400 transition-colors">{t("nav.becomeSeller")}</Link></li>
              </ul>
            </div>

            <div>
              <div className="text-[12px] font-semibold text-white mb-3 uppercase tracking-wider">Холбоо барих</div>
              <ul className="space-y-2 text-[13px] text-gray-400">
                <li>📞 +976 7700-0000</li>
                <li>✉ info@hicar.mn</li>
                <li>📍 Улаанбаатар</li>
              </ul>
            </div>
          </div>

          <div className="pt-6 border-t border-gray-800 flex flex-wrap items-center justify-between gap-3 text-[11px] text-gray-500">
            <span>© 2026 HiCar MN. Бүх эрх хуулиар хамгаалагдсан.</span>
            <span>OEM-баталгаатай авто сэлбэгийн платформ</span>
          </div>
        </div>
      </footer>

      {/* Mobile bottom tab bar — sticky, hidden md+ */}
      <MobileBottomNav />

      {/* Phase Y: cart slide-out drawer. Mounted once at the shell
          level so any page can fire openCartDrawer() and have the
          right-slide panel appear. Triggered from:
            • ProductCard add-to-cart (after-add peek + checkout flow)
            • Navbar cart icon (desktop/mobile both) */}
      <CartDrawer />
    </>
  );
}
