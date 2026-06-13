import type { Metadata } from "next";
import Link from "next/link";
import BuyerShell from "@/app/components/BuyerShell";
import {
  Phone, Mail, MapPin, Clock, MessageSquare, HelpCircle, ShoppingBag,
  ShieldCheck, ArrowRight, Sparkles,
} from "lucide-react";

export const metadata: Metadata = {
  title: "Оператортой холбогдох — HiCar MN",
  description:
    "HiCar-ийн дэмжлэгийн багтай холбогдох. Утас, и-мэйл, ажиллах цаг болон захиалга, маргааны талаар хурдан тусламж.",
};

/**
 * Buyer-facing support / contact hand-off page.
 *
 * Reachable from the AI assistant's escalation CTA (backend
 * aiReflection.service.js emits the href "/help/contact" when it can't
 * confidently answer). This page must EXIST so that CTA never 404s.
 *
 * Purely informational — no backend endpoint. Contact details are kept
 * in sync with the `#contact` section of app/help/page.tsx (same phone
 * +976 7700-0000 / info@hicar.mn / Улаанбаатар) so the two never drift.
 */

function QuickLink({
  href, icon, title, desc,
}: {
  href: string; icon: React.ReactNode; title: string; desc: string;
}) {
  return (
    <Link
      href={href}
      className="group flex items-start gap-3 border border-gray-200 rounded-2xl bg-white p-4 hover:border-blue-400 hover:shadow-sm transition-all"
    >
      <span className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1 text-[14px] font-medium text-gray-900">
          {title}
          <ArrowRight size={13} className="text-gray-300 group-hover:text-blue-500 group-hover:translate-x-0.5 transition-all" />
        </div>
        <div className="text-[12px] text-gray-500 leading-relaxed mt-0.5">{desc}</div>
      </div>
    </Link>
  );
}

export default function HelpContactPage() {
  return (
    <BuyerShell>
      <div className="max-w-3xl mx-auto px-5 py-8">
        {/* AI escalation note */}
        <div className="flex items-start gap-2.5 border border-amber-200 bg-amber-50 rounded-2xl p-3.5 mb-6 text-[13px] text-amber-900">
          <Sparkles size={16} className="text-amber-500 shrink-0 mt-0.5" />
          <div>
            <span className="font-medium">AI туслах таныг манай оператор руу шилжүүлэв.</span>{" "}
            Асуултад бүрэн хариулж чадаагүй тул доорх сувгуудаар бидэнтэй
            шууд холбогдоорой — хүний дэмжлэг туслахад бэлэн байна.
          </div>
        </div>

        {/* Hero */}
        <div className="mb-6">
          <h1 className="text-[22px] font-semibold text-gray-900 mb-1">Оператортой холбогдох</h1>
          <p className="text-[13px] text-gray-500">
            HiCar-ийн дэмжлэгийн баг туслахад бэлэн. Захиалга, төлбөр, хүргэлт
            эсвэл маргаантай холбоотой асуудлаа доорх сувгаар шийдэцгээе.
          </p>
        </div>

        {/* Primary in-app channel — real operator chat hand-off. */}
        <Link
          href="/support"
          className="group flex items-center gap-3 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white rounded-2xl p-4 mb-8 shadow-sm shadow-blue-200 transition-all"
        >
          <span className="w-11 h-11 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
            <MessageSquare size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold">Оператортой чат бичих</div>
            <div className="text-[12px] text-blue-100 leading-relaxed mt-0.5">
              Аппликейшн дотроос шууд хүсэлт нээж, оператортой бичгээр харилцаарай. Хариуг
              энд хүлээн авна.
            </div>
          </div>
          <ArrowRight size={18} className="text-white/80 group-hover:translate-x-0.5 transition-transform shrink-0" />
        </Link>

        {/* "Бид хэрхэн туслах вэ" intro */}
        <section className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
              <MessageSquare size={16} />
            </span>
            <h2 className="text-[15px] font-semibold text-gray-900">Бид хэрхэн туслах вэ</h2>
          </div>
          <div className="border border-gray-200 rounded-2xl bg-white p-4 text-[13px] text-gray-600 leading-relaxed">
            Манай дэмжлэгийн баг таны захиалгын явц, төлбөрийн баталгаажуулалт,
            хүргэлтийн мэдээлэл, мөн буруу/гэмтэлтэй бараа, буцаалт, маргааны
            асуудлыг шийдвэрлэхэд тусална. Холбогдохдоо <b>захиалгын дугаар</b>
            болон <b>бүртгэлтэй утасны дугаараа</b> бэлдсэн байвал асуудлыг
            хурдан барьж авах боломжтой.
          </div>
        </section>

        {/* Contact details — kept in sync with app/help/page.tsx #contact */}
        <section className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
              <Phone size={16} />
            </span>
            <h2 className="text-[15px] font-semibold text-gray-900">Холбоо барих мэдээлэл</h2>
          </div>
          <div className="border border-gray-200 rounded-2xl bg-white p-4 space-y-3 text-[13px] text-gray-700">
            <a href="tel:+97677000000" className="flex items-center gap-2 hover:text-blue-600">
              <Phone size={15} className="text-gray-400" /> +976 7700-0000
            </a>
            <a href="mailto:info@hicar.mn" className="flex items-center gap-2 hover:text-blue-600">
              <Mail size={15} className="text-gray-400" /> info@hicar.mn
            </a>
            <div className="flex items-center gap-2">
              <Clock size={15} className="text-gray-400" /> Даваа–Баасан, 09:00–18:00 (Улаанбаатарын цаг)
            </div>
            <div className="flex items-center gap-2">
              <MapPin size={15} className="text-gray-400" /> Улаанбаатар, Монгол
            </div>
          </div>
        </section>

        {/* Quick links */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <span className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
              <HelpCircle size={16} />
            </span>
            <h2 className="text-[15px] font-semibold text-gray-900">Хурдан холбоосууд</h2>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <QuickLink
              href="/help"
              icon={<HelpCircle size={16} />}
              title="Түгээмэл асуултууд (ТҮХ)"
              desc="Захиалга, төлбөр, хүргэлт, буцаалтын талаарх хариултуудыг эндээс хайгаарай."
            />
            <QuickLink
              href="/orders"
              icon={<ShoppingBag size={16} />}
              title="Миний захиалгууд"
              desc="Захиалгынхаа явц, төлөв, хүргэлтийн мэдээллийг хянах, маргаан үүсгэх."
            />
            <QuickLink
              href="/orders"
              icon={<ShieldCheck size={16} />}
              title="Гомдол ба маргаан"
              desc="Буруу эсвэл гэмтэлтэй бараа ирвэл захиалгаасаа маргаан нээж escrow төлбөрөө хамгаалаарай."
            />
            <QuickLink
              href="/help#shipping"
              icon={<MessageSquare size={16} />}
              title="Хүргэлтийн мэдээлэл"
              desc="Хүргэлтийн хугацаа, төлбөр болон сонголтуудын талаар дэлгэрэнгүй."
            />
          </div>
        </section>
      </div>
    </BuyerShell>
  );
}
