import { CheckCircle } from "lucide-react";

export default function AIBanner() {
  return (
    <div className="bg-violet-50 border border-violet-200 rounded-xl px-4 py-3.5 flex items-center gap-3 cursor-pointer hover:bg-violet-100 transition-colors">
      <div className="w-9 h-9 bg-white border border-violet-200 rounded-full flex items-center justify-center shrink-0">
        <CheckCircle size={16} className="text-violet-600" />
      </div>
      <div>
        <div className="text-[13px] font-medium text-gray-900">AI сэлбэг таних систем</div>
        <div className="text-[12px] text-gray-500 mt-0.5 hidden sm:block">
          Зураг оруулахад AI Japan сайтуудаас OEM дугаарыг хайж олно
        </div>
      </div>
      <span className="ml-auto text-gray-400 text-lg">→</span> 
      
    </div>
  );
}
