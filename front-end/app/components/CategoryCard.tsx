import {ReactNode} from "react";
interface P{icon:ReactNode;name:string;count:string;}
export default function CategoryCard({icon,name,count}:P){
  return(
    <div className="bg-white border border-gray-200 rounded-xl p-3 text-center cursor-pointer hover:border-blue-500 hover:bg-blue-50 hover:shadow-md hover:shadow-blue-100/40 transition-all group">
      <div className="w-9 h-9 bg-blue-50 group-hover:bg-blue-100 rounded-xl flex items-center justify-center mx-auto mb-2 transition-colors">{icon}</div>
      <div className="text-[12px] font-semibold text-gray-800">{name}</div>
      <div className="text-[10px] text-gray-400 mt-0.5">{count}</div>
    </div>
  );
}
