"use client";

/**
 * Route-segment error boundary. Catches render/runtime errors thrown by
 * any page below the root layout and shows a recoverable fallback instead
 * of a blank screen. `reset()` re-renders the segment.
 *
 * Self-contained chrome (no Navbar/BuyerShell) so a fault in the shared
 * shell can't recurse through this boundary.
 */

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCcw, Home } from "lucide-react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface for debugging now; a future error-tracking hook lands here.
    console.error("[route-error]", error);
  }, [error]);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-5">
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm max-w-md w-full p-8 text-center">
        <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-amber-50 flex items-center justify-center">
          <AlertTriangle className="w-6 h-6 text-amber-500" />
        </div>
        <h1 className="text-lg font-semibold text-gray-900 mb-1">Алдаа гарлаа</h1>
        <p className="text-[13px] text-gray-500 mb-6">
          Уучлаарай, ямар нэг зүйл буруудлаа. Дахин оролдоно уу — асуудал
          үргэлжилбэл хэсэг хугацааны дараа дахин зочилно уу.
        </p>
        {error?.digest && (
          <p className="text-[11px] text-gray-400 mb-4">Код: {error.digest}</p>
        )}
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={reset}
            className="inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl px-4 py-2 text-[13px] font-medium transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
            Дахин оролдох
          </button>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 border border-gray-200 hover:bg-gray-50 text-gray-700 rounded-xl px-4 py-2 text-[13px] font-medium transition-colors"
          >
            <Home className="w-4 h-4" />
            Нүүр хуудас
          </Link>
        </div>
      </div>
    </div>
  );
}
