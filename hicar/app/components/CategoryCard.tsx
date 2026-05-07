import { ReactNode } from "react";

interface Props {
  icon: ReactNode;
  name: string;
  count: string;
}

export default function CategoryCard({ icon, name, count }: Props) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-3.5 text-center cursor-pointer hover:border-violet-600 hover:bg-violet-50 transition-all">
      <div className="w-8 h-8 bg-violet-50 rounded-lg flex items-center justify-center mx-auto mb-2">
        {icon}
      </div>
      <div className="text-[12px] font-medium text-gray-900">{name}</div>
      <div className="text-[11px] text-gray-400 mt-0.5">{count}</div>
    </div>
  );
}
