"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import { tierUnitPrice } from "@/app/lib/price";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import BuyerShell from "@/app/components/BuyerShell";
import { useCartStore, useAuthStore } from "@/store";
import { api, ApiError } from "@/lib/api";
import { Order, Rfq } from "@/app/types";
import { deliveryPriceFor } from "@/app/lib/delivery";
import { CheckCircle, QrCode, CreditCard, ArrowLeft, AlertCircle, Loader2, Package, MessageSquareQuote } from "lucide-react";
import Link from "next/link";
import { toast } from "@/app/lib/toast";

interface QPayInvoice {
  invoice_id: string;
  qr_text: string;
  qr_image: string; // base64 data url or absolute URL
  urls?: Array<{ name: string; description?: string; logo?: string; link?: string }>;
  qPay_shortUrl?: string;
}

type Step = "info" | "payment" | "qpay" | "done";
// Wallet removed in Phase 1. Both methods settle through QPay: "qpay" = pay
// by bank app QR, "card" = pay by Visa/Mastercard on QPay's hosted page.
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

function CartCheckout() {
  const router = useRouter();
  const { items, total, clearCart, removeItem, _hasHydrated: cartHydrated } = useCartStore();
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

  // Wait for Zustand to rehydrate from localStorage before showing the
  // empty-cart state — without this guard, SSR renders "хоосон сагс"
  // (empty cart) and the client immediately replaces it with cart contents,
  // causing a hydration mismatch warning and a visible flash.
  if (!cartHydrated) return (
    <BuyerShell>
      <div className="min-h-[70vh] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    </BuyerShell>
  );

  if (items.length === 0) return (
    <BuyerShell>
      <div className="min-h-[70vh] flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-500 mb-4">Таны сагс хоосон байна</p>
          <Link href="/shop" className="bg-blue-600 text-white rounded-xl px-6 py-3 text-[14px] font-semibold">Дэлгүүр</Link>
        </div>
      </div>
    </BuyerShell>
  );

  // Mongolian mobile numbers: 8 digits, starting with 6/7/8/9.
  const MN_PHONE_RE = /^[6-9]\d{7}$/;

  const [formErrors, setFormErrors] = useState<{ address?: string; phone?: string }>({});

  const submitInfo = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: { address?: string; phone?: string } = {};
    if (!address.trim()) errs.address = "Хаяг оруулна уу";
    if (!MN_PHONE_RE.test(phone.replace(/\s/g, ""))) {
      errs.phone = "Монгол утасны дугаар 8 оронтой байх ёстой (жнь: 99001122)";
    }
    if (Object.keys(errs).length) { setFormErrors(errs); return; }
    setFormErrors({});
    setStep("payment");
  };

  const submitPayment = async () => {
    setErr("");
    // QPay and card share ONE settlement path: QPay's hosted payment page
    // accepts Visa/Mastercard, so "card" is just a QPay invoice the user pays
    // by card instead of a bank app. Both create the order (status=pending),
    // mint a QPay invoice, then poll until QPay confirms the payment.
    setBusy(true);
    try {
      const payload = {
        items: items.map(i => ({
          product: i.product._id ?? i.product.id,
          quantity: i.quantity,
          deliveryType: i.deliveryType,
        })),
        address, phone, paymentMethod: payMethod,
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
    <BuyerShell>
      <div className="max-w-xl mx-auto px-5 py-5">
        <div className="flex items-center gap-2 mb-6">
          {steps.map((s, i) => (
            <div key={s} className="flex items-center gap-2 flex-1">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-semibold shrink-0 ${i < stepIdx ? "bg-emerald-500 text-white" : i === stepIdx ? "bg-blue-600 text-white" : "bg-gray-200 text-gray-500"}`}>
                {i < stepIdx ? <CheckCircle size={14} /> : i + 1}
              </div>
              <span className={`text-[12px] font-medium ${i === stepIdx ? "text-blue-600" : "text-gray-500"}`}>{s}</span>
              {i < 2 && <div className={`flex-1 h-0.5 ${i < stepIdx ? "bg-emerald-400" : "bg-gray-200"}`} />}
            </div>
          ))}
        </div>

        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 mb-5">
          <div className="text-[12px] text-blue-600 font-semibold mb-1.5">ЗАХИАЛГЫН ДҮН</div>
          {items.map(i => (
            <div key={i.product._id ?? i.product.id} className="flex justify-between text-[13px] text-gray-600 py-0.5">
              <span className="truncate flex-1 mr-3">{i.product.name} ×{i.quantity}</span>
              <span className="shrink-0">₮{(tierUnitPrice(i.product, i.quantity) * i.quantity).toLocaleString()}</span>
            </div>
          ))}
          <div className="flex justify-between text-[13px] text-gray-500 mt-1 pt-1 border-t border-blue-100">
            <span>Хүргэлт</span>
            <span>₮{items.reduce((s, i) => s + deliveryPriceFor(i.product.seller, i.deliveryType), 0).toLocaleString()}</span>
          </div>
          <div className="flex justify-between text-[16px] font-bold text-blue-700 mt-2 pt-2 border-t border-blue-200">
            <span>Нийт</span>
            <span>₮{orderTotal.toLocaleString()}</span>
          </div>
        </div>

        {err && (
          <div className="bg-red-50 border border-red-200 text-red-600 text-[13px] rounded-xl px-3.5 py-2.5 mb-4">⚠️ {err}</div>
        )}

        {step === "info" && (
          <form onSubmit={submitInfo} noValidate>
            <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
              <h2 className="text-[16px] font-semibold text-gray-900 mb-4">Хүргэлтийн мэдээлэл</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-[13px] font-medium text-gray-700 mb-1.5">Хүлээн авах хаяг</label>
                  <textarea value={address} onChange={e => { setAddress(e.target.value); setFormErrors(p => ({ ...p, address: undefined })); }}
                    className={`w-full bg-gray-50 border rounded-xl px-4 py-2.5 text-[16px] md:text-[13px] focus:bg-white transition-colors resize-none h-20 font-sans outline-none ${formErrors.address ? "border-red-400 focus:border-red-400" : "border-gray-200 focus:border-blue-500"}`}
                    placeholder="Дүүрэг, хороо, байр, орц, тоот..." />
                  {formErrors.address && <p className="text-[11px] text-red-500 mt-1">{formErrors.address}</p>}
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-gray-700 mb-1.5">Утасны дугаар</label>
                  <input type="tel" value={phone} onChange={e => { setPhone(e.target.value); setFormErrors(p => ({ ...p, phone: undefined })); }}
                    className={`w-full bg-gray-50 border rounded-xl px-4 py-2.5 text-[16px] md:text-[13px] focus:bg-white transition-colors outline-none ${formErrors.phone ? "border-red-400 focus:border-red-400" : "border-gray-200 focus:border-blue-500"}`}
                    placeholder="99001122" />
                  {formErrors.phone && <p className="text-[11px] text-red-500 mt-1">{formErrors.phone}</p>}
                </div>
              </div>
              <button type="submit"
                className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-xl py-3.5 text-[14px] font-semibold mt-5 cursor-pointer border-none transition-colors font-sans shadow-lg shadow-blue-200">
                Үргэлжлүүлэх →
              </button>
            </div>
          </form>
        )}

        {step === "payment" && (
          <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
            <button onClick={() => setStep("info")}
              className="flex items-center gap-1.5 text-[13px] text-gray-500 hover:text-blue-600 mb-4 cursor-pointer bg-transparent border-none transition-colors">
              <ArrowLeft size={13} /> Буцах
            </button>
            <h2 className="text-[16px] font-semibold text-gray-900 mb-4">Төлбөрийн арга</h2>

            <div className="space-y-3 mb-5">
              <label className={`flex items-center gap-3 border-2 rounded-xl p-4 cursor-pointer transition-all ${payMethod === "qpay" ? "border-blue-500 bg-blue-50" : "border-gray-200 hover:border-blue-300"}`}>
                <input type="radio" name="pay" value="qpay" checked={payMethod === "qpay"} onChange={() => setPayMethod("qpay")} className="accent-blue-600" />
                <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center shrink-0">
                  <QrCode size={20} className="text-blue-600" />
                </div>
                <div className="flex-1">
                  <div className="text-[14px] font-semibold text-gray-900">QPay</div>
                  <div className="text-[12px] text-gray-500">QR код скан хийж төлнө</div>
                </div>
                <span className="text-[11px] bg-blue-50 text-blue-600 border border-blue-100 px-2 py-0.5 rounded-full font-medium">Түгээмэл</span>
              </label>

              <label className={`flex items-center gap-3 border-2 rounded-xl p-4 cursor-pointer transition-all ${payMethod === "card" ? "border-blue-500 bg-blue-50" : "border-gray-200 hover:border-blue-300"}`}>
                <input type="radio" name="pay" value="card" checked={payMethod === "card"} onChange={() => setPayMethod("card")} className="accent-blue-600" />
                <div className="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center shrink-0">
                  <CreditCard size={20} className="text-emerald-600" />
                </div>
                <div className="flex-1">
                  <div className="text-[14px] font-semibold text-gray-900">Банкны карт</div>
                  <div className="text-[12px] text-gray-500">Visa, Mastercard · QPay-ээр</div>
                </div>
              </label>
            </div>

            {!user && (
              <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4 text-[13px] text-amber-700">
                <AlertCircle size={14} className="shrink-0" /> Төлбөр хийхийн тулд <Link href="/auth/login" className="underline font-semibold" style={{ textDecoration: "underline" }}>нэвтрэх</Link> шаардлагатай.
              </div>
            )}

            <button onClick={submitPayment} disabled={!user || busy}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white rounded-xl py-3.5 text-[14px] font-semibold cursor-pointer border-none transition-colors font-sans shadow-lg shadow-blue-200">
              {busy ? "Уншиж байна..." : `₮${orderTotal.toLocaleString()} — Төлбөр хийх`}
            </button>
          </div>
        )}

        {step === "qpay" && (
          <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm text-center">
            <div className="w-12 h-12 bg-blue-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <QrCode size={24} className="text-blue-600" />
            </div>
            <h2 className="text-[18px] font-semibold text-gray-900 mb-1">
              {payMethod === "card" ? "Картаар төлөх" : "QPay QR код"}
            </h2>
            <p className="text-[13px] text-gray-500 mb-5">
              {payMethod === "card"
                ? "QPay-ийн төлбөрийн хуудсаар Visa/Mastercard картаар төлнө үү"
                : "Утсандаа QPay app нээж QR скан хийнэ үү"}
            </p>

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

            {/* Card payment — open QPay's hosted page where Visa/Mastercard
                is accepted. Primary CTA when the buyer chose "card". */}
            {payMethod === "card" && qpayInvoice?.qPay_shortUrl && (
              <a href={qpayInvoice.qPay_shortUrl} target="_blank" rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 w-full bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl py-3 text-[14px] font-semibold mb-4 transition-colors">
                <CreditCard size={16} /> Картаар төлөх (QPay хуудас)
              </a>
            )}

            {/* Bank app deep links (from QPay urls) */}
            {qpayInvoice?.urls && qpayInvoice.urls.length > 0 && (
              <div className="grid grid-cols-3 gap-2 mb-4">
                {qpayInvoice.urls.slice(0, 6).map((u, i) => (
                  <a key={i} href={u.link} target="_blank" rel="noopener noreferrer"
                    className="text-[11px] bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 hover:border-blue-400 hover:bg-blue-50 transition-colors text-gray-700 font-medium">
                    {u.name}
                  </a>
                ))}
              </div>
            )}

            <div className="text-[12px] text-gray-500 mb-4">
              QR код хүчинтэй байх хугацаа:{" "}
              <span className={`font-bold ${qpayTimer < 60 ? "text-red-500" : "text-gray-700"}`}>{fmtTime(qpayTimer)}</span>
            </div>

            <div className="flex items-center justify-center gap-2 text-[13px] text-blue-600 font-medium py-3">
              <Loader2 size={14} className="animate-spin" />
              Төлбөрийг хүлээж байна...
            </div>

            {!qpayInvoice && (
              <button onClick={() => placeOrder("qpay")} disabled={busy}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-xl py-3 text-[13px] font-semibold cursor-pointer border-none transition-colors font-sans">
                Mock төлбөр баталгаажуулах
              </button>
            )}
            <button onClick={() => {
              if (pollRef.current) clearInterval(pollRef.current);
              setStep("payment");
            }}
              className="w-full mt-2 text-[13px] text-gray-500 hover:text-blue-600 cursor-pointer bg-transparent border-none py-1.5 transition-colors">
              ← Буцах
            </button>
          </div>
        )}
      </div>
    </BuyerShell>
  );
}

/**
 * RFQ checkout — a single-line checkout for an ACCEPTED quote.
 *
 * Reached via /checkout?rfq=<id> (from the buyer RFQ page "Худалдан авах"
 * button). It does NOT touch the cart: it loads the buyer's RFQs, finds the
 * accepted one, renders a one-item summary at the negotiated unit price, then
 * POSTs /orders with items:[{ product, quantity, rfq, deliveryType:"normal" }].
 * The server re-derives the price from the RFQ — money is never sent here.
 */
function RfqCheckout({ rfqId }: { rfqId: string }) {
  const router = useRouter();
  const { user } = useAuthStore();

  const [rfq, setRfq] = useState<Rfq | null>(null);
  const [loading, setLoading] = useState(true);

  const [step, setStep] = useState<Step>("info");
  const [payMethod, setPayMethod] = useState<PayMethod>("qpay");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState(user?.phone || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [qpayTimer, setQpayTimer] = useState(300);
  const [qpayInvoice, setQpayInvoice] = useState<QPayInvoice | null>(null);
  const [, setPendingOrderId] = useState<string | null>(null);
  const [formErrors, setFormErrors] = useState<{ address?: string; phone?: string }>({});
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  // Load the buyer's RFQs and pull out the one we're buying. Guard: it must
  // be accepted and not expired — otherwise the order create would fail, so
  // we bounce back to /rfq with a clear message instead.
  useEffect(() => {
    let alive = true;
    api.get<{ rfqs: Rfq[] }>("/rfq/mine")
      .then((d) => {
        if (!alive) return;
        const found = d.rfqs.find((r) => r._id === rfqId) || null;
        if (!found) {
          toast.error("Үнийн санал олдсонгүй.");
          router.replace("/rfq");
          return;
        }
        if (found.status !== "accepted") {
          toast.warning("Зөвхөн зөвшөөрсөн үнийн саналаар худалдан авна.");
          router.replace("/rfq");
          return;
        }
        if (found.quote?.validUntil && new Date(found.quote.validUntil).getTime() <= Date.now()) {
          toast.error("Үнийн саналын хугацаа дууссан байна.");
          router.replace("/rfq");
          return;
        }
        setRfq(found);
      })
      .catch(() => {
        if (!alive) return;
        toast.error("Үнийн санал ачаалж чадсангүй.");
        router.replace("/rfq");
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [rfqId, router]);

  if (loading || !rfq) return (
    <BuyerShell>
      <div className="min-h-[70vh] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    </BuyerShell>
  );

  // All money is sourced from the accepted quote. Delivery resolves from the
  // seller config (the server re-derives the authoritative total at create).
  const unitPrice = rfq.quote?.unitPrice ?? rfq.productSnapshot.basePrice;
  const productId =
    typeof rfq.product === "object" ? rfq.product._id : (rfq.product as string);
  const sellerRef = typeof rfq.seller === "object" ? rfq.seller : undefined;
  const lineSubtotal = unitPrice * rfq.qty;
  const deliveryFee = deliveryPriceFor(sellerRef, "normal");
  const orderTotal = lineSubtotal + deliveryFee;

  const prodImg =
    (typeof rfq.product === "object" && rfq.product.images?.length
      ? rfq.product.images[0]
      : rfq.productSnapshot.image) || null;
  const prodName =
    (typeof rfq.product === "object" ? rfq.product.name : "") || rfq.productSnapshot.name;

  const MN_PHONE_RE = /^[6-9]\d{7}$/;

  const submitInfo = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: { address?: string; phone?: string } = {};
    if (!address.trim()) errs.address = "Хаяг оруулна уу";
    if (!MN_PHONE_RE.test(phone.replace(/\s/g, ""))) {
      errs.phone = "Монгол утасны дугаар 8 оронтой байх ёстой (жнь: 99001122)";
    }
    if (Object.keys(errs).length) { setFormErrors(errs); return; }
    setFormErrors({});
    setStep("payment");
  };

  // Build the single RFQ line. The negotiated price is applied server-side
  // from the `rfq` id — we never send a price field.
  const orderPayload = (method: PayMethod) => ({
    items: [{ product: productId, quantity: rfq.qty, rfq: rfqId, deliveryType: "normal" as const }],
    address, phone, paymentMethod: method,
  });

  const submitPayment = async () => {
    setErr("");
    setBusy(true);
    try {
      const { order } = await api.post<{ order: Order }>("/orders", orderPayload(payMethod));
      const orderId = (order._id ?? order.id) as string;
      setPendingOrderId(orderId);

      try {
        const { invoice } = await api.post<{ invoice: QPayInvoice }>("/qpay/invoice", { orderId });
        setQpayInvoice(invoice);
      } catch (e) {
        if ((e as ApiError).status !== 503) throw e;
      }
      setStep("qpay");
      const interval = setInterval(() => {
        setQpayTimer(t => { if (t <= 1) { clearInterval(interval); return 0; } return t - 1; });
      }, 1000);
      pollRef.current = setInterval(async () => {
        try {
          const r = await api.get<{ status: string; paid: boolean }>(`/qpay/check/${orderId}`);
          if (r.paid) {
            if (pollRef.current) clearInterval(pollRef.current);
            clearInterval(interval);
            router.push(`/orders?new=${orderId}`);
          }
        } catch { /* ignore */ }
      }, 3000);
    } catch (e) {
      setErr((e as Error).message || "Алдаа гарлаа");
      setStep("payment");
    } finally {
      setBusy(false);
    }
  };

  const placeOrder = async (method: PayMethod) => {
    setBusy(true); setErr("");
    try {
      const { order } = await api.post<{ order: Order }>("/orders", orderPayload(method));
      router.push(`/orders?new=${order._id ?? order.id}`);
    } catch (e) {
      setErr((e as Error).message || "Алдаа гарлаа");
      setStep("payment");
    } finally {
      setBusy(false);
    }
  };

  const fmtTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
  const steps = ["Мэдээлэл", "Төлбөр", "Баталгаа"];
  const stepIdx = step === "info" ? 0 : step === "payment" ? 1 : 2;

  return (
    <BuyerShell>
      <div className="max-w-xl mx-auto px-5 py-5">
        <div className="flex items-center gap-2 mb-4">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-full">
            <MessageSquareQuote size={12} /> Үнийн саналаар худалдан авч байна
          </span>
        </div>

        <div className="flex items-center gap-2 mb-6">
          {steps.map((s, i) => (
            <div key={s} className="flex items-center gap-2 flex-1">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-semibold shrink-0 ${i < stepIdx ? "bg-emerald-500 text-white" : i === stepIdx ? "bg-blue-600 text-white" : "bg-gray-200 text-gray-500"}`}>
                {i < stepIdx ? <CheckCircle size={14} /> : i + 1}
              </div>
              <span className={`text-[12px] font-medium ${i === stepIdx ? "text-blue-600" : "text-gray-500"}`}>{s}</span>
              {i < 2 && <div className={`flex-1 h-0.5 ${i < stepIdx ? "bg-emerald-400" : "bg-gray-200"}`} />}
            </div>
          ))}
        </div>

        {/* Order summary — single RFQ line at the negotiated unit price */}
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 mb-5">
          <div className="text-[12px] text-blue-600 font-semibold mb-2">ЗАХИАЛГЫН ДҮН</div>
          <div className="flex items-center gap-3 mb-2">
            <div className="relative w-11 h-11 rounded-lg overflow-hidden bg-white border border-blue-100 shrink-0 flex items-center justify-center">
              {prodImg
                ? <Image src={prodImg} alt={prodName} fill sizes="44px" className="object-cover" unoptimized />
                : <Package size={16} className="text-gray-300" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold text-gray-900 truncate">{prodName}</div>
              <div className="text-[11px] text-gray-500">{rfq.qty} × ₮{unitPrice.toLocaleString()} (тохирсон үнэ)</div>
            </div>
            <span className="text-[13px] font-semibold text-gray-700 shrink-0">₮{lineSubtotal.toLocaleString()}</span>
          </div>
          <div className="flex justify-between text-[13px] text-gray-500 mt-1 pt-1 border-t border-blue-100">
            <span>Хүргэлт</span>
            <span>₮{deliveryFee.toLocaleString()}</span>
          </div>
          <div className="flex justify-between text-[16px] font-bold text-blue-700 mt-2 pt-2 border-t border-blue-200">
            <span>Нийт</span>
            <span>₮{orderTotal.toLocaleString()}</span>
          </div>
        </div>

        {err && (
          <div className="bg-red-50 border border-red-200 text-red-600 text-[13px] rounded-xl px-3.5 py-2.5 mb-4">⚠️ {err}</div>
        )}

        {step === "info" && (
          <form onSubmit={submitInfo} noValidate>
            <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
              <h2 className="text-[16px] font-semibold text-gray-900 mb-4">Хүргэлтийн мэдээлэл</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-[13px] font-medium text-gray-700 mb-1.5">Хүлээн авах хаяг</label>
                  <textarea value={address} onChange={e => { setAddress(e.target.value); setFormErrors(p => ({ ...p, address: undefined })); }}
                    className={`w-full bg-gray-50 border rounded-xl px-4 py-2.5 text-[16px] md:text-[13px] focus:bg-white transition-colors resize-none h-20 font-sans outline-none ${formErrors.address ? "border-red-400 focus:border-red-400" : "border-gray-200 focus:border-blue-500"}`}
                    placeholder="Дүүрэг, хороо, байр, орц, тоот..." />
                  {formErrors.address && <p className="text-[11px] text-red-500 mt-1">{formErrors.address}</p>}
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-gray-700 mb-1.5">Утасны дугаар</label>
                  <input type="tel" value={phone} onChange={e => { setPhone(e.target.value); setFormErrors(p => ({ ...p, phone: undefined })); }}
                    className={`w-full bg-gray-50 border rounded-xl px-4 py-2.5 text-[16px] md:text-[13px] focus:bg-white transition-colors outline-none ${formErrors.phone ? "border-red-400 focus:border-red-400" : "border-gray-200 focus:border-blue-500"}`}
                    placeholder="99001122" />
                  {formErrors.phone && <p className="text-[11px] text-red-500 mt-1">{formErrors.phone}</p>}
                </div>
              </div>
              <button type="submit"
                className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-xl py-3.5 text-[14px] font-semibold mt-5 cursor-pointer border-none transition-colors font-sans shadow-lg shadow-blue-200">
                Үргэлжлүүлэх →
              </button>
            </div>
          </form>
        )}

        {step === "payment" && (
          <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
            <button onClick={() => setStep("info")}
              className="flex items-center gap-1.5 text-[13px] text-gray-500 hover:text-blue-600 mb-4 cursor-pointer bg-transparent border-none transition-colors">
              <ArrowLeft size={13} /> Буцах
            </button>
            <h2 className="text-[16px] font-semibold text-gray-900 mb-4">Төлбөрийн арга</h2>

            <div className="space-y-3 mb-5">
              <label className={`flex items-center gap-3 border-2 rounded-xl p-4 cursor-pointer transition-all ${payMethod === "qpay" ? "border-blue-500 bg-blue-50" : "border-gray-200 hover:border-blue-300"}`}>
                <input type="radio" name="pay" value="qpay" checked={payMethod === "qpay"} onChange={() => setPayMethod("qpay")} className="accent-blue-600" />
                <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center shrink-0">
                  <QrCode size={20} className="text-blue-600" />
                </div>
                <div className="flex-1">
                  <div className="text-[14px] font-semibold text-gray-900">QPay</div>
                  <div className="text-[12px] text-gray-500">QR код скан хийж төлнө</div>
                </div>
                <span className="text-[11px] bg-blue-50 text-blue-600 border border-blue-100 px-2 py-0.5 rounded-full font-medium">Түгээмэл</span>
              </label>

              <label className={`flex items-center gap-3 border-2 rounded-xl p-4 cursor-pointer transition-all ${payMethod === "card" ? "border-blue-500 bg-blue-50" : "border-gray-200 hover:border-blue-300"}`}>
                <input type="radio" name="pay" value="card" checked={payMethod === "card"} onChange={() => setPayMethod("card")} className="accent-blue-600" />
                <div className="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center shrink-0">
                  <CreditCard size={20} className="text-emerald-600" />
                </div>
                <div className="flex-1">
                  <div className="text-[14px] font-semibold text-gray-900">Банкны карт</div>
                  <div className="text-[12px] text-gray-500">Visa, Mastercard · QPay-ээр</div>
                </div>
              </label>
            </div>

            {!user && (
              <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4 text-[13px] text-amber-700">
                <AlertCircle size={14} className="shrink-0" /> Төлбөр хийхийн тулд <Link href="/auth/login" className="underline font-semibold" style={{ textDecoration: "underline" }}>нэвтрэх</Link> шаардлагатай.
              </div>
            )}

            <button onClick={submitPayment} disabled={!user || busy}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white rounded-xl py-3.5 text-[14px] font-semibold cursor-pointer border-none transition-colors font-sans shadow-lg shadow-blue-200">
              {busy ? "Уншиж байна..." : `₮${orderTotal.toLocaleString()} — Төлбөр хийх`}
            </button>
          </div>
        )}

        {step === "qpay" && (
          <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm text-center">
            <div className="w-12 h-12 bg-blue-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <QrCode size={24} className="text-blue-600" />
            </div>
            <h2 className="text-[18px] font-semibold text-gray-900 mb-1">
              {payMethod === "card" ? "Картаар төлөх" : "QPay QR код"}
            </h2>
            <p className="text-[13px] text-gray-500 mb-5">
              {payMethod === "card"
                ? "QPay-ийн төлбөрийн хуудсаар Visa/Mastercard картаар төлнө үү"
                : "Утсандаа QPay app нээж QR скан хийнэ үү"}
            </p>

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

            {payMethod === "card" && qpayInvoice?.qPay_shortUrl && (
              <a href={qpayInvoice.qPay_shortUrl} target="_blank" rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 w-full bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl py-3 text-[14px] font-semibold mb-4 transition-colors">
                <CreditCard size={16} /> Картаар төлөх (QPay хуудас)
              </a>
            )}

            {qpayInvoice?.urls && qpayInvoice.urls.length > 0 && (
              <div className="grid grid-cols-3 gap-2 mb-4">
                {qpayInvoice.urls.slice(0, 6).map((u, i) => (
                  <a key={i} href={u.link} target="_blank" rel="noopener noreferrer"
                    className="text-[11px] bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 hover:border-blue-400 hover:bg-blue-50 transition-colors text-gray-700 font-medium">
                    {u.name}
                  </a>
                ))}
              </div>
            )}

            <div className="text-[12px] text-gray-500 mb-4">
              QR код хүчинтэй байх хугацаа:{" "}
              <span className={`font-bold ${qpayTimer < 60 ? "text-red-500" : "text-gray-700"}`}>{fmtTime(qpayTimer)}</span>
            </div>

            <div className="flex items-center justify-center gap-2 text-[13px] text-blue-600 font-medium py-3">
              <Loader2 size={14} className="animate-spin" />
              Төлбөрийг хүлээж байна...
            </div>

            {!qpayInvoice && (
              <button onClick={() => placeOrder("qpay")} disabled={busy}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-xl py-3 text-[13px] font-semibold cursor-pointer border-none transition-colors font-sans">
                Mock төлбөр баталгаажуулах
              </button>
            )}
            <button onClick={() => {
              if (pollRef.current) clearInterval(pollRef.current);
              setStep("payment");
            }}
              className="w-full mt-2 text-[13px] text-gray-500 hover:text-blue-600 cursor-pointer bg-transparent border-none py-1.5 transition-colors">
              ← Буцах
            </button>
          </div>
        )}
      </div>
    </BuyerShell>
  );
}

/**
 * Route entry. `useSearchParams` requires a Suspense boundary in the App
 * Router; the inner switcher picks the RFQ checkout when ?rfq=<id> is set,
 * otherwise the normal cart checkout (untouched).
 */
function CheckoutRouter() {
  const rfqId = useSearchParams().get("rfq");
  return rfqId ? <RfqCheckout rfqId={rfqId} /> : <CartCheckout />;
}

export default function CheckoutPage() {
  return (
    <Suspense fallback={
      <BuyerShell>
        <div className="min-h-[70vh] flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
      </BuyerShell>
    }>
      <CheckoutRouter />
    </Suspense>
  );
}
