import { ReactNode } from "react";

interface Props {
  icon: ReactNode;
  name: string;
  oem: string;
  price: string;
  badge?: string;
}

export default function ProductCard({ icon, name, oem, price, badge }: Props) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden cursor-pointer hover:border-violet-600 hover:shadow-md hover:shadow-violet-100 transition-all group">
      <div className="h-[90px] bg-violet-50 flex items-center justify-center group-hover:bg-violet-100 transition-colors">
        {icon}
      </div>
      <div className="p-3">
        <div className="text-[13px] font-medium text-gray-900 mb-0.5">{name}</div>
        <div className="text-[11px] text-gray-400 font-mono">{oem}</div>
        <div className="text-[14px] font-semibold text-violet-600 mt-1.5">{price}</div>
        <div className="text-[11px] text-emerald-600 mt-0.5">{badge ?? "✓ Japan OEM баталгаатай"}</div>
      </div>
    </div>
  );
}
