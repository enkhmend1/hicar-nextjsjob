"use client";

import { useEffect, useState } from "react";
import { ShoppingCart, User, Menu, X } from "lucide-react";
import Link from "next/link";

export default function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [user, setUser] = useState<{ name: string } | null>(null);

  // Load user
  useEffect(() => {
    const syncUser = () => {
      const storedUser = localStorage.getItem("user");
      setUser(storedUser ? JSON.parse(storedUser) : null);
    };

    syncUser();

    window.addEventListener("storage", syncUser);
    return () => window.removeEventListener("storage", syncUser);
  }, []);

  return (
    <nav className="bg-white border-b border-gray-200 sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between gap-5">

        {/* Logo */}
        <Link href="/" className="text-xl font-semibold tracking-tight shrink-0">
          <em className="text-violet-600 not-italic">Hi</em>car
        </Link>

        {/* Desktop links */}
        <div className="hidden md:flex gap-6">
          {["Каталог", "Захиалга", "Холбоо барих"].map((link) => (
            <a
              key={link}
              href="#"
              className="text-sm text-gray-500 hover:text-violet-600 transition-colors"
            >
              {link}
            </a>
          ))}
        </div>

        {/* Desktop actions */}
        <div className="hidden md:flex items-center gap-2">
          {user ? (
            <>
              <div className="flex items-center gap-2 border border-gray-300 rounded-xl px-4 py-2">
                <div className="w-8 h-8 rounded-full bg-violet-600 text-white flex items-center justify-center text-sm font-semibold">
                  {user.name.charAt(0)}
                </div>
                <span className="text-sm font-medium text-gray-700">
                  {user.name}
                </span>
              </div>

              <button
                onClick={() => {
                  localStorage.removeItem("user");
                  setUser(null);
                }}
                className="border border-red-300 text-red-500 hover:bg-red-50 rounded-xl px-4 py-2 text-sm"
              >
                Logout
              </button>

              <button className="relative p-2 text-gray-500 hover:text-violet-600">
                <ShoppingCart size={18} />
                <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-violet-600 text-white text-[9px] rounded-full flex items-center justify-center">
                  0
                </span>
              </button>
            </>
          ) : (
            <>
              <Link
                href="/auth/login"
                className="flex items-center gap-1.5 border border-gray-300 rounded-lg px-4 py-2 text-sm text-gray-500 hover:text-violet-600"
              >
                <User size={13} />
                Нэвтрэх
              </Link>

              <Link
                href="/auth/register"
                className="bg-violet-600 hover:bg-violet-900 text-white rounded-lg px-4 py-2 text-sm font-medium"
              >
                Бүртгүүлэх
              </Link>
            </>
          )}
        </div>

        {/* Mobile hamburger */}
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="md:hidden"
        >
          {menuOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>

      {/* MOBILE MENU */}
      {menuOpen && (
        <div className="md:hidden border-t border-gray-200 px-6 py-4 bg-white">
          {["Каталог", "Захиалга", "Холбоо барих"].map((link) => (
            <a
              key={link}
              href="#"
              className="block py-2 text-gray-500 border-b border-gray-100"
            >
              {link}
            </a>
          ))}

          <div className="mt-4 flex flex-col gap-3">
            {user ? (
              <>
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-violet-600 text-white flex items-center justify-center text-sm font-semibold">
                    {user.name.charAt(0)}
                  </div>
                  <span className="text-sm font-medium">{user.name}</span>
                </div>

                <button
                  onClick={() => {
                    localStorage.removeItem("user");
                    setUser(null);
                    setMenuOpen(false);
                  }}
                  className="border border-red-300 text-red-500 rounded-xl px-4 py-2 text-sm"
                >
                  Logout
                </button>

                <button className="flex items-center gap-2 text-gray-500">
                  <ShoppingCart size={18} />
                  Cart
                </button>
              </>
            ) : (
              <div className="flex gap-2">
                <Link
                  href="/auth/login"
                  className="border border-gray-300 rounded-lg px-4 py-2 text-sm text-gray-500"
                >
                  Нэвтрэх
                </Link>

                <Link
                  href="/auth/register"
                  className="bg-violet-600 text-white rounded-lg px-4 py-2 text-sm"
                >
                  Бүртгүүлэх
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
    </nav>
  );
}