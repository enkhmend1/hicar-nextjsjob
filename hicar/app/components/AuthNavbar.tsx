"use client";

import Link from "next/link";

export default function AuthNavbar() {
  return (
    <div>
      <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between gap-5">
        {/* Logo */}
        <Link href="/" className="text-xl font-semibold tracking-tight shrink-0">
          <span>
            <em className="text-violet-600 not-italic">Hi</em>car
          </span>
        </Link>

        <div className="flex items-center gap-3">
          <Link
            href="/auth/login"
            className="flex items-center gap-1.5 border border-gray-300 rounded-lg px-4 py-2 text-sm text-gray-500 hover:border-violet-600 hover:text-violet-600 transition-colors"
          >
            Нэвтрэх
          </Link>

          <Link
            href="/auth/register"
            className="bg-violet-600 hover:bg-violet-900 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors"
          >
            Бүртгүүлэх
          </Link>
        </div>
      </div>
    </div>
  );
}