import {Sparkles} from "lucide-react";
export default function AIBanner(){
  return(
    <div className="relative overflow-hidden bg-gradient-to-r from-violet-600 to-purple-600 rounded-2xl p-5 flex items-center gap-4 cursor-pointer hover:from-violet-700 hover:to-purple-700 transition-all shadow-lg shadow-violet-200">
      <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center shrink-0">
        <Sparkles size={18} className="text-white"/>
      </div>
      <div className="flex-1">
        <div className="text-[14px] font-semibold text-white">AI сэлбэг таних систем</div>
        <div className="text-[12px] text-violet-200 mt-0.5">Зураг оруулахад AI Japan OEM дугаарыг тодорхойлж олно</div>
      </div>
      <span className="text-white/70 text-xl">→</span>
      <div className="absolute -right-6 -top-6 w-24 h-24 bg-white/5 rounded-full"/>
      <div className="absolute -right-2 -bottom-4 w-16 h-16 bg-white/5 rounded-full"/>
    </div>
  );
}
