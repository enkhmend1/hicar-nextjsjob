"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Navbar from "@/app/components/Navbar";
import { useCartStore, useAuthStore } from "@/store";
import { api, ApiError } from "@/lib/api";
import { Order } from "@/app/types";
import { DELIVERY_PRICE } from "@/lib/data";
import { CheckCircle, QrCode, CreditCard, ArrowLeft, AlertCircle, Loader2 } from "lucide-react";
import Link from "next/link";

interface QPayInvoice {
  invoice_id: string;
  qr_text: string;
  qr_image: string; // base64 data url or absolute URL
  urls?: Array<{ name: string; description?: string; logo?: string; link?: string }>;
  qPay_shortUrl?: string;
}

type Step = "info" | "payment" | "qpay" | "done";
// Wallet removed in Phase 1 — money flow goes through QPay (card is a stub
// route that will be wired to a real processor later).
type PayMethod = "qpay" | "card";

// Stable QR pattern keyed by total amount — does NOT regenerate on tick
const FakeQR = ({ seed }: { seed: number }) => {
  // Deterministic pseudo-random from seed (mulberry32)
  const rand = (s: number) => () => {
    let t = (s += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const r = rand(seed || 1);
  const cells: Array<{ row: number; col: number }> = [];
  for (let row = 0; row < 7; row++) {
    for (let col = 0; col < 7; col++) {
      if (r() > 0.4) cells.push({ row, col });
    }
  }
  return (
    <div className="w-48 h-48 bg-white border-2 border-gray-200 rounded-xl mx-auto p-3 flex items-center justify-center">
      <svg width="160" height="160" viewBox="0 0 160 160" className="fill-gray-900">
        {cells.map((c, i) => <rect key={i} x={c.col * 23} y={c.row * 23} width={18} height={18} rx="2" />)}
        <rect x="0" y="0" width="62" height="62" rx="4" fill="none" stroke="#111" strokeWidth="5" />
        <rect x="8" y="8" width="46" height="46" rx="2" />
        <rect x="98" y="0" width="62" height="62" rx="4" fill="none" stroke="#111" strokeWidth="5" />
        <rect x="106" y="8" width="46" height="46" rx="2" />
        <rect x="0" y="98" width="62" height="62" rx="4" fill="none" stroke="#111" strokeWidth="5" />
        <rect x="8" y="106" width="46" height="46" rx="2" />
      </svg>
    </div>
  );
};

export default function CheckoutPage() {
  const router = useRouter();
  const { items, total, clearCart, removeItem } = useCartStore();
  const { user } = useAuthStore();

  const [step, setStep] = useState<Step>("info");
  const [payMethod, setPayMethod] = useState<PayMethod>("qpay");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState(user?.phone || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [qpayTimer, setQpayTimer] = useState(300);
  const [qpayInvoice, setQpayInvoice] = useState<QPayInvoice | null>(null);
  // Tracked so future code can resume the QPay-pending state across reloads.
  const [, setPendingOrderId] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cleanup must be registered BEFORE the empty-cart early return — moving an
  // effect after a conditional return breaks rules-of-hooks.
  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  const orderTotal = total();

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

  const submitInfo = (e: React.FormEvent) => {
    e.preventDefault();
    setStep("payment");
  };

  const submitPayment = async () => {
    setErr("");
    if (payMethod === "qpay") {
      // Create the order first (status=pending), then ask backend for a real QPay invoice
      setBusy(true);
      try {
        const payload = {
          items: items.map(i => ({
            product: i.product._id ?? i.product.id,
            quantity: i.quantity,
            deliveryType: i.deliveryType,
          })),
          address, phone, paymentMethod: "qpay" as const,
        };
        const { order } = await api.post<{ order: Order }>("/orders", payload);
        const orderId = (order._id ?? order.id) as string;
        setPendingOrderId(orderId);

        // Try to fetch a real QPay invoice
        try {
          const { invoice } = await api.post<{ invoice: QPayInvoice }>("/qpay/invoice", { orderId });
          setQpayInvoice(invoice);
        } catch (e) {
          // QPay not configured — show fallback mock screen
          if ((e as ApiError).status !== 503) throw e;
        }
        setStep("qpay");
        // Countdown
        const interval = setInterval(() => {
          setQpayTimer(t => { if (t <= 1) { clearInterval(interval); return 0; } return t - 1; });
        }, 1000);
        // Poll backend for payment confirmation
        pollRef.current = setInterval(async () => {
          try {
            const r = await api.get<{ status: string; paid: boolean }>(`/qpay/check/${orderId}`);
            if (r.paid) {
              if (pollRef.current) clearInterval(pollRef.current);
              clearInterval(interval);
              clearCart();
              router.push(`/orders?new=${orderId}`);
            }
          } catch { /* ignore */ }
        }, 3000);
      } catch (e) {
        if (e instanceof ApiError && typeof e.data.missingProductId === "string") {
          removeItem(e.data.missingProductId);
          setErr(`${e.message}. Сагснаас автоматаар хасагдлаа.`);
          setTimeout(() => router.push("/cart"), 1800);
        } else {
          setErr((e as Error).message || "Алдаа гарлаа");
        }
      } finally {
        setBusy(false);
      }
    } else {
      // "card" → currently routes through the same backend path; real card
      // processor integration is Phase 2 work.
      placeOrder("card");
    }
  };

  const placeOrder = async (method: PayMethod) => {
    setBusy(true); setErr("");
    try {
      const payload = {
        items: items.map(i => ({
          product: i.product._id ?? i.product.id,
          quantity: i.quantity,
          deliveryType: i.deliveryType,
        })),
        address, phone, paymentMethod: method,
      };
      const { order } = await api.post<{ order: Order }>("/orders", payload);
      clearCart();
      router.push(`/orders?new=${order._id ?? order.id}`);
    } catch (e) {
      // If backend returned a missingProductId, auto-remove it from cart
      if (e instanceof ApiError && typeof e.data.missingProductId === "string") {
        removeItem(e.data.missingProductId);
        setErr(`${e.message}. Сагснаас автоматаар хасагдлаа.`);
        // Bounce to cart so user can review remaining items
        setTimeout(() => router.push("/cart"), 1800);
      } else {
        setErr((e as Error).message || "Алдаа гарлаа");
      }
      setStep("payment");
    } finally {
      setBusy(false);
    }
  };

  const fmtTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

  const steps = ["Мэдээлэл", "Төлбөр", "Баталгаа"];
  const stepIdx = step === "info" ? 0 : step === "payment" ? 1 : 2;

  return (
    <>
      <Navbar />
      <div className="max-w-xl mx-auto px-5 py-5">
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

        <div className="bg-violet-50 border border-violet-100 rounded-xl p-4 mb-5">
          <div className="text-[12px] text-violet-600 font-semibold mb-1.5">ЗАХИАЛГЫН ДҮН</div>
          {items.map(i => (
            <div key={i.product._id ?? i.product.id} className="flex justify-between text-[13px] text-gray-600 py-0.5">
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

        {err && (
          <div className="bg-red-50 border border-red-200 text-red-600 text-[13px] rounded-xl px-3.5 py-2.5 mb-4">⚠️ {err}</div>
        )}

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

        {step === "payment" && (
          <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
            <button onClick={() => setStep("info")}
              className="flex items-center gap-1.5 text-[13px] text-gray-400 hover:text-violet-600 mb-4 cursor-pointer bg-transparent border-none transition-colors">
              <ArrowLeft size={13} /> Буцах
            </button>
            <h2 className="text-[16px] font-semibold text-gray-900 mb-4">Төлбөрийн арга</h2>

            <div className="space-y-3 mb-5">
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

            <button onClick={submitPayment} disabled={!user || busy}
              className="w-full bg-violet-600 hover:bg-violet-700 disabled:bg-gray-300 text-white rounded-xl py-3.5 text-[14px] font-semibold cursor-pointer border-none transition-colors font-sans shadow-lg shadow-violet-200">
              {busy ? "Уншиж байна..." : `₮${orderTotal.toLocaleString()} — Төлбөр хийх`}
            </button>
          </div>
        )}

        {step === "qpay" && (
          <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm text-center">
            <div className="w-12 h-12 bg-blue-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <QrCode size={24} className="text-blue-600" />
            </div>
            <h2 className="text-[18px] font-semibold text-gray-900 mb-1">QPay QR код</h2>
            <p className="text-[13px] text-gray-500 mb-5">Утсандаа QPay app нээж QR скан хийнэ үү</p>

            {qpayInvoice ? (
              <div className="w-56 h-56 mx-auto bg-white border-2 border-gray-200 rounded-xl p-3 flex items-center justify-center">
                <Image
                  src={qpayInvoice.qr_image.startsWith("data:") ? qpayInvoice.qr_image : `data:image/png;base64,${qpayInvoice.qr_image}`}
                  alt="QPay QR" width={208} height={208} className="object-contain" unoptimized
                />
              </div>
            ) : (
              <FakeQR seed={orderTotal} />
            )}

            <div className="mt-4 mb-5 bg-blue-50 border border-blue-100 rounded-xl p-3">
              <div className="text-[12px] text-blue-600 font-medium mb-0.5">Төлөх дүн</div>
              <div className="text-[22px] font-bold text-blue-700">₮{orderTotal.toLocaleString()}</div>
              {qpayInvoice ? (
                <div className="text-[11px] text-blue-500 mt-1 font-mono">Invoice: {qpayInvoice.invoice_id.slice(0, 16)}…</div>
              ) : (
                <div className="text-[11px] text-amber-600 mt-1">⚠ QPay тохируулагдаагүй (mock QR)</div>
              )}
            </div>

            {/* Bank app deep links (from QPay urls) */}
            {qpayInvoice?.urls && qpayInvoice.urls.length > 0 && (
              <div className="grid grid-cols-3 gap-2 mb-4">
                {qpayInvoice.urls.slice(0, 6).map((u, i) => (
                  <a key={i} href={u.link} target="_blank" rel="noopener noreferrer"
                    className="text-[11px] bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 hover:border-violet-400 hover:bg-violet-50 transition-colors text-gray-700 font-medium" style={{ textDecoration: "none" }}>
                    {u.name}
                  </a>
                ))}
              </div>
            )}

            <div className="text-[12px] text-gray-400 mb-4">
              QR код хүчинтэй байх хугацаа:{" "}
              <span className={`font-bold ${qpayTimer < 60 ? "text-red-500" : "text-gray-700"}`}>{fmtTime(qpayTimer)}</span>
            </div>

            <div className="flex items-center justify-center gap-2 text-[13px] text-violet-600 font-medium py-3">
              <Loader2 size={14} className="animate-spin" />
              Төлбөрийг хүлээж байна...
            </div>

            {!qpayInvoice && (
              <button onClick={() => placeOrder("qpay")} disabled={busy}
                className="w-full bg-violet-600 hover:bg-violet-700 disabled:bg-violet-300 text-white rounded-xl py-3 text-[13px] font-semibold cursor-pointer border-none transition-colors font-sans">
                Mock төлбөр баталгаажуулах
              </button>
            )}
            <button onClick={() => {
              if (pollRef.current) clearInterval(pollRef.current);
              setStep("payment");
            }}
              className="w-full mt-2 text-[13px] text-gray-400 hover:text-violet-600 cursor-pointer bg-transparent border-none py-1.5 transition-colors">
              ← Буцах
            </button>
          </div>
        )}
      </div>
    </>
  );
}
