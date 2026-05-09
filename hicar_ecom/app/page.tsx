import Link from "next/link";
import Navbar from "./components/Navbar";
import SearchCard from "./components/SearchCard";
import BrandsBar from "./components/BrandsBar";
import CategoryCard from "./components/CategoryCard";
import ProductCard from "./components/ProductCard";
import AIBanner from "./components/AIBanner";
import { PRODUCTS, CATEGORIES } from "@/lib/data";
import { Shield, Truck, Clock, Star } from "lucide-react";

function CatIcon({d}:{d:string}){
  return <svg className="w-4 h-4 fill-violet-600" viewBox="0 0 24 24"><path d={d}/></svg>;
}

export default function Home(){
  return(
    <>
      <Navbar/>
      {/* HERO */}
      <section className="hero-bg px-5 pt-10 pb-8">
        <div className="max-w-6xl mx-auto">
          <div className="inline-flex items-center gap-1.5 bg-violet-100 text-violet-600 text-[11px] font-semibold px-3 py-1.5 rounded-full mb-5 tracking-wide">
            <span className="w-1.5 h-1.5 rounded-full bg-violet-600"/>AI POWERED SEARCH
          </div>
          <h1 className="text-[clamp(28px,5vw,46px)] font-semibold text-gray-900 leading-[1.15] tracking-tight mb-3">
            Машиндаа яг таарах<br/>
            сэлбэгийг <em className="text-violet-600 not-italic">AI</em>-аар<br/>
            хурдан ол.
          </h1>
          <p className="text-[15px] text-gray-500 leading-relaxed mb-6 max-w-md">
            Улсын дугаараар машинаа тодорхойлоод — Japan OEM нийлүүлэгчдээс шууд захиал.
          </p>
          <div className="flex flex-wrap gap-3 mb-4">
            {[{icon:<Shield size={13}/>,text:"Japan OEM баталгаа"},{icon:<Truck size={13}/>,text:"7–14 хоногт хүргэнэ"},{icon:<Star size={13}/>,text:"5,200+ бараа"}].map(({icon,text})=>(
              <div key={text} className="flex items-center gap-1.5 text-[12px] text-gray-600 bg-white border border-gray-200 rounded-full px-3 py-1.5">
                <span className="text-violet-500">{icon}</span>{text}
              </div>
            ))}
          </div>
          <div className="flex gap-2.5 mb-8">
            <Link href="/auth/register" className="bg-violet-600 hover:bg-violet-700 text-white rounded-xl px-6 py-2.5 text-[14px] font-semibold transition-colors" style={{textDecoration:"none"}}>Бүртгүүлэх</Link>
            <Link href="/shop" className="border border-gray-300 hover:border-violet-500 hover:text-violet-600 text-gray-700 rounded-xl px-6 py-2.5 text-[14px] transition-colors" style={{textDecoration:"none"}}>Дэлгүүр үзэх</Link>
          </div>
          <SearchCard/>
        </div>
      </section>

      <BrandsBar/>

      <div className="max-w-6xl mx-auto px-5 py-7 space-y-8">
        {/* Categories */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[16px] font-semibold text-gray-900">Ангилал</h2>
            <Link href="/shop" className="text-[13px] text-violet-600 hover:underline font-medium" style={{textDecoration:"none"}}>Бүгдийг харах →</Link>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {CATEGORIES.filter(c=>c.id!=="all").map(c=>(
              <Link key={c.id} href={`/shop?cat=${c.id}`} style={{textDecoration:"none"}}>
                <CategoryCard name={c.name} count={`${c.count.toLocaleString()} зүйл`} icon={<CatIcon d={c.icon}/>}/>
              </Link>
            ))}
          </div>
        </div>

        {/* Products */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[16px] font-semibold text-gray-900">Онцлох бараа</h2>
            <Link href="/shop" className="text-[13px] text-violet-600 hover:underline font-medium" style={{textDecoration:"none"}}>Бүгдийг харах →</Link>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {PRODUCTS.slice(0,8).map(p=><ProductCard key={p.id} p={p}/>)}
          </div>
        </div>

        <AIBanner/>

        {/* Trust */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            {icon:<Shield size={20}/>,title:"OEM Баталгаа",desc:"Бүх бараа оригинал OEM чанарын гэрчилгээтэй"},
            {icon:<Truck size={20}/>,title:"Хурдан хүргэлт",desc:"Японоос 7–14 хоногт Улаанбаатар хүргэнэ"},
            {icon:<Clock size={20}/>,title:"7/24 Дэмжлэг",desc:"Техникийн асуудлаар манай багт хандана уу"},
          ].map(({icon,title,desc})=>(
            <div key={title} className="bg-white border border-gray-200 rounded-xl p-4 flex gap-3 items-start">
              <div className="w-9 h-9 bg-violet-50 rounded-xl flex items-center justify-center shrink-0 text-violet-600">{icon}</div>
              <div><div className="text-[13px] font-semibold text-gray-900 mb-0.5">{title}</div><div className="text-[12px] text-gray-500 leading-relaxed">{desc}</div></div>
            </div>
          ))}
        </div>
      </div>

      <footer className="bg-white border-t border-gray-200 mt-4">
        <div className="max-w-6xl mx-auto px-5 py-5 flex flex-wrap items-center justify-between gap-3">
          <span className="text-[18px] font-semibold"><em className="text-violet-600 not-italic">Hi</em>car</span>
          <div className="flex flex-wrap gap-5">
            {["Тусламж","Хүргэлт","Буцаалт","Бидний тухай"].map(l=>(
              <a key={l} href="#" className="text-[13px] text-gray-400 hover:text-violet-600 transition-colors" style={{textDecoration:"none"}}>{l}</a>
            ))}
          </div>
          <div className="text-[12px] text-gray-400">© 2025 HiCar MN</div>
        </div>
      </footer>
    </>
  );
}
