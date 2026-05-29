import { Car, Product } from "@/app/types";

/**
 * @deprecated Phase AV — delivery prices are now per-seller. Don't read this
 * for pricing; use `deliveryPriceFor(seller, tier)` / `resolveDeliveryOptions`
 * from `@/app/lib/delivery` (display) — the order total is computed
 * server-side from the seller's config. Kept only as the platform-default
 * mirror (it equals DEFAULT_DELIVERY_OPTIONS prices).
 */
export const DELIVERY_PRICE = { fast: 15000, normal: 8000, cheap: 0 };

export const CAR_DB: Record<string, Car> = {
  "1234 ААА": { id:"c1", plate:"1234 ААА", make:"Toyota", model:"Prius", year:2018, engine:"1.8L Hybrid", chassis:"ZVW50" },
  "5678 БАА": { id:"c2", plate:"5678 БАА", make:"Nissan", model:"X-Trail", year:2020, engine:"2.0L", chassis:"T32" },
  "4321 ВАА": { id:"c3", plate:"4321 ВАА", make:"Toyota", model:"Land Cruiser 200", year:2018, engine:"4.5L Diesel", chassis:"URJ202" },
  "9999 ГАА": { id:"c4", plate:"9999 ГАА", make:"Honda", model:"Fit", year:2017, engine:"1.3L", chassis:"GK3" },
  "1111 ААА": { id:"c5", plate:"1111 ААА", make:"Mitsubishi", model:"Outlander", year:2019, engine:"2.4L", chassis:"GF7W" },
};

const D1 = "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm0-12.5c-2.49 0-4.5 2.01-4.5 4.5S9.51 16.5 12 16.5s4.5-2.01 4.5-4.5S14.49 7.5 12 7.5z";
const D2 = "M13 2v8h8c0-4.42-3.58-8-8-8zm-2 0C6.48 2.05 3 5.56 3 10c0 4.97 4.03 9 9 9s9-4.03 9-9h-9V2z";
const D3 = "M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7z";
const D4 = "M17 8C8 10 5.9 16.17 3.82 21.34L5.71 22l1-2.3A4.49 4.49 0 008 20c3 0 3-2 6-2s3 2 6 2v-2c-3 0-3-2-6-2-.52 0-.96.03-1.39.08C13.77 13.23 15.71 10.72 17 8zm0-4v3l3-3H17z";
const D5 = "M15.67 4H14V2h-4v2H8.33C7.6 4 7 4.6 7 5.33v15.33C7 21.4 7.6 22 8.33 22h7.33c.74 0 1.34-.6 1.34-1.33V5.33C17 4.6 16.4 4 15.67 4z";
const D6 = "M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99z";
const D7 = "M22 9V7h-2V5c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-2h2v-2h-2v-2h2v-2h-2V9h2zm-4 10H4V5h14v14z";

export const PRODUCTS: Product[] = [
  { id:"p1", name:"Урд тоормосны диск", oem:"43512-47060", price:48000, originalPrice:62000,
    category:"brake", brand:"Toyota Genuine", source:"amayama", inStock:true, badge:"Хямдарсан",
    description:"Toyota Prius ZVW50 урд тоормосны диск. Оригинал OEM чанарын баталгаатай. Японоос шууд импорт.",
    compatible:["Toyota Prius 2015–2022 ZVW50","Toyota Prius PHV 2017–2022"],
    deliveryDays:{ fast:7, normal:14, cheap:21 }, iconPath:D1 },

  { id:"p2", name:"Тоормосны шахуурга (урд)", oem:"47730-47060", price:92000,
    category:"brake", brand:"Toyota Genuine", source:"partsouq", inStock:true,
    description:"Урд тоормосны шахуурга. Prius ZVW50 загварт тохиромжтой. 100% OEM.",
    compatible:["Toyota Prius 2015–2022"],
    deliveryDays:{ fast:10, normal:16, cheap:24 }, iconPath:D7 },

  { id:"p3", name:"Урд зүүн фар", oem:"81150-47180", price:145000, originalPrice:180000,
    category:"lighting", brand:"Toyota Genuine", source:"amayama", inStock:true, badge:"Онцлох",
    description:"Урд зүүн гэрлийн залгуур бүрэн угсралттай. LED technology.",
    compatible:["Toyota Prius 2015–2018 ZVW50"],
    deliveryDays:{ fast:8, normal:14, cheap:22 }, iconPath:D3 },

  { id:"p4", name:"Тосны шүүр", oem:"90915-YZZN2", price:12000,
    category:"engine", brand:"Toyota Genuine", source:"local", inStock:true,
    description:"Toyota оригинал тос шүүр. Бүх Toyota загварт тохиромжтой. Монголын агуулахад байна.",
    compatible:["Toyota Prius","Toyota Camry","Toyota RAV4","Toyota Corolla"],
    deliveryDays:{ fast:1, normal:2, cheap:3 }, iconPath:D4 },

  { id:"p5", name:"Урд амортизатор", oem:"48510-80695", price:128000, originalPrice:155000,
    category:"suspension", brand:"KYB Excel-G", source:"amayama", inStock:true,
    description:"KYB Excel-G урд амортизатор. Монгол замын нөхцөлд тохирсон чанартай сэлбэг.",
    compatible:["Toyota Prius 2016–2022 ZVW50","Toyota Prius 2016–2022 ZVW51"],
    deliveryDays:{ fast:9, normal:15, cheap:23 }, iconPath:D2 },

  { id:"p6", name:"Хүчилтөрөгчийн мэдрэгч", oem:"89465-47060", price:68000,
    category:"engine", brand:"Denso", source:"partsouq", inStock:false,
    description:"Denso хүчилтөрөгчийн мэдрэгч. Fuel efficiency сайжруулна.",
    compatible:["Toyota Prius 2015–2022"],
    deliveryDays:{ fast:12, normal:18, cheap:26 }, iconPath:D5 },

  { id:"p7", name:"Бампер (урд)", oem:"52119-47946", price:185000, originalPrice:220000,
    category:"body", brand:"Toyota Genuine", source:"amayama", inStock:true, badge:"Шинэ",
    description:"Урд бампер бүрэн угсралттай. Будгийн бэлтгэл шаардлагатай.",
    compatible:["Toyota Prius 2015–2018 ZVW50"],
    deliveryDays:{ fast:10, normal:17, cheap:25 }, iconPath:D6 },

  { id:"p8", name:"Нэвтрэх товч (эхлүүлэх)", oem:"84950-47090", price:38000,
    category:"electric", brand:"Toyota Genuine", source:"partsouq", inStock:true,
    description:"Старт/стоп унтраах товч бүрэн угсралттай.",
    compatible:["Toyota Prius 2015–2022","Toyota C-HR 2016–2022"],
    deliveryDays:{ fast:11, normal:17, cheap:25 }, iconPath:D5 },

  { id:"p9", name:"Хөдөлгүүрийн тавиур", oem:"12305-37150", price:55000,
    category:"engine", brand:"Toyota Genuine", source:"amayama", inStock:true,
    description:"Хөдөлгүүрийн резинэн тавиур. Чичиргээ багасгана.",
    compatible:["Toyota Prius 2015–2022 ZVW50"],
    deliveryDays:{ fast:9, normal:15, cheap:22 }, iconPath:D2 },
];

export const CATEGORIES = [
  { id:"all",          name:"Бүгд",         count:5200, icon:D1 },
  { id:"brake",        name:"Тоормос",      count:860,  icon:D1 },
  { id:"engine",       name:"Хөдөлгүүр",   count:1240, icon:D2 },
  { id:"lighting",     name:"Гэрэлтүүлэг", count:520,  icon:D3 },
  { id:"suspension",   name:"Амортизатор",  count:430,  icon:D4 },
  { id:"electric",     name:"Цахилгаан",   count:670,  icon:D5 },
  { id:"body",         name:"Бие дарц",    count:390,  icon:D6 },
  { id:"transmission", name:"Дамжуулга",   count:780,  icon:D7 },
];
