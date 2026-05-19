"use client";

/**
 * Buyer-facing "file a dispute" modal.
 *
 * Wired to POST /api/disputes with:
 *   { orderId, reason, description, requestedRefundAmount, evidenceImages[] }
 *
 * Evidence images go through the existing /api/upload Cloudinary endpoint
 * — we just pass back the secure_url. Keep the upload concurrent so
 * multi-image selection doesn't feel laggy.
 */

import { useState } from "react";
import Image from "next/image";
import { api, ApiError, getToken } from "@/lib/api";
import { Order, DisputeReason } from "@/app/types";
import { AlertTriangle, Loader2, Upload, X, Scale } from "lucide-react";

const REASONS: Array<{ id: DisputeReason; label: string; hint: string }> = [
  { id: "not_received",     label: "Хүргэгдээгүй",       hint: "Захиалга огт ирээгүй" },
  { id: "wrong_item",       label: "Буруу бараа",        hint: "Захиалснаас өөр бараа ирсэн" },
  { id: "damaged",          label: "Гэмтэлтэй",          hint: "Хүргэлтэд гэмтсэн / эвдэрсэн" },
  { id: "defective",        label: "Ажиллахгүй",         hint: "Бараа ажиллахгүй байна" },
  { id: "not_as_described", label: "Тайлбартай таарахгүй", hint: "Зураг / тайлбараас ялгаатай" },
  { id: "counterfeit",      label: "Хуурамч",            hint: "OEM гэсэн боловч хуурамч" },
  { id: "other",            label: "Бусад",              hint: "Тайлбарт дэлгэрэнгүй бичнэ үү" },
];

export default function DisputeModal({
  order, onClose, onCreated,
}: { order: Order; onClose: () => void; onCreated: () => void }) {
  const [reason, setReason]           = useState<DisputeReason>("wrong_item");
  const [description, setDescription] = useState("");
  const [amount, setAmount]           = useState(String(order.total));
  const [images, setImages]           = useState<string[]>([]);
  const [uploading, setUploading]     = useState(false);
  const [busy, setBusy]               = useState(false);
  const [err, setErr]                 = useState("");

  const orderId = (order._id ?? order.id) as string;
  const max = order.total;

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true); setErr("");
    try {
      const uploads = await Promise.all(
        Array.from(files).slice(0, 8 - images.length).map(async (file) => {
          const fd = new FormData();
          fd.append("file", file);
          const res = await fetch(
            `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:5001/api"}/upload`,
            { method: "POST", body: fd, headers: { Authorization: `Bearer ${getToken() || ""}` } },
          );
          if (!res.ok) throw new Error("Зураг байршуулж чадсангүй");
          const data = await res.json();
          return data.url || data.secure_url;
        }),
      );
      setImages((prev) => [...prev, ...uploads.filter(Boolean)]);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    setErr("");
    const n = Math.floor(Number(amount));
    if (!Number.isFinite(n) || n <= 0 || n > max) {
      setErr(`Буцаалт ₮1 – ₮${max.toLocaleString()} хооронд`);
      return;
    }
    if (description.trim().length < 10) {
      setErr("Тайлбарыг 10-аас илүү тэмдэгтээр бичнэ үү");
      return;
    }
    setBusy(true);
    try {
      await api.post("/disputes", {
        orderId,
        reason,
        description: description.trim(),
        requestedRefundAmount: n,
        evidenceImages: images,
      });
      onCreated();
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
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}>
        <header className="sticky top-0 bg-white px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-gray-900 flex items-center gap-2">
            <Scale size={15} className="text-rose-600" /> Маргаан гаргах
          </h2>
          <button onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 cursor-pointer bg-transparent border-none">
            <X size={15} />
          </button>
        </header>

        <div className="p-5 space-y-4">
          <div className="bg-amber-50 border border-amber-200 text-amber-800 text-[12px] rounded-xl p-3 flex items-start gap-2">
            <AlertTriangle size={13} className="shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold mb-0.5">Худалдагчид 48 цаг хариу өгнө</div>
              <div>Хариу ирэхгүй бол автомат бүрэн буцаалт хийгдэнэ. AI хоёр талын түүхийг шинжилнэ.</div>
            </div>
          </div>

          <div>
            <label className="block text-[12px] font-medium text-gray-700 mb-1.5">Шалтгаан</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {REASONS.map((r) => (
                <label key={r.id}
                  className={`flex items-start gap-2 border rounded-lg p-2.5 cursor-pointer transition-colors ${
                    reason === r.id ? "border-violet-500 bg-violet-50" : "border-gray-200 hover:border-violet-300"
                  }`}>
                  <input type="radio" name="reason" value={r.id} checked={reason === r.id}
                    onChange={() => setReason(r.id)} className="mt-0.5 accent-violet-600 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-[12px] font-semibold text-gray-900">{r.label}</div>
                    <div className="text-[10px] text-gray-500 leading-snug">{r.hint}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-[12px] font-medium text-gray-700 mb-1.5">Дэлгэрэнгүй тайлбар</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              maxLength={4000}
              placeholder="Юу болсон, та яаж мэдсэн, ямар хариу хүлээж байгаа..."
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] focus:border-violet-500 outline-none resize-none font-sans"
            />
            <div className="text-[10px] text-gray-400 text-right mt-1">{description.length}/4000</div>
          </div>

          <div>
            <label className="block text-[12px] font-medium text-gray-700 mb-1.5">
              Буцаалт хүсэх дүн (хамгийн ихдээ ₮{max.toLocaleString()})
            </label>
            <div className="flex items-center gap-2">
              <span className="text-[13px] text-gray-500">₮</span>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                min={1} max={max} step={1000}
                className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-[13px] focus:border-violet-500 outline-none"
              />
              <button type="button" onClick={() => setAmount(String(max))}
                className="text-[12px] text-violet-700 hover:underline cursor-pointer bg-transparent border-none font-sans">
                Бүгд
              </button>
            </div>
          </div>

          <div>
            <label className="block text-[12px] font-medium text-gray-700 mb-1.5">Нотолгоо зураг (зөвлөмжтэй)</label>
            <div className="flex flex-wrap gap-2">
              {images.map((url, i) => (
                <div key={i} className="relative w-20 h-20 rounded-lg overflow-hidden border border-gray-200 group">
                  <Image src={url} alt="" fill sizes="80px" className="object-cover" unoptimized />
                  <button onClick={() => setImages((prev) => prev.filter((_, idx) => idx !== i))}
                    className="absolute top-1 right-1 w-5 h-5 bg-black/60 text-white rounded-full flex items-center justify-center cursor-pointer border-none">
                    <X size={10} />
                  </button>
                </div>
              ))}
              {images.length < 8 && (
                <label className={`w-20 h-20 border-2 border-dashed rounded-lg flex flex-col items-center justify-center cursor-pointer transition-colors ${
                  uploading ? "border-violet-300 bg-violet-50" : "border-gray-300 hover:border-violet-400"
                }`}>
                  <input type="file" accept="image/*" multiple className="hidden"
                    onChange={(e) => onFiles(e.target.files)} disabled={uploading} />
                  {uploading
                    ? <Loader2 size={16} className="animate-spin text-violet-500" />
                    : <Upload size={16} className="text-gray-400" />}
                  <span className="text-[10px] text-gray-400 mt-1">{uploading ? "Хадгалж…" : "Нэмэх"}</span>
                </label>
              )}
            </div>
            <div className="text-[10px] text-gray-400 mt-1">Хамгийн ихдээ 8 зураг</div>
          </div>

          {err && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg p-2.5 text-[12px]">
              <AlertTriangle size={13} className="shrink-0 mt-0.5" />
              <span>{err}</span>
            </div>
          )}
        </div>

        <footer className="sticky bottom-0 bg-white px-5 py-3 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onClose}
            className="bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg px-4 py-2 text-[12px] font-semibold cursor-pointer border-none transition-colors font-sans">
            Болих
          </button>
          <button onClick={submit} disabled={busy || uploading}
            className="bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white rounded-lg px-4 py-2 text-[12px] font-semibold cursor-pointer border-none transition-colors font-sans inline-flex items-center gap-1.5">
            {busy && <Loader2 size={12} className="animate-spin" />} Маргаан илгээх
          </button>
        </footer>
      </div>
    </div>
  );
}
