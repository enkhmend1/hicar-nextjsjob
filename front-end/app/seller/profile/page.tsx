"use client";

/**
 * Seller profile + settings page — Phase Q.2 redesign.
 *
 * Reorganised from a small single-column form into a two-column "settings
 * + live preview" layout, the same shape eBay / Etsy seller hubs use:
 *
 *   ┌─────────────────────────────────────────────────────────────────┐
 *   │  Header row: title + "View my storefront" CTA (copy URL button) │
 *   ├──────────────────────────────────────┬──────────────────────────┤
 *   │  Tab: Branding / Payouts / Inventory │  Sticky "Live preview"  │
 *   │  ┌─ Branding section ──────────────┐ │  card on the right       │
 *   │  │ Cover image (16:5)              │ │  (desktop only) showing  │
 *   │  │ Logo (1:1)                      │ │  how the storefront      │
 *   │  │ Shop name / description         │ │  looks with the latest   │
 *   │  └─────────────────────────────────┘ │  unsaved values          │
 *   │  …                                   │                          │
 *   └──────────────────────────────────────┴──────────────────────────┘
 *
 * Why a live preview:
 *   The biggest UX gap in the previous version was that sellers couldn't
 *   tell what their public store would look like until they saved AND
 *   navigated to /store/[id]. Slow feedback loop → fewer sellers
 *   bothering to polish their shop. With the inline preview every keystroke
 *   in the form mirrors into the card on the right.
 *
 * Why a header CTA + copy URL:
 *   eBay / Etsy / Shopify all surface the public URL at the top of the
 *   seller hub so the seller can grab their store link and share it
 *   in one click. Lowers the activation energy for "tell your customers
 *   about your shop".
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useAuthStore } from "@/store";
import { api } from "@/lib/api";
import { User, DeliveryOptions, DeliveryTierKey, DeliveryUnit } from "@/app/types";
import {
  mergeDeliveryOptions, DELIVERY_TIER_ORDER, DELIVERY_TIER_META,
  MAX_ETA_BY_UNIT, MAX_DELIVERY_PRICE, formatEta, formatDeliveryPrice,
} from "@/app/lib/delivery";
import {
  Save, ImagePlus, Loader2, Bell, Package,
  Store, ExternalLink, Copy, Check, Image as ImageIcon, Trash2,
  Star, ShoppingBag, Shield, Truck, Clock,
} from "lucide-react";

type Tab = "branding" | "payouts" | "inventory" | "delivery";

export default function SellerProfilePage() {
  const { user, setUser } = useAuthStore();
  const [tab, setTab] = useState<Tab>("branding");

  // Form state — split into branding / payouts / inventory so each save
  // hits the right endpoint without bundling unrelated fields.
  const [branding, setBranding] = useState({
    shopName: "",
    description: "",
    logo: "",
    coverImage: "",
  });
  const [payouts, setPayouts] = useState({ bankAccount: "" });
  const [inventory, setInventory] = useState({
    defaultLowStockThreshold: 5,
    emailAlertsEnabled: true,
  });
  // Phase AU — seller-defined delivery DURATIONS (per tier, hours|days).
  // Starts from platform defaults; hydrated from sellerProfile below.
  const [deliveryCfg, setDeliveryCfg] = useState<DeliveryOptions>(() => mergeDeliveryOptions());

  // UX state
  const [busy, setBusy]             = useState(false);
  const [uploadingLogo,  setUL]     = useState(false);
  const [uploadingCover, setUC]     = useState(false);
  const [msg, setMsg]               = useState("");
  const [err, setErr]               = useState("");
  const [copied, setCopied]         = useState(false);

  const logoInputRef  = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  // ── Pull initial values from the user payload ─────────────────────
  useEffect(() => {
    const sp = user?.sellerProfile;
    if (!sp) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBranding({
      shopName:    sp.shopName    ?? "",
      description: sp.description ?? "",
      logo:        sp.logo        ?? "",
      coverImage:  sp.coverImage  ?? "",
    });
    setPayouts({ bankAccount: sp.bankAccount ?? "" });
    setInventory({
      defaultLowStockThreshold: sp.defaultLowStockThreshold ?? 5,
      emailAlertsEnabled:       sp.emailAlertsEnabled !== false,
    });
    setDeliveryCfg(mergeDeliveryOptions(sp.deliveryOptions));
  }, [user]);

  // ── Persistence helpers ──────────────────────────────────────────
  const persist = async (endpoint: string, body: unknown) => {
    setBusy(true); setErr(""); setMsg("");
    try {
      const { user: updated } = await api.patch<{ user: User }>(endpoint, body);
      setUser(updated);
      setMsg("Хадгалагдлаа ✓");
      setTimeout(() => setMsg(""), 2200);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveBranding  = (e: React.FormEvent) => { e.preventDefault(); persist("/seller/profile",  branding); };
  const savePayouts   = (e: React.FormEvent) => { e.preventDefault(); persist("/seller/profile",  payouts);  };
  const saveInventory = (e: React.FormEvent) => {
    e.preventDefault();
    persist("/seller/settings", {
      defaultLowStockThreshold: Number(inventory.defaultLowStockThreshold),
      emailAlertsEnabled:       inventory.emailAlertsEnabled,
    });
  };

  // Patch one delivery tier in place (enabled / value / unit).
  const setTier = (tier: DeliveryTierKey, patch: Partial<DeliveryOptions[DeliveryTierKey]>) =>
    setDeliveryCfg((p) => ({ ...p, [tier]: { ...p[tier], ...patch } }));
  const saveDelivery = (e: React.FormEvent) => {
    e.preventDefault();
    persist("/seller/settings", { deliveryOptions: deliveryCfg });
  };

  // ── Image uploads ─────────────────────────────────────────────────
  const upload = async (file: File | null, kind: "logo" | "cover") => {
    if (!file) return;
    kind === "logo" ? setUL(true) : setUC(true);
    setErr("");
    try {
      const { url } = await api.uploadImage(file);
      if (kind === "logo")  setBranding((p) => ({ ...p, logo:       url }));
      else                  setBranding((p) => ({ ...p, coverImage: url }));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      kind === "logo" ? setUL(false) : setUC(false);
    }
  };

  // ── Storefront URL + copy ─────────────────────────────────────────
  const sellerId = (user?._id ?? user?.id) as string | undefined;
  const storeUrl = useMemo(() => {
    if (!sellerId) return "";
    if (typeof window === "undefined") return `/store/${sellerId}`;
    return `${window.location.origin}/store/${sellerId}`;
  }, [sellerId]);

  const copyUrl = async () => {
    if (!storeUrl) return;
    try {
      await navigator.clipboard.writeText(storeUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* silently ignore — user can long-press copy manually */ }
  };

  if (!user) return null;

  return (
    <div className="space-y-5">
      {/* ── HEADER ROW ───────────────────────────────────────────── */}
      <header className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold text-gray-900 flex items-center gap-2">
            <Store size={20} className="text-blue-700" /> Профайл ба тохиргоо
          </h1>
          <p className="text-[13px] text-gray-500 mt-0.5">
            Олон нийтэд харагдах дэлгүүрийн брэндинг + дотоод тохиргоо.
          </p>
        </div>

        {sellerId && (
          <div className="flex flex-col sm:items-end gap-1.5">
            <Link href={`/store/${sellerId}`} target="_blank" rel="noopener"
              className="inline-flex items-center gap-1.5 bg-blue-700 hover:bg-blue-800 text-white rounded-xl px-4 py-2 text-[13px] font-semibold transition-colors shadow-sm shadow-blue-200">
              <ExternalLink size={13} /> Миний дэлгүүрийг үзэх
            </Link>
            {storeUrl && (
              <button onClick={copyUrl}
                className="group inline-flex items-center gap-1.5 text-[11px] text-gray-500 hover:text-blue-700 cursor-pointer bg-transparent border-none font-sans">
                {copied ? <Check size={11} className="text-emerald-600" /> : <Copy size={11} />}
                <span className="font-mono truncate max-w-[260px]">{storeUrl}</span>
              </button>
            )}
          </div>
        )}
      </header>

      {/* ── INLINE FEEDBACK ──────────────────────────────────────── */}
      {msg && <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 text-[12px] rounded-xl px-3 py-2">{msg}</div>}
      {err && <div className="bg-red-50 border border-red-200 text-red-600 text-[12px] rounded-xl px-3 py-2">{err}</div>}

      {/* ── TABS ─────────────────────────────────────────────────── */}
      <div className="flex gap-1 border-b border-gray-200">
        {([
          { id: "branding",  label: "Брэндинг",         icon: ImageIcon },
          { id: "payouts",   label: "Төлбөр",           icon: ShoppingBag },
          { id: "inventory", label: "Бараа тохиргоо",   icon: Package },
          { id: "delivery",  label: "Хүргэлт",          icon: Truck },
        ] as const).map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-[13px] font-medium cursor-pointer bg-transparent border-none border-b-2 transition-colors font-sans ${
                active ? "border-blue-700 text-blue-700" : "border-transparent text-gray-500 hover:text-gray-700"
              }`}>
              <Icon size={13} /> {t.label}
            </button>
          );
        })}
      </div>

      {/* ── 2-COL LAYOUT — form left, sticky preview right (desktop) */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-5">

        {/* ─── LEFT: form sections ───────────────────────────────── */}
        <div className="space-y-5 min-w-0">
          {tab === "branding" && (
            <form onSubmit={saveBranding} className="space-y-5">

              {/* COVER IMAGE — 16:5 aspect, drag-target feel */}
              <Card title="Cover image" hint="Дэлгүүрийн дээд хэсэгт томоор харагдана. Санал болгох хэмжээ 1600×500 (16:5).">
                <div className="relative aspect-[16/5] rounded-xl overflow-hidden border-2 border-dashed border-gray-200 bg-gradient-to-br from-gray-50 to-gray-100 group">
                  {branding.coverImage ? (
                    <>
                      <Image src={branding.coverImage} alt="" fill sizes="800px" className="object-cover" unoptimized />
                      {/* Hover overlay with replace/remove */}
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                        <button type="button" onClick={() => coverInputRef.current?.click()} disabled={uploadingCover}
                          className="bg-white/95 hover:bg-white text-gray-800 rounded-lg px-3 py-1.5 text-[12px] font-medium cursor-pointer border-none transition-colors flex items-center gap-1.5 font-sans">
                          <ImagePlus size={12} /> Солих
                        </button>
                        <button type="button" onClick={() => setBranding((p) => ({ ...p, coverImage: "" }))}
                          className="bg-red-500/95 hover:bg-red-600 text-white rounded-lg px-3 py-1.5 text-[12px] font-medium cursor-pointer border-none transition-colors flex items-center gap-1.5 font-sans">
                          <Trash2 size={12} /> Устгах
                        </button>
                      </div>
                    </>
                  ) : (
                    <button type="button" onClick={() => coverInputRef.current?.click()} disabled={uploadingCover}
                      className="absolute inset-0 flex flex-col items-center justify-center gap-2 cursor-pointer bg-transparent border-none hover:bg-blue-50/40 transition-colors text-gray-500 hover:text-blue-700">
                      {uploadingCover
                        ? <Loader2 size={28} className="animate-spin" />
                        : <ImageIcon size={28} strokeWidth={1.5} />}
                      <span className="text-[13px] font-medium">
                        {uploadingCover ? "Хадгалж байна..." : "Cover зураг сонгох"}
                      </span>
                      <span className="text-[10px] text-gray-400">PNG / JPG · max 5MB</span>
                    </button>
                  )}
                  <input ref={coverInputRef} type="file" accept="image/*" hidden
                    onChange={(e) => upload(e.target.files?.[0] || null, "cover")} />
                </div>
              </Card>

              {/* LOGO — square, smaller */}
              <Card title="Лого" hint="Дугуй формоор дэлгүүрийн нүүрэнд харагдана. 200×200 PNG/JPG.">
                <div className="flex items-center gap-4">
                  <div className="relative w-24 h-24 rounded-2xl overflow-hidden border-2 border-gray-200 bg-gradient-to-br from-blue-50 to-amber-50 flex items-center justify-center shrink-0 group">
                    {branding.logo
                      ? <Image src={branding.logo} alt="" fill sizes="96px" className="object-cover" unoptimized />
                      : <Store size={28} className="text-blue-700/40" strokeWidth={1.5} />}
                  </div>
                  <div className="flex-1 flex flex-wrap gap-2">
                    <button type="button" onClick={() => logoInputRef.current?.click()} disabled={uploadingLogo}
                      className="border border-gray-200 hover:border-blue-400 rounded-lg px-3 py-1.5 text-[12px] text-gray-600 cursor-pointer bg-white transition-colors disabled:opacity-50 flex items-center gap-1.5 font-sans">
                      {uploadingLogo ? <Loader2 size={12} className="animate-spin" /> : <ImagePlus size={12} />}
                      {branding.logo ? "Солих" : "Лого сонгох"}
                    </button>
                    {branding.logo && (
                      <button type="button" onClick={() => setBranding((p) => ({ ...p, logo: "" }))}
                        className="border border-gray-200 hover:border-red-300 rounded-lg px-3 py-1.5 text-[12px] text-red-500 cursor-pointer bg-white transition-colors flex items-center gap-1.5 font-sans">
                        <Trash2 size={12} /> Устгах
                      </button>
                    )}
                    <input ref={logoInputRef} type="file" accept="image/*" hidden
                      onChange={(e) => upload(e.target.files?.[0] || null, "logo")} />
                  </div>
                </div>
              </Card>

              <Card title="Танилцуулга">
                <Field label="Дэлгүүрийн нэр">
                  <input value={branding.shopName} onChange={(e) => setBranding((p) => ({ ...p, shopName: e.target.value }))}
                    placeholder="Жнь: AutoParts Mongolia"
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-[14px] focus:border-blue-500 focus:bg-white outline-none transition-colors" />
                </Field>
                <Field label="Танилцуулга" hint="Худалдан авагчид таны дэлгүүрийн чиглэл, давуу талыг харна.">
                  <textarea value={branding.description} onChange={(e) => setBranding((p) => ({ ...p, description: e.target.value }))}
                    rows={4}
                    placeholder="Жнь: Японы оригинал OEM сэлбэг, 7 жилийн туршлагатай..."
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-[13px] focus:border-blue-500 focus:bg-white outline-none transition-colors resize-none leading-relaxed font-sans" />
                </Field>
              </Card>

              <SaveButton busy={busy} />
            </form>
          )}

          {tab === "payouts" && (
            <form onSubmit={savePayouts} className="space-y-5">
              <Card title="Дансны мэдээлэл" hint="Escrow төлбөр энэ данс руу шилжинэ. Өөрчилбөл дараагийн төлбөрөөс мөрдөгдөнө.">
                <Field label="Банкны данс">
                  <input value={payouts.bankAccount} onChange={(e) => setPayouts({ bankAccount: e.target.value })}
                    placeholder="5001 1234 5678"
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-[13px] focus:border-blue-500 focus:bg-white outline-none transition-colors font-mono" />
                </Field>

                <div className="grid grid-cols-3 gap-3 mt-2 pt-4 border-t border-gray-100">
                  <Stat label="Хураамж" value={`${user.sellerProfile?.platformFeePercent ?? 5}%`} />
                  <Stat label="Үнэлгээ" value={user.sellerProfile?.rating ? `${user.sellerProfile.rating.toFixed(1)} (${user.sellerProfile.ratingCount ?? 0})` : "—"} />
                  <Stat label="Нийт бор." value={`₮${(user.sellerProfile?.totalSales ?? 0).toLocaleString()}`} />
                </div>
              </Card>

              <SaveButton busy={busy} />
            </form>
          )}

          {tab === "inventory" && (
            <form onSubmit={saveInventory} className="space-y-5">
              <Card title="Бараа & сэрэмжлүүлэг">
                <Field label="Default low-stock threshold"
                  hint="Тоо болон түүнээс доош ширхэг үлдсэн үед сэрэмжлүүлэх. Бараа болгонд тусдаа threshold тавьж болно.">
                  <input type="number" min={0} max={1000}
                    value={inventory.defaultLowStockThreshold}
                    onChange={(e) => setInventory((p) => ({ ...p, defaultLowStockThreshold: Number(e.target.value) }))}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-[14px] focus:border-blue-500 focus:bg-white outline-none transition-colors" />
                </Field>

                <label className="flex items-start gap-3 cursor-pointer bg-blue-50/40 border border-blue-100 rounded-xl p-3 mt-1">
                  <input type="checkbox"
                    checked={inventory.emailAlertsEnabled}
                    onChange={(e) => setInventory((p) => ({ ...p, emailAlertsEnabled: e.target.checked }))}
                    className="accent-blue-600 w-4 h-4 mt-0.5" />
                  <div>
                    <div className="text-[13px] font-medium text-gray-900 flex items-center gap-1.5">
                      <Bell size={12} className="text-blue-600" /> Email сэрэмжлүүлэг
                    </div>
                    <p className="text-[11px] text-gray-500 mt-0.5">
                      Low-stock болон захиалгын статус өөрчлөгдөх үед {user.email}-руу мэйл явуулна.
                    </p>
                  </div>
                </label>
              </Card>

              <SaveButton busy={busy} />
            </form>
          )}

          {tab === "delivery" && (
            <form onSubmit={saveDelivery} className="space-y-5">
              <Card
                title="Хүргэлтийн тохиргоо"
                hint="Хүргэлтийн төрөл бүрийн ХУГАЦАА (цаг/хоног) ба ҮНИЙГ та өөрөө тохируулна. Худалдан авагч таны барааг үзэхэд эдгээр утга харагдана.">
                {DELIVERY_TIER_ORDER.map((tier) => {
                  const opt  = deliveryCfg[tier];
                  const meta = DELIVERY_TIER_META[tier];
                  return (
                    <div key={tier}
                      className={`rounded-xl border p-3.5 transition-colors ${
                        opt.enabled ? "border-gray-200 bg-white" : "border-gray-100 bg-gray-50/60"
                      }`}>
                      <div className="flex items-start justify-between gap-3">
                        {/* enabled toggle + tier identity */}
                        <label className="flex items-start gap-2.5 cursor-pointer min-w-0">
                          <input type="checkbox"
                            checked={opt.enabled}
                            onChange={(e) => setTier(tier, { enabled: e.target.checked })}
                            className="accent-blue-600 w-4 h-4 mt-0.5 shrink-0" />
                          <div className="min-w-0">
                            <div className="text-[13px] font-semibold text-gray-900">{meta.label}</div>
                            <div className="text-[11px] text-gray-500">{meta.desc}</div>
                          </div>
                        </label>
                        {/* live preview — ETA · price */}
                        <div className="text-[12px] font-semibold text-blue-700 shrink-0 inline-flex items-center gap-1 text-right">
                          {opt.enabled ? (
                            <><Clock size={12} /> {formatEta(opt.value, opt.unit)} · {formatDeliveryPrice(opt.price)}</>
                          ) : "Идэвхгүй"}
                        </div>
                      </div>

                      {/* duration + price controls */}
                      <div className="mt-3 pl-[26px] grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {/* DURATION */}
                        <div>
                          <label className="block text-[10px] text-gray-400 uppercase tracking-wider mb-1">Хугацаа</label>
                          <div className="flex items-center gap-2">
                            <input type="number" min={0} max={MAX_ETA_BY_UNIT[opt.unit]}
                              value={opt.value}
                              disabled={!opt.enabled}
                              onChange={(e) => setTier(tier, { value: Number(e.target.value) })}
                              className="w-20 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-[13px] focus:border-blue-500 focus:bg-white outline-none transition-colors disabled:opacity-50" />
                            <select
                              value={opt.unit}
                              disabled={!opt.enabled}
                              onChange={(e) => {
                                const unit = e.target.value as DeliveryUnit;
                                setTier(tier, { unit, value: Math.min(opt.value, MAX_ETA_BY_UNIT[unit]) });
                              }}
                              className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-[13px] focus:border-blue-500 focus:bg-white outline-none transition-colors disabled:opacity-50 cursor-pointer font-sans">
                              <option value="hour">Цаг</option>
                              <option value="day">Хоног</option>
                            </select>
                          </div>
                        </div>
                        {/* PRICE */}
                        <div>
                          <label className="block text-[10px] text-gray-400 uppercase tracking-wider mb-1">Үнэ</label>
                          <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-[13px] pointer-events-none">₮</span>
                            <input type="number" min={0} max={MAX_DELIVERY_PRICE} step={500}
                              value={opt.price}
                              disabled={!opt.enabled}
                              onChange={(e) => setTier(tier, { price: Number(e.target.value) })}
                              placeholder="0"
                              className="w-full bg-gray-50 border border-gray-200 rounded-lg pl-7 pr-3 py-2 text-[13px] focus:border-blue-500 focus:bg-white outline-none transition-colors disabled:opacity-50" />
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}

                <div className="mt-1 bg-blue-50/40 border border-blue-100 rounded-xl p-3 text-[11px] text-blue-900 leading-relaxed">
                  <strong>Жич:</strong> Үнийг <strong>0</strong> болговол тухайн төрөл &ldquo;Үнэгүй&rdquo; болно.
                  Дор хаяж нэг төрлийг идэвхтэй үлдээнэ — бүгдийг унтраавал &ldquo;Энгийн&rdquo; автоматаар идэвхждэг.
                  Захиалгын нийт дүн серверт энэ үнээр дахин баталгаажна.
                </div>
              </Card>

              <SaveButton busy={busy} />
            </form>
          )}
        </div>

        {/* ─── RIGHT: sticky live preview (desktop only) ──────────── */}
        <aside className="hidden lg:block">
          <div className="sticky top-5">
            <div className="text-[11px] text-gray-400 uppercase tracking-wider mb-2 font-medium">
              Storefront preview
            </div>
            <StorePreview
              shopName={branding.shopName || user.name || "Дэлгүүр"}
              description={branding.description}
              logo={branding.logo}
              coverImage={branding.coverImage}
              rating={user.sellerProfile?.rating ?? 0}
              ratingCount={user.sellerProfile?.ratingCount ?? 0}
              totalSales={user.sellerProfile?.totalSales ?? 0}
            />
            <p className="text-[10px] text-gray-400 mt-2 leading-relaxed">
              Хадгалаагүй өөрчлөлтүүдийг урьдчилан харуулж байна. Бодит дэлгүүрт зөвхөн &ldquo;Хадгалах&rdquo; дарсны дараа гарна.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────

function Card({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="bg-white border border-gray-200 rounded-2xl p-5">
      <header className="mb-4">
        <h2 className="text-[14px] font-semibold text-gray-900">{title}</h2>
        {hint && <p className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">{hint}</p>}
      </header>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[12px] font-medium text-gray-700 mb-1.5">{label}</label>
      {children}
      {hint && <p className="text-[10px] text-gray-400 mt-1">{hint}</p>}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] text-gray-400 uppercase tracking-wider">{label}</div>
      <div className="text-[14px] font-semibold text-gray-900 mt-0.5">{value}</div>
    </div>
  );
}

function SaveButton({ busy }: { busy: boolean }) {
  return (
    <button type="submit" disabled={busy}
      className="w-full sm:w-auto sm:px-8 inline-flex items-center justify-center gap-2 bg-blue-700 hover:bg-blue-800 disabled:bg-blue-300 text-white rounded-xl py-3 text-[14px] font-semibold cursor-pointer border-none transition-all shadow-sm shadow-blue-200 font-sans">
      <Save size={14} /> {busy ? "Хадгалж байна..." : "Хадгалах"}
    </button>
  );
}

/**
 * Mini live-preview of the public /store/[id] hero card. Renders with
 * the SAME visual grammar as app/store/[id]/page.tsx so the seller can
 * trust "what I see here is what buyers see". Scaled-down (no KPI
 * strip, no tabs) — we just preview the identity block.
 */
function StorePreview({
  shopName, description, logo, coverImage,
  rating, ratingCount, totalSales,
}: {
  shopName: string; description: string;
  logo: string; coverImage: string;
  rating: number; ratingCount: number;
  totalSales: number;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
      {/* Mini cover */}
      <div className="relative h-20 bg-gradient-to-br from-blue-700 via-blue-600 to-amber-500 overflow-hidden">
        {coverImage ? (
          <Image src={coverImage} alt="" fill sizes="360px" className="object-cover" unoptimized />
        ) : (
          <div className="absolute inset-0 opacity-30"
            style={{
              backgroundImage: "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.4) 1px, transparent 0)",
              backgroundSize: "12px 12px",
            }} />
        )}
      </div>

      <div className="p-4 -mt-8 relative">
        {/* Logo */}
        <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-blue-100 to-amber-100 ring-4 ring-white shadow-md flex items-center justify-center overflow-hidden mb-2">
          {logo ? (
            <Image src={logo} alt="" width={56} height={56} className="object-cover w-full h-full" unoptimized />
          ) : (
            <span className="text-blue-700 text-xl font-bold">{shopName[0]?.toUpperCase() ?? "?"}</span>
          )}
        </div>

        <div className="text-[15px] font-semibold text-gray-900 truncate flex items-center gap-1.5">
          {shopName}
          <span className="inline-flex items-center gap-0.5 text-[9px] bg-blue-50 text-blue-700 border border-blue-200 px-1.5 py-0.5 rounded-full font-semibold">
            <Shield size={8} /> Verified
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-[10px] text-gray-500 mt-1">
          {rating > 0 && (
            <span className="inline-flex items-center gap-0.5">
              <Star size={9} className="fill-amber-400 text-amber-400" />
              <span className="font-semibold text-gray-700">{rating.toFixed(1)}</span>
              <span>({ratingCount})</span>
            </span>
          )}
        </div>

        {description && (
          <p className="text-[11px] text-gray-500 mt-2 leading-relaxed line-clamp-3">{description}</p>
        )}

        {/* Mini stat row */}
        <div className="mt-3 pt-3 border-t border-gray-100">
          <div className="bg-amber-50 rounded-lg p-2">
            <div className="text-[9px] text-amber-700 uppercase tracking-wider">Зарагдсан</div>
            <div className="text-[13px] font-bold text-gray-900">{totalSales.toLocaleString()}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
