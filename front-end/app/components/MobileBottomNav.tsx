"use client";

/**
 * Mobile bottom navigation — Phase U.2.
 *
 * Sticky 5-icon bar pinned to the bottom of the viewport on screens
 * narrower than `md` (768px). The pattern every mobile marketplace
 * (AliExpress, Amazon Mobile, Shopee, Lazada) ships because:
 *
 *   • Mobile users navigate by THUMB — the bottom 1/3 of the screen
 *     is the easy reach zone. Putting the top-5 destinations down
 *     there cuts time-to-cart roughly in half vs hamburger menus.
 *   • Each tap target is independent — no menu open/close ceremony.
 *   • Active route is obvious (filled icon + colored label).
 *
 * Items (Mongolian buyer hierarchy):
 *   1. Нүүр          /
 *   2. Сэлбэгүүд     /shop
 *   3. Сагс          /cart   (badge with count)
 *   4. Машинууд      /garage
 *   5. Профайл       /orders OR /auth/login (depending on auth)
 *
 * Only rendered inside BuyerShell. Seller (/seller/*) and admin
 * (/admin/*) surfaces have their own layouts so they never see this.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuthStore, useCartStore } from "@/store";
import { Home, ShoppingCart, Car, User, Package2 } from "lucide-react";

interface NavItem {
  href:  string;
  label: string;
  icon:  typeof Home;
  /** True when the current path "belongs" to this tab. Uses startsWith
   *  for nested routes (e.g. /shop/[id] still highlights "Сэлбэгүүд"). */
  matches: (path: string) => boolean;
}

const ITEMS: NavItem[] = [
  { href: "/",       label: "Нүүр",      icon: Home,         matches: (p) => p === "/" },
  { href: "/shop",   label: "Сэлбэгүүд", icon: Package2,     matches: (p) => p.startsWith("/shop") },
  { href: "/cart",   label: "Сагс",      icon: ShoppingCart, matches: (p) => p === "/cart" || p.startsWith("/checkout") },
  { href: "/garage", label: "Машинууд",  icon: Car,          matches: (p) => p.startsWith("/garage") },
];

export default function MobileBottomNav() {
  const pathname = usePathname();
  // Phase O.4 hydration gate — same as Navbar — so cart badge + user
  // avatar don't pop in from nowhere on first paint.
  const cartCount = useCartStore((s) => s.count());
  const cartHydrated = useCartStore((s) => s._hasHydrated);
  const showCartBadge = cartHydrated && cartCount > 0;

  const { user, _hasHydrated: authHydrated } = useAuthStore();
  const showUserUI = authHydrated && !!user;

  // Profile slot: → /orders when logged in, → /auth/login when not.
  // Either way it's the "me" tab.
  const profileItem: NavItem = {
    href: showUserUI ? "/orders" : "/auth/login",
    label: showUserUI ? "Захиалга" : "Нэвтрэх",
    icon: User,
    matches: (p) => p.startsWith("/orders") || p.startsWith("/auth"),
  };

  const items = [...ITEMS, profileItem];

  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-gray-200 shadow-[0_-1px_8px_rgba(0,0,0,0.04)]"
      // Use safe-area-inset-bottom on iOS notch devices so the bar
      // doesn't sit under the home indicator.
      style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0px)" }}>
      <div className="flex items-stretch h-14">
        {items.map((item) => {
          const Icon = item.icon;
          const active = item.matches(pathname);
          const isCart = item.href === "/cart";
          return (
            <Link key={item.href} href={item.href}
              className={`flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors relative ${
                active ? "text-blue-700" : "text-gray-500 hover:text-gray-700"
              }`}>
              <div className="relative">
                <Icon size={18} strokeWidth={active ? 2.25 : 1.75}
                  fill={active && isCart ? "currentColor" : "none"} />
                {isCart && showCartBadge && (
                  <span className="absolute -top-1.5 -right-2 min-w-[16px] h-4 bg-amber-500 text-white text-[9px] rounded-full flex items-center justify-center px-0.5 font-bold leading-none">
                    {cartCount > 99 ? "99+" : cartCount}
                  </span>
                )}
              </div>
              <span className={`text-[10px] leading-none ${active ? "font-semibold" : "font-medium"}`}>
                {item.label}
              </span>
              {/* Active indicator pill at the top edge of the active tab */}
              {active && (
                <span className="absolute top-0 inset-x-6 h-0.5 rounded-b-full bg-blue-700" />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
