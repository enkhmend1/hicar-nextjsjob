"use client";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuthStore } from "@/store";
import NotificationBell from "@/app/components/NotificationBell";
import { useBackClose } from "@/app/lib/useBackClose";
import { LayoutDashboard, Package, ShoppingBag, Users, Store, LogOut, Home, Brain, Scale, LayoutTemplate, Sparkles, UploadCloud, Receipt, Lightbulb, LifeBuoy, Menu, X } from "lucide-react";

const NAV = [
  { href: "/admin", label: "Хяналтын самбар", icon: LayoutDashboard, exact: true },
  { href: "/admin/products", label: "Бараа", icon: Package },
  { href: "/admin/orders", label: "Захиалга", icon: ShoppingBag },
  { href: "/admin/disputes", label: "Маргаан", icon: Scale },
  { href: "/admin/support", label: "Тусламжийн хүсэлт", icon: LifeBuoy },
  { href: "/admin/audit", label: "Санхүүгийн лог", icon: Receipt },
  { href: "/admin/import", label: "Импорт", icon: UploadCloud },
  { href: "/admin/normalization", label: "Нормчлол", icon: Sparkles },
  { href: "/admin/sellers", label: "Seller", icon: Store },
  { href: "/admin/users", label: "Хэрэглэгч", icon: Users },
  { href: "/admin/site-content", label: "Сайтын контент", icon: LayoutTemplate },
  { href: "/admin/ai-insights", label: "AI дүгнэлт", icon: Lightbulb },
  { href: "/admin/training", label: "AI сургалт", icon: Brain },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, logout, _hasHydrated } = useAuthStore();
  // Mobile nav drawer — replaces the old crammed icon row.
  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => { setNavOpen(false); }, [pathname]);
  // Phone / browser BACK button closes the mobile nav drawer.
  useBackClose(navOpen, () => setNavOpen(false));

  useEffect(() => {
    if (!_hasHydrated) return; // wait for zustand persist to load from localStorage
    if (!user) { router.replace("/auth/login"); return; }
    if (user.role !== "admin") { router.replace("/"); }
  }, [user, router, _hasHydrated]);

  if (!_hasHydrated || !user || user.role !== "admin") {
    return <div className="min-h-screen flex items-center justify-center text-gray-400 text-sm">Уншиж байна...</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <aside className="hidden md:flex w-60 bg-white border-r border-gray-200 flex-col shrink-0">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-2">
          <Link href="/" className="text-[20px] font-semibold tracking-tight">
            <em className="text-blue-600 not-italic">Hi</em>car
            <span className="ml-1.5 text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-semibold align-middle">ADMIN</span>
          </Link>
          <NotificationBell align="left" />
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {NAV.map(n => {
            const active = n.exact ? pathname === n.href : pathname.startsWith(n.href);
            const Icon = n.icon;
            return (
              <Link key={n.href} href={n.href}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors ${
                  active ? "bg-blue-50 text-blue-700" : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                }`}
               >
                <Icon size={15} />
                {n.label}
              </Link>
            );
          })}
        </nav>

        <div className="p-3 border-t border-gray-100 space-y-1">
          <Link href="/" className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] text-gray-500 hover:bg-gray-50 hover:text-gray-900 transition-colors">
            <Home size={15} /> Дэлгүүр рүү
          </Link>
          <div className="px-3 py-2 border-t border-gray-100 mt-2 pt-3">
            <div className="text-[12px] font-semibold text-gray-700 truncate">{user.name}</div>
            <div className="text-[11px] text-gray-400 truncate">{user.email}</div>
            <button onClick={() => { logout(); router.push("/"); }}
              className="mt-2 flex items-center gap-2 text-[12px] text-red-500 hover:text-red-600 cursor-pointer bg-transparent border-none p-0 font-sans">
              <LogOut size={12} /> Гарах
            </button>
          </div>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="md:hidden sticky top-0 z-30 bg-white border-b border-gray-200 px-3 h-14 flex items-center justify-between">
          <Link href="/admin" className="text-[16px] font-semibold pl-1">
            <em className="text-blue-600 not-italic">Hi</em>car <span className="ml-1 text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-semibold align-middle">ADMIN</span>
          </Link>
          <div className="flex items-center gap-1">
            <NotificationBell align="right" />
            <button onClick={() => setNavOpen(true)} aria-label="Цэс"
              className="w-9 h-9 flex items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 cursor-pointer bg-transparent border-none">
              <Menu size={20} />
            </button>
          </div>
        </header>

        {/* Mobile nav drawer — labeled items, identity + logout. */}
        {navOpen && (
          <div className="md:hidden fixed inset-0 z-50">
            <div className="absolute inset-0 bg-black/40" onClick={() => setNavOpen(false)} />
            <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-white shadow-2xl flex flex-col animate-in slide-in-from-left duration-200">
              <div className="px-4 h-14 flex items-center justify-between border-b border-gray-100 shrink-0">
                <span className="text-[16px] font-semibold">
                  <em className="text-blue-600 not-italic">Hi</em>car <span className="text-[10px] text-blue-600 font-semibold">ADMIN</span>
                </span>
                <button onClick={() => setNavOpen(false)} aria-label="Хаах"
                  className="w-9 h-9 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 cursor-pointer bg-transparent border-none">
                  <X size={18} />
                </button>
              </div>
              <nav className="flex-1 overflow-y-auto p-3 space-y-1">
                {NAV.map(n => {
                  const active = n.exact ? pathname === n.href : pathname.startsWith(n.href);
                  const Icon = n.icon;
                  return (
                    <Link key={n.href} href={n.href} onClick={() => setNavOpen(false)}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-[14px] font-medium transition-colors ${
                        active ? "bg-blue-50 text-blue-700" : "text-gray-700 hover:bg-gray-50"
                      }`}>
                      <Icon size={17} /> {n.label}
                    </Link>
                  );
                })}
              </nav>
              <div className="p-3 border-t border-gray-100 shrink-0">
                <Link href="/" onClick={() => setNavOpen(false)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-[14px] text-gray-600 hover:bg-gray-50">
                  <Home size={17} /> Дэлгүүр рүү
                </Link>
                <div className="px-3 pt-3 mt-2 border-t border-gray-100">
                  <div className="text-[13px] font-semibold text-gray-800 truncate">{user.name}</div>
                  <div className="text-[11px] text-gray-500 truncate mb-2">{user.email}</div>
                  <button onClick={() => { logout(); router.push("/"); }}
                    className="flex items-center gap-2 text-[13px] text-red-500 hover:text-red-600 cursor-pointer bg-transparent border-none p-0 font-sans">
                    <LogOut size={14} /> Гарах
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        <main className="flex-1 p-4 md:p-6 overflow-x-hidden">{children}</main>
      </div>
    </div>
  );
}
