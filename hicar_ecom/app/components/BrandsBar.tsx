const BRANDS=[{n:"TOYOTA",c:"#eb0a1e"},{n:"NISSAN",c:"#c3002f"},{n:"HYUNDAI",c:"#002c5f"},{n:"SUBARU",c:"#0067b1"},{n:"HONDA",c:"#cc0000"},{n:"MITSUBISHI",c:"#ed0000"}];
export default function BrandsBar(){
  return(
    <div className="bg-white border-t border-b border-gray-100">
      <div className="max-w-6xl mx-auto px-5 flex overflow-x-auto scrollbar-none">
        {BRANDS.map(b=>(
          <div key={b.n} className="flex-1 min-w-[80px] flex items-center justify-center py-3 cursor-pointer opacity-35 hover:opacity-100 transition-all hover:bg-gray-50">
            <span className="text-[11px] font-black tracking-widest select-none" style={{color:b.c}}>{b.n}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
