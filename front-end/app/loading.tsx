/**
 * Root loading state — shown via Suspense while a route segment streams in.
 * Lightweight centered spinner; no client JS required.
 */

export default function Loading() {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center gap-3">
      <div
        className="w-9 h-9 rounded-full border-[3px] border-gray-200 border-t-blue-600 animate-spin"
        role="status"
        aria-label="Ачааллаж байна"
      />
      <p className="text-[13px] text-gray-500">Ачааллаж байна…</p>
    </div>
  );
}
