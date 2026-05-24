"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store";
import { Review } from "@/app/types";
import { Star, ShieldCheck, MessageSquare, Trash2 } from "lucide-react";

export default function ReviewSection({ productId, rating, ratingCount }: {
  productId: string; rating?: number; ratingCount?: number;
}) {
  const { user } = useAuthStore();
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [myRating, setMyRating] = useState(0);
  const [myComment, setMyComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [success, setSuccess] = useState("");

  const reload = async () => {
    setLoading(true);
    try {
      const { reviews } = await api.get<{ reviews: Review[] }>(`/products/${productId}/reviews`);
      setReviews(reviews);
      // Pre-fill own existing review
      if (user) {
        const mine = reviews.find(r => typeof r.user === "object" && r.user._id === (user._id ?? user.id));
        if (mine) {
          setMyRating(mine.rating);
          setMyComment(mine.comment);
        }
      }
    } finally {
      setLoading(false);
    }
  };

  // queueMicrotask defers reload()'s setLoading(true) past the effect
  // commit — React 19 warns on sync setState in effect bodies.
  useEffect(() => { queueMicrotask(reload); /* eslint-disable-next-line */ }, [productId, user]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!myRating) { setErr("Оноо өгнө үү (1-5)"); return; }
    setBusy(true); setErr(""); setSuccess("");
    try {
      // Try create; if 409 (already reviewed), update instead
      try {
        await api.post(`/products/${productId}/reviews`, { rating: myRating, comment: myComment });
        setSuccess("Сэтгэгдэл нэмэгдлээ ✓");
      } catch (e) {
        const msg = (e as Error).message;
        if (msg.includes("аль хэдийн")) {
          await api.put(`/products/${productId}/reviews`, { rating: myRating, comment: myComment });
          setSuccess("Сэтгэгдэл шинэчлэгдлээ ✓");
        } else throw e;
      }
      await reload();
      setTimeout(() => setSuccess(""), 2500);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const deleteMine = async () => {
    if (!confirm("Сэтгэгдлээ устгах уу?")) return;
    await api.delete(`/products/${productId}/reviews`);
    setMyRating(0);
    setMyComment("");
    reload();
  };

  const myReview = user && reviews.find(r => typeof r.user === "object" && r.user._id === (user._id ?? user.id));

  return (
    <div className="mt-8 pt-6 border-t border-gray-200">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-[16px] font-semibold text-gray-900 flex items-center gap-2">
          <MessageSquare size={16} /> Сэтгэгдлүүд
          <span className="text-[13px] text-gray-400 font-normal">({ratingCount ?? reviews.length})</span>
        </h2>
        {(rating ?? 0) > 0 && (
          <div className="flex items-center gap-1">
            <div className="flex">
              {[1, 2, 3, 4, 5].map(n => (
                <Star key={n} size={16} className={n <= Math.round(rating ?? 0) ? "text-amber-400" : "text-gray-200"} fill={n <= Math.round(rating ?? 0) ? "currentColor" : "none"} />
              ))}
            </div>
            <span className="text-[14px] font-bold text-gray-900 ml-1">{(rating ?? 0).toFixed(1)}</span>
          </div>
        )}
      </div>

      {/* My review form */}
      {user ? (
        <form onSubmit={submit} className="bg-white border border-gray-200 rounded-2xl p-4 mb-4">
          <div className="text-[13px] font-medium text-gray-700 mb-2">{myReview ? "Сэтгэгдлээ засах" : "Сэтгэгдэл бичих"}</div>
          {err && <div className="bg-red-50 border border-red-200 text-red-600 text-[12px] rounded-lg px-3 py-2 mb-2">{err}</div>}
          {success && <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 text-[12px] rounded-lg px-3 py-2 mb-2">{success}</div>}
          <div className="flex items-center gap-1 mb-3">
            {[1, 2, 3, 4, 5].map(n => (
              <button key={n} type="button" onClick={() => setMyRating(n)}
                className="w-7 h-7 flex items-center justify-center cursor-pointer bg-transparent border-none">
                <Star size={20} className={n <= myRating ? "text-amber-400" : "text-gray-300 hover:text-amber-300"} fill={n <= myRating ? "currentColor" : "none"} />
              </button>
            ))}
            <span className="text-[12px] text-gray-500 ml-2">{myRating ? `${myRating}/5` : "Оноо сонгох"}</span>
          </div>
          <textarea value={myComment} onChange={e => setMyComment(e.target.value)} maxLength={1000}
            className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-[13px] focus:border-blue-500 focus:bg-white transition-colors resize-none h-20 font-sans"
            placeholder="Сэлбэгийн чанар, хүргэлт, тохирол... (заавал биш)" />
          <div className="flex gap-2 mt-3">
            <button type="submit" disabled={busy || !myRating}
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-lg px-4 py-2 text-[13px] font-semibold cursor-pointer border-none transition-colors font-sans">
              {busy ? "..." : myReview ? "Шинэчлэх" : "Илгээх"}
            </button>
            {myReview && (
              <button type="button" onClick={deleteMine}
                className="border border-red-200 text-red-500 hover:bg-red-50 rounded-lg px-4 py-2 text-[13px] font-medium cursor-pointer bg-white transition-colors font-sans flex items-center gap-1">
                <Trash2 size={12} /> Устгах
              </button>
            )}
          </div>
        </form>
      ) : (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-[13px] text-gray-500 mb-4 text-center">
          Сэтгэгдэл бичихийн тулд <a href="/auth/login" className="text-blue-600 font-semibold underline">нэвтэрнэ</a> үү
        </div>
      )}

      {/* All reviews */}
      {loading ? (
        <div className="text-center py-6 text-gray-400 text-[13px]">Уншиж байна...</div>
      ) : reviews.length === 0 ? (
        <div className="text-center py-6 text-gray-400 text-[13px]">Хараахан сэтгэгдэл алга</div>
      ) : (
        <div className="space-y-2">
          {reviews.map(r => {
            const reviewer = typeof r.user === "object" ? r.user : null;
            return (
              <div key={r._id} className="bg-white border border-gray-200 rounded-xl p-3">
                <div className="flex items-center gap-2 mb-1.5">
                  <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-[11px] font-bold">
                    {(reviewer?.name ?? "?")[0]?.toUpperCase()}
                  </div>
                  <span className="text-[13px] font-medium text-gray-900">{reviewer?.name ?? "Anonymous"}</span>
                  {r.verifiedPurchase && (
                    <span className="inline-flex items-center gap-0.5 text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.5 rounded-full font-medium">
                      <ShieldCheck size={9} /> Худалдан авсан
                    </span>
                  )}
                  <span className="text-[11px] text-gray-400 ml-auto">{new Date(r.createdAt).toLocaleDateString("mn-MN")}</span>
                </div>
                <div className="flex items-center gap-1 mb-1">
                  {[1, 2, 3, 4, 5].map(n => (
                    <Star key={n} size={12} className={n <= r.rating ? "text-amber-400" : "text-gray-200"} fill={n <= r.rating ? "currentColor" : "none"} />
                  ))}
                </div>
                {r.comment && <p className="text-[13px] text-gray-700 mt-1.5">{r.comment}</p>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
