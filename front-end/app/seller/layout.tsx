"use client";
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuthStore } from "@/store";
import { LayoutDashboard, Package, ShoppingBag, BarChart3, Settings, LogOut, Home, AlertCircle, Clock } from "lucide-react";

const NAV = [
  { href: "/seller", label: "Хяналтын самбар", icon: LayoutDashboard, exact: true },
  { href: "/seller/analytics", label: "Аналитик", icon: BarChart3 },
  { href: "/seller/products", label: "Миний бараа", icon: Package },
  { href: "/seller/orders", label: "Захиалга", icon: ShoppingBag },
  { href: "/seller/profile", label: "Профайл", icon: Settings },
];

export default function SellerLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, logout, _hasHydrated } = useAuthStore();

  // Allow /seller/apply for any logged-in user (without sidebar chrome)
  const isApplyRoute = pathname === "/seller/apply";

  useEffect(() => {
    if (!_hasHydrated) return;
    if (!user) { router.replace("/auth/login"); return; }
    if (isApplyRoute) return;
    // Allow admin too (admins can view their own seller flow if they applied)
    if (!["seller", "admin"].includes(user.role || "")) {
      router.replace("/seller/apply");
    }
  }, [user, router, _hasHydrated, isApplyRoute]);

  if (!_hasHydrated) {
    return <div className="min-h-screen flex items-center justify-center text-gray-400 text-sm">Уншиж байна...</div>;
  }
  if (!user) return null;

  // Apply page renders without sidebar
  if (isApplyRoute) return <>{children}</>;

  // Not yet a seller — bounce to apply
  if (user.role === "user") {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <p className="text-gray-700 text-[14px] mb-3">Та эхлээд seller болохоор хүсэлт явуулах хэрэгтэй.</p>
          <Link href="/seller/apply" className="inline-block bg-violet-600 text-white rounded-xl px-5 py-2.5 text-[13px] font-semibold" style={{ textDecoration: "none" }}>
            Seller болох хүсэлт
          </Link>
        </div>
      </div>
    );
  }

  const pending = user.sellerStatus === "pending";
  const rejected = user.sellerStatus === "rejected";

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <aside className="hidden md:flex w-60 bg-white border-r border-gray-200 flex-col shrink-0">
        <div className="px-5 py-4 border-b border-gray-100">
          <Link href="/" className="text-[20px] font-semibold tracking-tight" style={{ textDecoration: "none", color: "inherit" }}>
            <em className="text-violet-600 not-italic">Hi</em>car
            <span className="ml-1.5 text-[10px] bg-fuchsia-100 text-fuchsia-700 px-1.5 py-0.5 rounded font-semibold align-middle">SELLER</span>
          </Link>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {NAV.map(n => {
            const active = n.exact ? pathname === n.href : pathname.startsWith(n.href);
            const Icon = n.icon;
            return (
              <Link key={n.href} href={n.href}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors ${
                  active ? "bg-fuchsia-50 text-fuchsia-700" : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                }`}
                style={{ textDecoration: "none" }}>
                <Icon size={15} />
                {n.label}
              </Link>
            );
          })}
        </nav>

        <div className="p-3 border-t border-gray-100 space-y-1">
          <Link href="/" className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] text-gray-500 hover:bg-gray-50 hover:text-gray-900 transition-colors" style={{ textDecoration: "none" }}>
            <Home size={15} /> Дэлгүүр рүү
          </Link>
          <div className="px-3 py-2 border-t border-gray-100 mt-2 pt-3">
            <div className="text-[12px] font-semibold text-gray-700 truncate">{user.sellerProfile?.shopName || user.name}</div>
            <div className="text-[11px] text-gray-400 truncate">{user.email}</div>
            <button onClick={() => { logout(); router.push("/"); }}
              className="mt-2 flex items-center gap-2 text-[12px] text-red-500 hover:text-red-600 cursor-pointer bg-transparent border-none p-0 font-sans">
              <LogOut size={12} /> Гарах
            </button>
          </div>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="md:hidden bg-white border-b border-gray-200 px-4 h-12 flex items-center justify-between">
          <Link href="/" className="text-[16px] font-semibold" style={{ textDecoration: "none", color: "inherit" }}>
            <em className="text-violet-600 not-italic">Hi</em>car <span className="text-[10px] text-fuchsia-600">SELLER</span>
          </Link>
          <div className="flex gap-1">
            {NAV.map(n => {
              const active = n.exact ? pathname === n.href : pathname.startsWith(n.href);
              const Icon = n.icon;
              return (
                <Link key={n.href} href={n.href}
                  className={`w-8 h-8 flex items-center justify-center rounded-lg ${active ? "bg-fuchsia-100 text-fuchsia-700" : "text-gray-500"}`}
                  style={{ textDecoration: "none" }}>
                  <Icon size={15} />
                </Link>
              );
            })}
          </div>
        </header>

        <main className="flex-1 p-4 md:p-6 overflow-x-hidden">
          {pending && (
            <div className="mb-4 flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-800 text-[13px] rounded-xl p-3">
              <Clock size={15} className="shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold mb-0.5">Хүсэлт хүлээгдэж байна</div>
                <div className="text-[12px]">Admin таны seller хүсэлтийг шалгах хүртэл бараа байршуулах боломжгүй.</div>
              </div>
            </div>
          )}
          {rejected && (
            <div className="mb-4 flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 text-[13px] rounded-xl p-3">
              <AlertCircle size={15} className="shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold mb-0.5">Хүсэлт татгалзагдсан</div>
                {user.sellerProfile?.rejectedReason && (
                  <div className="text-[12px]">Шалтгаан: {user.sellerProfile.rejectedReason}</div>
                )}
              </div>
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
