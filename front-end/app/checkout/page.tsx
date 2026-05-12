"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Navbar from "@/app/components/Navbar";
import { useCartStore, useAuthStore, useOrderStore } from "@/store";
import { DELIVERY_PRICE } from "@/lib/data";
import { CheckCircle, Wallet, QrCode, CreditCard, ArrowLeft, AlertCircle } from "lucide-react";
import Link from "next/link";

type Step = "info" | "payment" | "qpay" | "done";
type PayMethod = "qpay" | "wallet" | "card";

// Fake QPay QR code (SVG pattern)
function FakeQR() {
  return (
    <div className="w-48 h-48 bg-white border-2 border-gray-200 rounded-xl mx-auto p-3 flex items-center justify-center">
      <svg width="160" height="160" viewBox="0 0 160 160" className="fill-gray-900">
        {/* Fake QR pattern */}
        {[0,1,2,3,4,5,6].map(r => [0,1,2,3,4,5,6].map(c => (
          Math.random() > 0.4 ? <rect key={`${r}-${c}`} x={c*23} y={r*23} width={18} height={18} rx="2"/> : null
        )))}
        <rect x="0" y="0" width="62" height="62" rx="4" fill="none" stroke="#111" strokeWidth="5"/>
        <rect x="8" y="8" width="46" height="46" rx="2"/>
        <rect x="98" y="0" width="62" height="62" rx="4" fill="none" stroke="#111" strokeWidth="5"/>
        <rect x="106" y="8" width="46" height="46" rx="2"/>
        <rect x="0" y="98" width="62" height="62" rx="4" fill="none" stroke="#111" strokeWidth="5"/>
        <rect x="8" y="106" width="46" height="46" rx="2"/>
      </svg>
    </div>
  );
}

export default function CheckoutPage() {
  const router = useRouter();
  const { items, total, clearCart } = useCartStore();
  const { user, deductWallet } = useAuthStore();
  const { addOrder } = useOrderStore();

  const [step, setStep] = useState<Step>("info");
  const [payMethod, setPayMethod] = useState<PayMethod>("qpay");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState(user?.phone || "");
  const [qpayChecking, setQpayChecking] = useState(false);
  const [qpayTimer, setQpayTimer] = useState(300); // 5 min

  const orderTotal = total();
  const canPayWallet = user && user.walletBalance >= orderTotal;

  if (items.length === 0) return (
    <>
      <Navbar />
      <div className="min-h-[70vh] flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-500 mb-4">Таны сагс хоосон байна</p>
          <Link href="/shop" className="bg-violet-600 text-white rounded-xl px-6 py-3 text-[14px] font-semibold" style={{ textDecoration: "none" }}>Дэлгүүр</Link>
        </div>
      </div>
    </>
  );

  // Step 1: Info
  const submitInfo = (e: React.FormEvent) => {
    e.preventDefault();
    setStep("payment");
  };

  // Step 2: Payment
  const submitPayment = () => {
    if (payMethod === "qpay") {
      setStep("qpay");
      // Start countdown
      const interval = setInterval(() => {
        setQpayTimer(t => { if (t <= 1) { clearInterval(interval); return 0; } return t - 1; });
      }, 1000);
    } else if (payMethod === "wallet") {
      if (!canPayWallet) return;
      completeOrder("wallet");
    } else {
      completeOrder("card");
    }
  };

  // Simulate QPay check
  const checkQPay = async () => {
    setQpayChecking(true);
    await new Promise(r => setTimeout(r, 1500));
    setQpayChecking(false);
    completeOrder("qpay");
  };

  const completeOrder = (method: PayMethod) => {
    if (method === "wallet") deductWallet(orderTotal);
    const order = {
      id: "ORD-" + Date.now().toString().slice(-6),
      items: items,
      total: orderTotal,
      status: "paid" as const,
      paymentMethod: method,
      createdAt: new Date().toISOString(),
      address,
    };
    addOrder(order);
    clearCart();
    router.push(`/checkout/success?id=${order.id}`);
  };

  const fmtTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

  // Step indicator
  const steps = ["Мэдээлэл", "Төлбөр", "Баталгаа"];
  const stepIdx = step === "info" ? 0 : step === "payment" ? 1 : 2;

  return (
    <>
      <Navbar />
      <div className="max-w-xl mx-auto px-5 py-5">
        {/* Step bar */}
        <div className="flex items-center gap-2 mb-6">
          {steps.map((s, i) => (
            <div key={s} className="flex items-center gap-2 flex-1">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-semibold shrink-0 ${i < stepIdx ? "bg-emerald-500 text-white" : i === stepIdx ? "bg-violet-600 text-white" : "bg-gray-200 text-gray-400"}`}>
                {i < stepIdx ? <CheckCircle size={14} /> : i + 1}
              </div>
              <span className={`text-[12px] font-medium ${i === stepIdx ? "text-violet-600" : "text-gray-400"}`}>{s}</span>
              {i < 2 && <div className={`flex-1 h-0.5 ${i < stepIdx ? "bg-emerald-400" : "bg-gray-200"}`} />}
            </div>
          ))}
        </div>

        {/* Order summary card */}
        <div className="bg-violet-50 border border-violet-100 rounded-xl p-4 mb-5">
          <div className="text-[12px] text-violet-600 font-semibold mb-1.5">ЗАХИАЛГЫН ДҮН</div>
          {items.map(i => (
            <div key={i.product.id} className="flex justify-between text-[13px] text-gray-600 py-0.5">
              <span className="truncate flex-1 mr-3">{i.product.name} ×{i.quantity}</span>
              <span className="shrink-0">₮{(i.product.price * i.quantity).toLocaleString()}</span>
            </div>
          ))}
          <div className="flex justify-between text-[13px] text-gray-500 mt-1 pt-1 border-t border-violet-100">
            <span>Хүргэлт</span>
            <span>₮{items.reduce((s, i) => s + DELIVERY_PRICE[i.deliveryType], 0).toLocaleString()}</span>
          </div>
          <div className="flex justify-between text-[16px] font-bold text-violet-700 mt-2 pt-2 border-t border-violet-200">
            <span>Нийт</span>
            <span>₮{orderTotal.toLocaleString()}</span>
          </div>
        </div>

        {/* STEP: Info */}
        {step === "info" && (
          <form onSubmit={submitInfo}>
            <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
              <h2 className="text-[16px] font-semibold text-gray-900 mb-4">Хүргэлтийн мэдээлэл</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-[13px] font-medium text-gray-700 mb-1.5">Хүлээн авах хаяг</label>
                  <textarea value={address} onChange={e => setAddress(e.target.value)} required
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-[14px] focus:border-violet-500 focus:bg-white transition-colors resize-none h-20 font-sans"
                    placeholder="Дүүрэг, хороо, байр, орц, тоот..." />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-gray-700 mb-1.5">Утасны дугаар</label>
                  <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} required
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-[14px] focus:border-violet-500 focus:bg-white transition-colors"
                    placeholder="9900 1122" />
                </div>
              </div>
              <button type="submit"
                className="w-full bg-violet-600 hover:bg-violet-700 text-white rounded-xl py-3.5 text-[14px] font-semibold mt-5 cursor-pointer border-none transition-colors font-sans shadow-lg shadow-violet-200">
                Үргэлжлүүлэх →
              </button>
            </div>
          </form>
        )}

        {/* STEP: Payment */}
        {step === "payment" && (
          <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
            <button onClick={() => setStep("info")}
              className="flex items-center gap-1.5 text-[13px] text-gray-400 hover:text-violet-600 mb-4 cursor-pointer bg-transparent border-none transition-colors">
              <ArrowLeft size={13} /> Буцах
            </button>
            <h2 className="text-[16px] font-semibold text-gray-900 mb-4">Төлбөрийн арга</h2>

            <div className="space-y-3 mb-5">
              {/* QPay */}
              <label className={`flex items-center gap-3 border-2 rounded-xl p-4 cursor-pointer transition-all ${payMethod === "qpay" ? "border-violet-500 bg-violet-50" : "border-gray-200 hover:border-violet-300"}`}>
                <input type="radio" name="pay" value="qpay" checked={payMethod === "qpay"} onChange={() => setPayMethod("qpay")} className="accent-violet-600" />
                <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center shrink-0">
                  <QrCode size={20} className="text-blue-600" />
                </div>
                <div className="flex-1">
                  <div className="text-[14px] font-semibold text-gray-900">QPay</div>
                  <div className="text-[12px] text-gray-500">QR код скан хийж төлнө</div>
                </div>
                <span className="text-[11px] bg-blue-50 text-blue-600 border border-blue-100 px-2 py-0.5 rounded-full font-medium">Түгээмэл</span>
              </label>

              {/* Wallet */}
              <label className={`flex items-center gap-3 border-2 rounded-xl p-4 cursor-pointer transition-all ${payMethod === "wallet" ? "border-violet-500 bg-violet-50" : "border-gray-200 hover:border-violet-300"} ${!canPayWallet ? "opacity-60" : ""}`}>
                <input type="radio" name="pay" value="wallet" checked={payMethod === "wallet"} onChange={() => setPayMethod("wallet")}
                  disabled={!canPayWallet} className="accent-violet-600" />
                <div className="w-10 h-10 bg-violet-50 rounded-xl flex items-center justify-center shrink-0">
                  <Wallet size={20} className="text-violet-600" />
                </div>
                <div className="flex-1">
                  <div className="text-[14px] font-semibold text-gray-900">HiCar Wallet</div>
                  <div className="text-[12px] text-gray-500">
                    Үлдэгдэл: ₮{(user?.walletBalance ?? 0).toLocaleString()}
                    {!canPayWallet && <span className="text-red-400 ml-1">· Хүрэлцэхгүй</span>}
                  </div>
                </div>
                {canPayWallet && <CheckCircle size={16} className="text-emerald-500" />}
              </label>

              {/* Card */}
              <label className={`flex items-center gap-3 border-2 rounded-xl p-4 cursor-pointer transition-all ${payMethod === "card" ? "border-violet-500 bg-violet-50" : "border-gray-200 hover:border-violet-300"}`}>
                <input type="radio" name="pay" value="card" checked={payMethod === "card"} onChange={() => setPayMethod("card")} className="accent-violet-600" />
                <div className="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center shrink-0">
                  <CreditCard size={20} className="text-emerald-600" />
                </div>
                <div className="flex-1">
                  <div className="text-[14px] font-semibold text-gray-900">Банкны карт</div>
                  <div className="text-[12px] text-gray-500">Visa, Mastercard</div>
                </div>
              </label>
            </div>

            {!user && (
              <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4 text-[13px] text-amber-700">
                <AlertCircle size={14} /> Төлбөр хийхийн тулд <Link href="/auth/login" className="underline font-semibold" style={{ textDecoration: "underline" }}>нэвтрэх</Link> шаардлагатай.
              </div>
            )}

            <button onClick={submitPayment} disabled={!user}
              className="w-full bg-violet-600 hover:bg-violet-700 disabled:bg-gray-300 text-white rounded-xl py-3.5 text-[14px] font-semibold cursor-pointer border-none transition-colors font-sans shadow-lg shadow-violet-200">
              ₮{orderTotal.toLocaleString()} — Төлбөр хийх
            </button>
          </div>
        )}

        {/* STEP: QPay QR */}
        {step === "qpay" && (
          <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm text-center">
            <div className="w-12 h-12 bg-blue-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <QrCode size={24} className="text-blue-600" />
            </div>
            <h2 className="text-[18px] font-semibold text-gray-900 mb-1">QPay QR код</h2>
            <p className="text-[13px] text-gray-500 mb-5">Утсандаа QPay app нээж QR скан хийнэ үү</p>

            <FakeQR />

            <div className="mt-4 mb-5 bg-blue-50 border border-blue-100 rounded-xl p-3">
              <div className="text-[12px] text-blue-600 font-medium mb-0.5">Төлөх дүн</div>
              <div className="text-[22px] font-bold text-blue-700">₮{orderTotal.toLocaleString()}</div>
              <div className="text-[11px] text-blue-500 mt-1">Invoice ID: QPY-{Date.now().toString().slice(-8)}</div>
            </div>

            <div className="text-[12px] text-gray-400 mb-4">
              QR код хүчинтэй байх хугацаа:{" "}
              <span className={`font-bold ${qpayTimer < 60 ? "text-red-500" : "text-gray-700"}`}>{fmtTime(qpayTimer)}</span>
            </div>

            {/* Bank apps */}
            <div className="grid grid-cols-3 gap-2 mb-5">
              {[
                { name: "Khan Bank", color: "bg-green-600" },
                { name: "TDB", color: "bg-blue-700" },
                { name: "Golomt", color: "bg-red-600" },
                { name: "XacBank", color: "bg-orange-500" },
                { name: "Capitron", color: "bg-purple-600" },
                { name: "Bogd", color: "bg-teal-600" },
              ].map(b => (
                <button key={b.name} onClick={checkQPay}
                  className={`${b.color} text-white rounded-xl py-2.5 text-[11px] font-semibold cursor-pointer border-none hover:opacity-90 transition-opacity`}>
                  {b.name}
                </button>
              ))}
            </div>

            <button onClick={checkQPay} disabled={qpayChecking}
              className="w-full bg-violet-600 hover:bg-violet-700 disabled:bg-violet-300 text-white rounded-xl py-3.5 text-[14px] font-semibold cursor-pointer border-none transition-colors font-sans">
              {qpayChecking ? "Шалгаж байна..." : "✓ Төлбөр баталгаажуулах"}
            </button>
            <button onClick={() => setStep("payment")}
              className="w-full mt-2 text-[13px] text-gray-400 hover:text-violet-600 cursor-pointer bg-transparent border-none py-1.5 transition-colors">
              ← Буцах
            </button>
          </div>
        )}
      </div>
    </>
  );
}
