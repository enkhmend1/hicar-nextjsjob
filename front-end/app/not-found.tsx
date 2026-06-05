/**
 * 404 page. Rendered for unmatched routes and explicit notFound() calls.
 * Server component — no client JS needed.
 */

import Link from "next/link";
import { Home, Search } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-5">
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm max-w-md w-full p-8 text-center">
        <div className="text-5xl font-bold text-blue-600 mb-2">404</div>
        <h1 className="text-lg font-semibold text-gray-900 mb-1">
          Хуудас олдсонгүй
        </h1>
        <p className="text-[13px] text-gray-500 mb-6">
          Таны хайсан хуудас байхгүй, эсвэл өөр хаяг руу зөөгдсөн байна.
        </p>
        <div className="flex items-center justify-center gap-2">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl px-4 py-2 text-[13px] font-medium transition-colors"
          >
            <Home className="w-4 h-4" />
            Нүүр хуудас
          </Link>
          <Link
            href="/shop"
            className="inline-flex items-center gap-1.5 border border-gray-200 hover:bg-gray-50 text-gray-700 rounded-xl px-4 py-2 text-[13px] font-medium transition-colors"
          >
            <Search className="w-4 h-4" />
            Дэлгүүр үзэх
          </Link>
        </div>
      </div>
    </div>
  );
}
