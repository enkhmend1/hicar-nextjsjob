import Navbar from "./components/Navbar";
import SearchCard from "./components/SearchCard";
import BrandsBar from "./components/BrandsBar";
import CategoryCard from "./components/CategoryCard";
import ProductCard from "./components/ProductCard";
import AIBanner from "./components/AIBanner";
import Hero from "./components/Hero";
import HiCarAIChatUI from "./components/HiCarAIChatUI";


function Icon({ d }: { d: string }) {
  return (
    <svg className="w-4 h-4 fill-violet-600" viewBox="0 0 24 24"><path d={d} /></svg>
  );
}
function LgIcon({ d }: { d: string }) {
  return (
    <svg className="w-8 h-8 fill-violet-600" viewBox="0 0 24 24"><path d={d} /></svg>
  );
}

const CATEGORIES = [
  { name: "Хөдөлгүүр",   count: "1,240 зүйл", d: "M13 2v8h8c0-4.42-3.58-8-8-8zm-2 0C6.48 2.05 3 5.56 3 10c0 4.97 4.03 9 9 9s9-4.03 9-9h-9V2z" },
  { name: "Тоормос",      count: "860 зүйл",   d: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm0-14c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6zm0 10c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4z" },
  { name: "Гэрэлтүүлэг", count: "520 зүйл",   d: "M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7z" },
  { name: "Хөргөлт",     count: "430 зүйл",   d: "M17 8C8 10 5.9 16.17 3.82 21.34L5.71 22l1-2.3A4.49 4.49 0 008 20c3 0 3-2 6-2s3 2 6 2v-2c-3 0-3-2-6-2-.52 0-.96.03-1.39.08C13.77 13.23 15.71 10.72 17 8zm0-4v3l3-3H17z" },
  { name: "Цахилгаан",   count: "670 зүйл",   d: "M15.67 4H14V2h-4v2H8.33C7.6 4 7 4.6 7 5.33v15.33C7 21.4 7.6 22 8.33 22h7.33c.74 0 1.34-.6 1.34-1.33V5.33C17 4.6 16.4 4 15.67 4z" },
  { name: "Бие дарц",    count: "390 зүйл",   d: "M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99z" },
  { name: "Дугуй",       count: "310 зүйл",   d: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm0-12.5c-2.49 0-4.5 2.01-4.5 4.5S9.51 16.5 12 16.5s4.5-2.01 4.5-4.5S14.49 7.5 12 7.5zm0 5.5c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1z" },
  { name: "Дамжуулга",   count: "780 зүйл",   d: "M22 9V7h-2V5c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-2h2v-2h-2v-2h2v-2h-2V9h2zm-4 10H4V5h14v14z" },
];

const PRODUCTS = [
  { name: "Тоормосны диск (урд)",  oem: "OEM: 43512-12440", price: "₮ 48,000", d: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm0-12.5c-2.49 0-4.5 2.01-4.5 4.5S9.51 16.5 12 16.5s4.5-2.01 4.5-4.5S14.49 7.5 12 7.5z" },
  { name: "Мастер цилиндр",        oem: "OEM: 47201-02260", price: "₮ 92,000", d: "M13 2v8h8c0-4.42-3.58-8-8-8zm-2 0C6.48 2.05 3 5.56 3 10c0 4.97 4.03 9 9 9s9-4.03 9-9h-9V2z" },
  { name: "Гэрлийн залгуур",       oem: "OEM: 81130-47300", price: "₮ 24,500", d: "M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7z" },
  { name: "КПП тосны шахуурга",    oem: "OEM: 15100-28040", price: "₮ 36,000", d: "M22 9V7h-2V5c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-2h2v-2h-2v-2h2v-2h-2V9h2zm-4 10H4V5h14v14z" },
  { name: "Мэдрэгч холбогч",       oem: "OEM: 90980-11451", price: "₮ 18,500", d: "M15.67 4H14V2h-4v2H8.33C7.6 4 7 4.6 7 5.33v15.33C7 21.4 7.6 22 8.33 22h7.33c.74 0 1.34-.6 1.34-1.33V5.33C17 4.6 16.4 4 15.67 4z" },
  { name: "Цацагч шүүр",           oem: "OEM: 17801-21050", price: "₮ 12,000", d: "M17 8C8 10 5.9 16.17 3.82 21.34L5.71 22l1-2.3A4.49 4.49 0 008 20c3 0 3-2 6-2s3 2 6 2v-2c-3 0-3-2-6-2-.52 0-.96.03-1.39.08C13.77 13.23 15.71 10.72 17 8zm0-4v3l3-3H17z" },
];

export default function Home() {
  return (
    <>
      <Navbar />
      <Hero/> 
      <HiCarAIChatUI/>
      {/* HERO */}
      {/* <section className="hero-gradient px-6 pt-12 pb-9">
        <div className="max-w-6xl mx-auto">
          <div className="inline-flex items-center gap-1.5 bg-violet-100 text-violet-600 text-[11px] font-medium px-3 py-1 rounded-full mb-5">
            <span className="w-1.5 h-1.5 rounded-full bg-violet-600 inline-block" />
            AI-д суурилсан хайлт
          </div>
          <h1 className="text-4xl sm:text-5xl font-semibold text-gray-900 leading-tight tracking-tight mb-3">
            Машиндаа яг таарах<br />
            сэлбэгийг <em className="text-violet-600 not-italic">AI</em>-аар<br />
            хурдан ол.
          </h1>
          <p className="text-[15px] text-gray-500 leading-relaxed mb-7 max-w-lg">
            Марк, загвар, он оруулаад л —  AI шийдэн сэлбэгийг Японоос хайж олно.
          </p>
          <div className="flex flex-col sm:flex-row gap-2.5 mb-9">
            <button className="bg-violet-600 hover:bg-violet-700 text-white rounded-lg px-6 py-2.5 text-sm font-medium transition-colors cursor-pointer font-sans">
              Нэвтрэх
            </button>
            <button className="border border-gray-300 hover:border-violet-600 hover:text-violet-600 text-gray-700 rounded-lg px-6 py-2.5 text-sm transition-colors cursor-pointer font-sans bg-transparent">
              Бүртгүүлэх
            </button>
          </div>
          <SearchCard />
        </div>
      </section> */}

      <BrandsBar />

      {/* CONTENT */}
      <div className="max-w-6xl mx-auto px-6 py-7 space-y-7">
        {/* Categories */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[15px] font-semibold text-gray-900">Ангилал</h2>
            <a href="#" className="text-[13px] text-violet-600 hover:underline">Бүгдийг харах →</a>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {CATEGORIES.map((cat) => (
              <CategoryCard key={cat.name} name={cat.name} count={cat.count} icon={<Icon d={cat.d} />} />
            ))}
          </div>
        </div>

        {/* Products */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[15px] font-semibold text-gray-900">Шинэ бараа</h2>
            <a href="#" className="text-[13px] text-violet-600 hover:underline">Бүгдийг харах →</a>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {PRODUCTS.map((p) => (
              <ProductCard key={p.oem} name={p.name} oem={p.oem} price={p.price} icon={<LgIcon d={p.d} />} />
            ))}
          </div>
        </div>

        <AIBanner />
      </div>

      {/* FOOTER */}
      <footer className="bg-white border-t border-gray-200 mt-2">
        <div className="max-w-6xl mx-auto px-6 py-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-5">
            {["Тусламж", "Хүргэлт", "Буцаалт", "Бидний тухай"].map((l) => (
              <a key={l} href="#" className="text-[13px] text-gray-400 hover:text-violet-600 transition-colors">{l}</a>
            ))}
          </div>
          <div className="text-[12px] text-gray-400">© 2025 HiCar MN</div>
        </div>
      </footer>
    </>
  );
}
