import type { Metadata } from "next";
import Link from "next/link";
import BuyerShell from "@/app/components/BuyerShell";
import {
  ShoppingCart, CreditCard, Truck, RotateCcw, Store, Phone, Mail, MapPin,
} from "lucide-react";

export const metadata: Metadata = {
  title: "Тусламж — HiCar MN",
  description:
    "HiCar дээр хэрхэн захиалга өгөх, төлбөр төлөх, хүргэлт авах, буцаалт хийх талаар түгээмэл асуултын хариулт.",
};

/** Pure-CSS accordion via <details> — no client JS needed. */
function Faq({ q, a }: { q: string; a: React.ReactNode }) {
  return (
    <details className="group border border-gray-200 rounded-2xl bg-white px-4 py-3 [&_summary::-webkit-details-marker]:hidden">
      <summary className="flex items-center justify-between cursor-pointer list-none text-[14px] font-medium text-gray-900">
        {q}
        <span className="ml-3 text-gray-400 transition-transform group-open:rotate-45 text-lg leading-none">
          +
        </span>
      </summary>
      <div className="mt-2 text-[13px] text-gray-600 leading-relaxed">{a}</div>
    </details>
  );
}

function Section({
  id, icon, title, children,
}: {
  id?: string; icon: React.ReactNode; title: string; children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
          {icon}
        </span>
        <h2 className="text-[15px] font-semibold text-gray-900">{title}</h2>
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

export default function HelpPage() {
  return (
    <BuyerShell>
      <div className="max-w-3xl mx-auto px-5 py-8">
        {/* Hero */}
        <div className="mb-8">
          <h1 className="text-[22px] font-semibold text-gray-900 mb-1">Тусламж</h1>
          <p className="text-[13px] text-gray-500">
            Түгээмэл асуултууд. Хариултаа олохгүй бол доорх{" "}
            <a href="#contact" className="text-blue-600 hover:underline">холбоо барих</a>{" "}
            хэсгээр бидэнтэй холбогдоорой.
          </p>
        </div>

        <div className="space-y-10">
          <Section icon={<ShoppingCart size={16} />} title="Захиалга өгөх">
            <Faq
              q="Би хэрхэн захиалга өгөх вэ?"
              a={
                <>
                  Хүссэн сэлбэгээ олоод <b>«Сагсанд хийх»</b> дарж, дараа нь сагснаасаа{" "}
                  <b>«Төлбөр төлөх»</b> руу орно. Хүргэлтийн хаяг, утасны дугаараа оруулаад
                  QPay-ээр төлбөрөө баталгаажуулна.
                </>
              }
            />
            <Faq
              q="Машиндаа таарах сэлбэгийг яаж олох вэ?"
              a={
                <>
                  Дээд талын <Link href="/lookup" className="text-blue-600 hover:underline">Улсын дугаар</Link>{" "}
                  хэсэгт улсын дугаараа оруулбал тань машинд тохирох сэлбэгүүдийг шүүж харуулна.
                  Эсвэл <Link href="/garage" className="text-blue-600 hover:underline">Миний машинууд</Link>-т
                  машинаа бүртгээд хайлтыг автоматаар тааруулна.
                </>
              }
            />
          </Section>

          <Section icon={<CreditCard size={16} />} title="Төлбөр">
            <Faq
              q="Ямар төлбөрийн аргаар төлөх вэ?"
              a="Одоогоор QPay-ээр төлбөр хүлээн авч байна. Захиалга үүсгэсний дараа гарч ирэх QR кодыг банкны аппаараа уншуулж эсвэл холбоосоор дамжуулан төлнө."
            />
            <Faq
              q="Миний төлбөр аюулгүй юу?"
              a="Тийм. Таны төлбөр escrow (баталгаат данс) дээр хадгалагдаж, бараагаа гардан авч баталгаажуулсны дараа л худалдагч руу шилждэг. Ингэснээр худалдан авагч хамгаалагдана."
            />
          </Section>

          <Section id="shipping" icon={<Truck size={16} />} title="Хүргэлт">
            <Faq
              q="Хүргэлт хэр хугацаанд ирэх вэ?"
              a="Хүргэлтийн хугацаа болон төлбөр нь худалдагч бүрийн сонголтоос хамаарна (шуурхай / энгийн / хямд). Захиалга өгөхдөө сонгосон хувилбарынхаа ойролцоо хугацааг харах боломжтой."
            />
            <Faq
              q="Хүргэлтийн төлбөрийг хэн төлдөг вэ?"
              a="Хүргэлтийн төлбөрийг захиалгын нийт дүн дээр нэмж тооцох ба худалдан авагч төлнө. Энэ нь барааны үнэнээс тусдаа харагдана."
            />
          </Section>

          <Section id="returns" icon={<RotateCcw size={16} />} title="Буцаалт ба маргаан">
            <Faq
              q="Буруу/гэмтэлтэй бараа ирвэл яах вэ?"
              a={
                <>
                  Бараагаа хүлээн авмагц шалгана уу. Асуудалтай бол захиалгаа{" "}
                  <b>баталгаажуулахын оронд</b> <Link href="/orders" className="text-blue-600 hover:underline">Захиалгууд</Link>{" "}
                  хэсгээс <b>гомдол (маргаан)</b> үүсгэнэ. Escrow дээрх төлбөр маргаан шийдэгдтэл
                  худалдагч руу шилжихгүй.
                </>
              }
            />
            <Faq
              q="Мөнгөө буцааж авах боломжтой юу?"
              a="Маргаан таны талд шийдэгдвэл escrow дээр хадгалагдаж байсан төлбөр буцаан олгогдоно. Шийдвэрлэх явцыг Захиалгууд хэсгээс хянах боломжтой."
            />
          </Section>

          <Section icon={<Store size={16} />} title="Худалдагч болох">
            <Faq
              q="Би HiCar дээр сэлбэг зарж болох уу?"
              a={
                <>
                  Болно. <Link href="/seller/apply" className="text-blue-600 hover:underline">Худалдагч болох</Link>{" "}
                  хэсгээр өргөдөл гаргаж, баталгаажсаны дараа бараагаа байршуулж эхэлнэ.
                </>
              }
            />
          </Section>

          {/* Contact */}
          <Section id="contact" icon={<Phone size={16} />} title="Холбоо барих">
            <div className="border border-gray-200 rounded-2xl bg-white p-4 space-y-3 text-[13px] text-gray-700">
              <a href="tel:+97677000000" className="flex items-center gap-2 hover:text-blue-600">
                <Phone size={15} className="text-gray-400" /> +976 7700-0000
              </a>
              <a href="mailto:info@hicar.mn" className="flex items-center gap-2 hover:text-blue-600">
                <Mail size={15} className="text-gray-400" /> info@hicar.mn
              </a>
              <div className="flex items-center gap-2">
                <MapPin size={15} className="text-gray-400" /> Улаанбаатар, Монгол
              </div>
            </div>
          </Section>
        </div>
      </div>
    </BuyerShell>
  );
}
