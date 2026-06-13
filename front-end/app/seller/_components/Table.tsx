"use client";

/**
 * Table primitives for the seller surface.
 *
 * <TableCard>  wraps a table in a white rounded card + overflow-x-auto so
 *              wide tables scroll horizontally on a phone instead of
 *              crushing or overflowing the viewport.
 * <Th>         standard header cell (bg handled by the parent <thead> row).
 *
 * Body-row + cell styling is applied directly in each page so existing
 * status pills / inline editors stay untouched, but the conventions are:
 *   header row : bg-gray-50 text-gray-500 text-[12px]
 *   body row   : border-b border-gray-100 hover:bg-gray-50
 *   cell       : px-4 py-2.5 text-[13px]  (numeric → text-right)
 */

export function TableCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white border border-gray-200 rounded-2xl overflow-hidden ${className}`}>
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}

export function Th({
  children,
  align = "left",
  className = "",
}: {
  children?: React.ReactNode;
  align?: "left" | "right" | "center";
  className?: string;
}) {
  const a = align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";
  return <th className={`${a} px-4 py-2.5 font-medium ${className}`}>{children}</th>;
}
