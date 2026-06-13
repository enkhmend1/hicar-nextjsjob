"use client";

/**
 * RfqModal — buyer "request a quote" ("Үнийн санал авах") dialog.
 *
 * Opened from the product page CTA row. Collects a quantity (defaults to
 * the quantity the buyer already picked on the product page) and an
 * optional free-text message, then POSTs to /rfq:
 *
 *   POST /rfq  { product, qty, message? }  →  { rfq }
 *
 * The seller is notified and answers with a unit price on /seller/rfq;
 * the buyer follows up on /rfq. Money is NEVER sent from the client — the
 * negotiated unit price is applied server-side at order create.
 *
 * Styling mirrors DisputeModal: black/40 backdrop, white rounded-2xl card,
 * sticky header/footer, inline red feedback banner, blue primary CTA.
 */

import { useState } from "react";
import Image from "next/image";
import { api, ApiError } from "@/lib/api";
import { toast } from "@/app/lib/toast";
import { Product } from "@/app/types";
import { Loader2, X, MessageSquareQuote, Minus, Plus, Package } from "lucide-react";

export default function RfqModal({
  product, defaultQty = 1, onClose, onSent,
}: {
  product: Product;
  /** Pre-fills the quantity field with whatever the buyer chose on the page. */
  defaultQty?: number;
  onClose: () => void;
  onSent?: () => void;
}) {
  const [qty, setQty] = useState(Math.max(1, Math.floor(defaultQty) || 1));
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const productId = (product._id ?? product.id) as string;
  const image = product.images && product.images.length > 0 ? product.images[0] : null;

  const submit = async () => {
    setErr("");
    const quantity = Math.max(1, Math.floor(qty) || 1);
    setBusy(true);
    try {
      await api.post("/rfq", {
        product: productId,
        qty: quantity,
        message: message.trim() || undefined,
      });
      toast.success("Үнийн санал илгээгдлээ. Худалдагч хариу өгмөгц мэдэгдэнэ.", {
        action: { label: "Үнийн саналууд", href: "/rfq" },
      });
      onSent?.();
      onClose();
    } catch (e) {
      setErr((e as ApiError).message || "Алдаа гарлаа");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}>
        <header className="sticky top-0 bg-white px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-gray-900 flex items-center gap-2">
            <MessageSquareQuote size={15} className="text-blue-600" /> Үнийн санал авах
          </h2>
          <button onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 cursor-pointer bg-transparent border-none">
            <X size={15} />
          </button>
        </header>

        <div className="p-5 space-y-4">
          {/* Product summary */}
          <div className="flex items-center gap-3 bg-gray-50 border border-gray-200 rounded-xl p-3">
            <div className="relative w-12 h-12 rounded-lg overflow-hidden bg-white border border-gray-200 shrink-0 flex items-center justify-center">
              {image
                ? <Image src={image} alt={product.name} fill sizes="48px" className="object-cover" unoptimized />
                : <Package size={18} className="text-gray-300" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold text-gray-900 truncate">{product.name}</div>
              <div className="text-[11px] text-gray-500">
                {product.oem ? <span className="font-mono">{product.oem} · </span> : null}
                Жагсаалтын үнэ ₮{product.price.toLocaleString()}
              </div>
            </div>
          </div>

          {/* Quantity */}
          <div>
            <label className="block text-[12px] font-medium text-gray-700 mb-1.5">Тоо ширхэг</label>
            <div className="inline-flex items-center border-2 border-gray-200 rounded-xl overflow-hidden">
              <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} disabled={qty <= 1}
                className="w-10 h-11 flex items-center justify-center text-gray-500 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer bg-transparent border-none">
                <Minus size={14} />
              </button>
              <input
                type="number"
                min={1}
                value={qty}
                onChange={(e) => setQty(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
                className="w-16 h-11 text-center text-[16px] md:text-[14px] font-semibold text-gray-900 border-none focus:outline-none bg-transparent"
              />
              <button type="button" onClick={() => setQty((q) => q + 1)}
                className="w-10 h-11 flex items-center justify-center text-gray-500 hover:bg-gray-50 cursor-pointer bg-transparent border-none">
                <Plus size={14} />
              </button>
            </div>
          </div>

          {/* Message */}
          <div>
            <label className="block text-[12px] font-medium text-gray-700 mb-1.5">
              Худалдагчид зурвас <span className="text-gray-400 font-normal">(заавал биш)</span>
            </label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
              maxLength={1000}
              placeholder="Жнь: 40ш байнга авна, хямдрал/хүргэлт боломжтой юу?"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[16px] md:text-[13px] focus:border-blue-500 outline-none resize-none font-sans"
            />
            <div className="text-[10px] text-gray-400 text-right mt-1">{message.length}/1000</div>
          </div>

          {err && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg p-2.5 text-[12px]">
              <span>⚠️ {err}</span>
            </div>
          )}
        </div>

        <footer className="sticky bottom-0 bg-white px-5 py-3 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onClose} disabled={busy}
            className="bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg px-4 py-2 text-[12px] font-semibold cursor-pointer border-none transition-colors font-sans disabled:opacity-50">
            Болих
          </button>
          <button onClick={submit} disabled={busy}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg px-4 py-2 text-[12px] font-semibold cursor-pointer border-none transition-colors font-sans inline-flex items-center gap-1.5">
            {busy && <Loader2 size={12} className="animate-spin" />} Үнийн санал илгээх
          </button>
        </footer>
      </div>
    </div>
  );
}
