const brands = [
  { name: "TOYOTA",     color: "#eb0a1e" },
  { name: "NISSAN",     color: "#c3002f" },
  { name: "HYUNDAI",    color: "#002c5f" },
  { name: "SUBARU",     color: "#0067b1" },
  { name: "HONDA",      color: "#cc0000" },
  { name: "MITSUBISHI", color: "#ed0000" },
];

export default function BrandsBar() {
  return (
    <div className="bg-white border-t border-b border-gray-200">
      <div className="max-w-6xl mx-auto px-6 flex items-center overflow-x-auto scrollbar-none">
        {brands.map((b) => (
          <div
            key={b.name}
            className="flex-1 min-w-[70px] flex items-center justify-center py-3.5 cursor-pointer opacity-40 hover:opacity-100 transition-opacity"
          >
            <span
              className="text-[11px] font-bold tracking-widest"
              style={{ color: b.color }}
            >
              {b.name}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
