"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import * as XLSX from "xlsx";
import { api } from "@/lib/api";
import { useAuthStore, useCarStore } from "@/store";
import { useLocale } from "@/lib/i18n";
import { Product, Order, User } from "@/app/types";
import { createVoiceRecognition, isVoiceSupported } from "@/lib/voice";
import { MessageCircle, X, Minus, Send, Bot, Sparkles, FileSpreadsheet, AlertTriangle, Mic, MicOff, ImagePlus, Loader2, Car } from "lucide-react";

type ProductCard = { id: string; name: string; oem: string; price: number; brand?: string; stockQty?: number; inStock?: boolean };
type Suggestion = { label: string; cmd: string };

interface Message {
  id: number;
  role: "ai" | "user";
  text?: string;
  imageUrl?: string;
  products?: ProductCard[];
  crossRefs?: CrossRef[];
  lowStock?: ProductCard[];
  excelHint?: { filename: string };
  /** Seller-table renderer payload from layout="seller_table". */
  table?: { columns: string[]; rows: NonNullable<AIResponse["payload"]["rows"]>; summary?: Record<string, unknown> | null };
  /** Admin chart-ready payload from layout="admin_widget". */
  widget?: { kind: NonNullable<AIResponse["payload"]["kind"]>; title: string; data: Record<string, unknown> };
  /** Disambiguation form from layout="diag_form". */
  diagForm?: { partType: string; fields: DiagField[]; note?: string };
  /** Phase B — generated B2B quotation block. */
  quotation?: { quoteId: string; bodyText: string; summary: Record<string, unknown> };
  error?: boolean;
}

/**
 * Phase A response envelope from /api/ai/chat (back-end/Service/aiResponse.service.js).
 * The chat widget renders different UI per `layout` instead of sniffing
 * tool-call names, which keeps the renderer a clean switch statement.
 */
type DiagField = { key: string; label: string; type: "select" | "year" | "text"; options?: string[]; required?: boolean };
type CrossRef = { oem: string; brand: string; role: "oem" | "aftermarket"; note?: string };

interface AIResponse {
  reply: string;
  layout: "user_cards" | "seller_table" | "admin_widget" | "diag_form" | "quotation" | "plain";
  payload: {
    items?: ProductCard[];
    crossRefs?: CrossRef[];
    meta?: { query?: string; category?: string; count?: number; plan?: unknown; oemBag?: string[]; primaryOem?: string };
    columns?: string[];
    rows?: Array<Array<string | number | { kind: "link" | "button"; label: string; href?: string; action?: string }>>;
    summary?: Record<string, unknown> | null;
    kind?: "bar_chart" | "pie_chart" | "kpi_grid" | "line_chart";
    title?: string;
    data?: Record<string, unknown>;
    partType?: string;
    fields?: DiagField[];
    note?: string;
    // Phase B — quotation layout
    quoteId?: string;
    bodyText?: string;
  };
  suggestions?: Suggestion[];
  diagnostics?: Record<string, unknown>;
  // Legacy fields for backward-compat during rollout (can be dropped later).
  toolCalls?: Array<{ name: string; result: unknown }>;
  fallback?: boolean;
}

const USER_GREETING_MN = `Сайн байна уу 👋
Ямар сэлбэг хайж байна вэ?`;
const USER_GREETING_EN = `Hi there 👋
What auto part are you looking for?`;

const ADMIN_GREETING_MN = `Admin AI туслах 🤖
Жишээ командууд:
• "цөөн үлдсэн" — low stock
• "өнөөдрийн борлуулалт"
• "захиалга excel" — татах
• "санхүү excel" — тайлан
• "бараа excel" — каталог`;
const ADMIN_GREETING_EN = `Admin AI Assistant 🤖
Example commands:
• "low stock"
• "today's sales"
• "export orders"
• "financial report"
• "products csv"`;

const USER_SUGGESTIONS_MN: Suggestion[] = [
  { label: "Тоормос", cmd: "тоормос" },
  { label: "Фар", cmd: "фар" },
  { label: "Амортизатор", cmd: "амортизатор" },
];
const USER_SUGGESTIONS_EN: Suggestion[] = [
  { label: "Brakes", cmd: "brake pads" },
  { label: "Headlights", cmd: "headlight" },
  { label: "Suspension", cmd: "suspension" },
];
const ADMIN_SUGGESTIONS: Suggestion[] = [
  { label: "🔻 Low stock", cmd: "low stock" },
  { label: "📊 Sales today", cmd: "today's sales" },
  { label: "📥 Orders Excel", cmd: "захиалга excel" },
  { label: "💰 Finance", cmd: "санхүү excel" },
];

function downloadXlsx(filename: string, sheets: Record<string, Record<string, unknown>[]>) {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  XLSX.writeFile(wb, filename);
}

export default function HiCarAIChat() {
  const pathname = usePathname();
  const { user } = useAuthStore();
  const { locale } = useLocale();
  const activeVehicle = useCarStore((s) => s.activeVehicle);
  const isAdminPath = pathname?.startsWith("/admin") && user?.role === "admin";

  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [uploadingImg, setUploadingImg] = useState(false);
  const idRef = useRef(10);
  const endRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const voiceRef = useRef<ReturnType<typeof createVoiceRecognition>>(null);
  const voiceSupported = isVoiceSupported();

  useEffect(() => {
    // Vehicle-aware opening — when the user already picked a car on the
    // /lookup page we open the chat with a car-specific greeting and
    // swap the quick-action chips for that car's most-common parts.
    let greet: string;
    if (isAdminPath) {
      greet = locale === "en" ? ADMIN_GREETING_EN : ADMIN_GREETING_MN;
    } else if (activeVehicle?.manufacturer && activeVehicle?.model) {
      const car = `${activeVehicle.manufacturer} ${activeVehicle.model}${activeVehicle.generation ? ` [${activeVehicle.generation}]` : ""}`;
      greet = locale === "en"
        ? `Hi 👋 Your car is ${car}. What part are you looking for?`
        : `Сайн уу 👋 Таны ${car}-ын ямар сэлбэг хайя?`;
    } else {
      greet = locale === "en" ? USER_GREETING_EN : USER_GREETING_MN;
    }
    setMessages([{ id: 1, role: "ai", text: greet }]);
  }, [isAdminPath, locale, activeVehicle?.manufacturer, activeVehicle?.model, activeVehicle?.generation]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  const pushAi = (m: Omit<Message, "id" | "role">) =>
    setMessages(prev => [...prev, { id: idRef.current++, role: "ai", ...m }]);

  // ── Admin Excel commands handled client-side (browser download) ──
  const handleClientExcelCommand = async (text: string): Promise<boolean> => {
    const lower = text.toLowerCase();
    if (lower.includes("захиалга") && lower.includes("excel")) {
      try {
        const { orders } = await api.get<{ orders: Order[] }>("/orders?limit=10000");
        const rows = orders.map(o => {
          const u = (o.user && typeof o.user === "object") ? o.user : null;
          return {
            ID: (o._id ?? o.id ?? "").toString().slice(-8).toUpperCase(),
            Огноо: new Date(o.createdAt).toLocaleString("mn-MN"),
            Хэрэглэгч: u?.name ?? "(устгагдсан)",
            Имэйл: u?.email ?? "",
            Утас: o.phone ?? u?.phone ?? "",
            Хаяг: o.address,
            Тоо: o.items.length,
            Төлбөр: o.paymentMethod.toUpperCase(),
            Статус: o.status,
            "Хүргэлт (₮)": o.deliveryFee ?? 0,
            "Нийт (₮)": o.total,
          };
        });
        const filename = `hicar-orders-${new Date().toISOString().slice(0, 10)}.xlsx`;
        downloadXlsx(filename, { Orders: rows });
        pushAi({ text: `📥 ${rows.length} захиалга татагдлаа`, excelHint: { filename } });
      } catch (e) { pushAi({ text: (e as Error).message, error: true }); }
      return true;
    }
    if (lower.includes("санхүү") && lower.includes("excel")) {
      try {
        const [{ orders }, dash] = await Promise.all([
          api.get<{ orders: Order[] }>("/orders?limit=10000"),
          api.get<{ totals: { revenue: number; orders: number; users: number; products: number }; statusBreakdown: Record<string, number>; topProducts: Array<{ name: string; qty: number; revenue: number }> }>("/stats/dashboard"),
        ]);
        const paid = orders.filter(o => ["paid", "processing", "shipped", "delivered"].includes(o.status));
        const summary = [
          { K: "Нийт хэрэглэгч", V: dash.totals.users },
          { K: "Нийт бараа", V: dash.totals.products },
          { K: "Нийт захиалга", V: dash.totals.orders },
          { K: "Нийт борлуулалт (₮)", V: dash.totals.revenue },
          { K: "Төлсөн захиалга", V: paid.length },
        ];
        const filename = `hicar-finance-${new Date().toISOString().slice(0, 10)}.xlsx`;
        downloadXlsx(filename, { Summary: summary, Status: Object.entries(dash.statusBreakdown).map(([k, v]) => ({ Status: k, Count: v })), Top: dash.topProducts });
        pushAi({ text: `💰 Санхүүгийн тайлан татагдлаа`, excelHint: { filename } });
      } catch (e) { pushAi({ text: (e as Error).message, error: true }); }
      return true;
    }
    if (lower.includes("бараа") && lower.includes("excel")) {
      try {
        const { items } = await api.get<{ items: Product[] }>("/products?limit=10000");
        const rows = items.map(p => ({
          Нэр: p.name, OEM: p.oem, Брэнд: p.brand, Ангилал: p.category,
          "Үнэ (₮)": p.price, Үлдэгдэл: p.stockQty ?? 0, Идэвхтэй: p.inStock ? "Тийм" : "Үгүй",
        }));
        const filename = `hicar-products-${new Date().toISOString().slice(0, 10)}.xlsx`;
        downloadXlsx(filename, { Products: rows });
        pushAi({ text: `📦 ${rows.length} бараа татагдлаа`, excelHint: { filename } });
      } catch (e) { pushAi({ text: (e as Error).message, error: true }); }
      return true;
    }
    return false;
  };

  const send = useCallback(async (raw?: string, imageUrl?: string) => {
    const text = (raw ?? input).trim();
    if ((!text && !imageUrl) || busy) return;
    setInput("");
    setBusy(true);

    // User-visible message
    const userMsg: Message = { id: idRef.current++, role: "user", text, imageUrl };
    setMessages(prev => [...prev, userMsg]);

    // Admin Excel commands intercepted client-side
    if (isAdminPath) {
      const handled = await handleClientExcelCommand(text);
      if (handled) { setBusy(false); return; }
    }

    try {
      // ─────────────────────────────────────────────────────────────
      // Phase A: SINGLE entrypoint — everything goes through /api/ai/chat.
      // The role-based gateway decides which tool fires; smart-search is
      // exposed as the `search_vehicle_parts` tool when vehicleContext is
      // present. This lets the AI greet by car, ask clarifying questions,
      // and present results conversationally instead of dumping a count.
      // ─────────────────────────────────────────────────────────────
      const history = [...messages, userMsg]
        .filter(m => m.text || m.imageUrl)
        .map(m => {
          if (m.role === "user" && m.imageUrl) {
            return { role: "user", content: m.text || "Энэ зурагт ямар сэлбэг байна?", imageUrl: m.imageUrl };
          }
          return { role: m.role === "ai" ? "assistant" : "user", content: m.text! };
        });

      // Send vehicleContext so the backend can:
      //   • greet by car ("Таны Toyota Blade…")
      //   • call search_vehicle_parts (OEM-verified matches)
      //   • skip the disambiguation form when car is already pinned down
      const vehicleContext = activeVehicle ? {
        id:           activeVehicle.id,
        plate:        activeVehicle.plate,
        manufacturer: activeVehicle.manufacturer,
        model:        activeVehicle.model,
        generation:   activeVehicle.generation,
        engineCode:   activeVehicle.engineCode,
        engineType:   activeVehicle.engineType,
      } : null;

      const resp = await api.post<AIResponse>("/ai/chat", {
        messages: history,
        locale,
        vehicleContext,
      });

      // Dispatch on layout — single switch handles every renderer path.
      const p = resp.payload || {};
      const msg: Omit<Message, "id" | "role"> = { text: resp.reply };
      switch (resp.layout) {
        case "user_cards":
          if (p.items?.length)     msg.products = p.items;
          if (p.crossRefs?.length) msg.crossRefs = p.crossRefs;
          break;
        case "seller_table":
          if (p.columns && p.rows) {
            msg.table = { columns: p.columns, rows: p.rows, summary: p.summary ?? null };
            // Backward-compat: also surface as lowStock if the rows look that way.
            // (Phase B's dedicated tools will replace this.)
          }
          break;
        case "admin_widget":
          if (p.kind && p.data) {
            msg.widget = { kind: p.kind, title: p.title || "", data: p.data };
          }
          break;
        case "diag_form":
          if (p.fields?.length) {
            msg.diagForm = { partType: p.partType || "", fields: p.fields, note: p.note };
          }
          break;
        case "quotation":
          if (p.bodyText) {
            msg.quotation = {
              quoteId:  p.quoteId  || "",
              bodyText: p.bodyText,
              summary:  (p.summary as Record<string, unknown>) || {},
            };
          }
          break;
        // "plain" → reply text only, nothing extra.
      }
      pushAi(msg);
    } catch (e) {
      pushAi({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  }, [input, busy, isAdminPath, activeVehicle, messages, locale]);

  // ── Voice input ────────────────────────────────────────────────
  const toggleVoice = () => {
    if (!voiceSupported || busy) return;
    if (listening) {
      voiceRef.current?.stop();
      setListening(false);
      return;
    }
    voiceRef.current = createVoiceRecognition({
      lang: locale === "en" ? "en-US" : "mn-MN",
      onPartial: (t) => setInput(t),
      onFinal: (t) => {
        setInput("");
        setListening(false);
        send(t);
      },
      onError: () => setListening(false),
      onEnd: () => setListening(false),
    });
    voiceRef.current?.start();
    setListening(true);
  };

  // ── Image input (sends to AI for vision search) ────────────────
  const handleImagePick = async (file: File | null) => {
    if (!file || busy) return;
    setUploadingImg(true);
    try {
      const { url } = await api.uploadImage(file);
      send("", url);
    } catch (e) {
      pushAi({ text: (e as Error).message, error: true });
    } finally {
      setUploadingImg(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const suggestions = isAdminPath
    ? ADMIN_SUGGESTIONS
    : (locale === "en" ? USER_SUGGESTIONS_EN : USER_SUGGESTIONS_MN);
  const placeholder = isAdminPath
    ? (locale === "en" ? "Type a command or question..." : "Команд эсвэл асуулт...")
    : (locale === "en" ? "Search part name or OEM code..." : "Сэлбэгийн нэр эсвэл OEM код...");

  if (!isOpen || isMinimized) {
    return (
      <button onClick={() => { setIsOpen(true); setIsMinimized(false); }}
        className="fixed bottom-5 right-5 z-50 flex items-center gap-2 bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-700 hover:to-fuchsia-700 text-white rounded-full shadow-lg shadow-violet-300 px-4 h-12 cursor-pointer border-none transition-all font-sans"
        aria-label="AI chat">
        {isAdminPath ? <Bot size={18} /> : <MessageCircle size={18} />}
        <span className="text-[13px] font-semibold">{isAdminPath ? "Admin AI" : (locale === "en" ? "AI Assistant" : "AI туслах")}</span>
      </button>
    );
  }

  return (
    <div className="fixed bottom-5 right-5 z-50 w-[360px] max-w-[calc(100vw-2rem)] h-[600px] max-h-[calc(100vh-2rem)] bg-white border border-gray-200 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
      <div className={`flex items-center justify-between px-4 py-3 ${isAdminPath ? "bg-gradient-to-r from-violet-700 to-indigo-700" : "bg-gradient-to-r from-violet-600 to-fuchsia-500"} text-white`}>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center">
            {isAdminPath ? <Bot size={16} /> : <Sparkles size={15} />}
          </div>
          <div className="min-w-0">
            <div className="text-[13px] font-semibold leading-tight">{isAdminPath ? "Admin AI" : "HiCar AI"}</div>
            {!isAdminPath && activeVehicle ? (
              <div className="text-[10px] opacity-90 flex items-center gap-1 truncate">
                <Car size={9} /> {activeVehicle.manufacturer} {activeVehicle.model}
                {activeVehicle.generation && <span className="opacity-70">· {activeVehicle.generation}</span>}
              </div>
            ) : (
              <div className="text-[10px] opacity-80">{locale === "en" ? "Powered by AI" : "AI-р хайна"}</div>
            )}
          </div>
        </div>
        <div className="flex gap-1">
          <button onClick={() => setIsMinimized(true)}
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/15 cursor-pointer bg-transparent border-none text-white">
            <Minus size={14} />
          </button>
          <button onClick={() => { setIsOpen(false); setIsMinimized(false); }}
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/15 cursor-pointer bg-transparent border-none text-white">
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-gray-50">
        {messages.map(m => (
          <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-[13px] whitespace-pre-line ${
              m.role === "user"
                ? "bg-violet-600 text-white rounded-br-sm"
                : m.error
                  ? "bg-red-50 border border-red-200 text-red-700 rounded-bl-sm"
                  : "bg-white border border-gray-200 text-gray-800 rounded-bl-sm shadow-sm"
            }`}>
              {m.imageUrl && (
                <div className="relative w-32 h-32 rounded-lg overflow-hidden mb-1.5 bg-black/10">
                  <Image src={m.imageUrl} alt="upload" fill sizes="128px" className="object-cover" unoptimized />
                </div>
              )}
              {m.text && <div>{m.text}</div>}

              {m.products && m.products.length > 0 && (
                <div className="mt-2 space-y-1.5">
                  {m.products.map(p => (
                    <Link key={p.id} href={`/shop/${p.id}`} className="block bg-gray-50 hover:bg-violet-50 border border-gray-200 hover:border-violet-300 rounded-lg p-2 transition-colors" style={{ textDecoration: "none" }}>
                      <div className="text-[12px] font-semibold text-gray-900 line-clamp-1">{p.name}</div>
                      <div className="text-[10px] text-gray-400 font-mono">{p.oem}{p.brand ? ` · ${p.brand}` : ""}</div>
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-[12px] font-bold text-violet-600">₮{p.price.toLocaleString()}</span>
                        {p.inStock !== undefined && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${p.inStock ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
                            {p.inStock ? "Stock" : "Out"}
                          </span>
                        )}
                      </div>
                    </Link>
                  ))}
                </div>
              )}

              {m.lowStock && m.lowStock.length > 0 && (
                <div className="mt-2 space-y-1.5">
                  {m.lowStock.map(p => (
                    <div key={p.id} className="bg-amber-50 border border-amber-200 rounded-lg p-2">
                      <div className="flex items-start gap-2">
                        <AlertTriangle size={12} className="text-amber-600 mt-0.5 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="text-[12px] font-semibold text-amber-900 line-clamp-1">{p.name}</div>
                          <div className="text-[10px] text-amber-700 font-mono">{p.oem}</div>
                          <div className="text-[11px] font-bold text-red-600 mt-0.5">
                            {locale === "en" ? "Stock" : "Үлдэгдэл"}: {p.stockQty} {p.inStock === false && (locale === "en" ? "· inactive" : "· идэвхгүй")}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {m.excelHint && (
                <div className="mt-2 flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg p-2 text-emerald-700 text-[11px]">
                  <FileSpreadsheet size={13} className="shrink-0" />
                  <span className="font-mono truncate">{m.excelHint.filename}</span>
                </div>
              )}

              {/* Cross-reference table — aftermarket equivalents for the user's OEM. */}
              {m.crossRefs && m.crossRefs.length > 0 && (
                <div className="mt-2 border border-violet-200 rounded-lg overflow-hidden text-[11px]">
                  <div className="bg-violet-50 px-2 py-1 font-semibold text-violet-700">
                    {locale === "en" ? "Cross-references" : "Сонголтууд"}
                  </div>
                  <div className="divide-y divide-violet-100">
                    {m.crossRefs.map((cr, i) => (
                      <div key={`${cr.oem}-${i}`} className="px-2 py-1.5 flex items-center justify-between gap-2">
                        <span className="font-mono text-gray-700 truncate">{cr.oem}</span>
                        <span className="text-gray-500 truncate">{cr.brand}</span>
                        <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded ${cr.role === "oem" ? "bg-violet-100 text-violet-700" : "bg-emerald-100 text-emerald-700"}`}>
                          {cr.role === "oem" ? "OEM" : "ALT"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Seller-table layout — generic inventory grid. */}
              {m.table && m.table.rows.length > 0 && (
                <div className="mt-2 border border-gray-200 rounded-lg overflow-hidden text-[11px]">
                  <table className="w-full">
                    <thead className="bg-gray-100 text-gray-600">
                      <tr>{m.table.columns.map((c, i) => (<th key={i} className="text-left px-2 py-1 font-semibold">{c}</th>))}</tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {m.table.rows.map((row, ri) => (
                        <tr key={ri}>
                          {row.map((cell, ci) => (
                            <td key={ci} className="px-2 py-1.5 align-top text-gray-700">
                              {typeof cell === "object" && cell !== null && "kind" in cell ? (
                                cell.kind === "link" && cell.href
                                  ? <Link href={cell.href} className="text-violet-600 underline">{cell.label}</Link>
                                  : <button className="px-2 py-0.5 bg-violet-50 text-violet-700 rounded border border-violet-200 text-[10px]">{cell.label}</button>
                              ) : String(cell)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {m.table.summary && (
                    <div className="bg-gray-50 px-2 py-1 text-[10px] text-gray-500 font-mono">
                      {Object.entries(m.table.summary).map(([k, v]) => `${k}: ${v}`).join(" · ")}
                    </div>
                  )}
                </div>
              )}

              {/* Admin-widget layout — Phase C renders 4 kinds. */}
              {m.widget && <AdminWidget data={m.widget} />}

              {/* Disambiguation form — fires when the user typed a bare
                  category word ("фар", "тоормос"). Submitting re-enters
                  the chat with the answers stitched into the query. */}
              {m.diagForm && (
                <DiagFormCard
                  data={m.diagForm}
                  locale={locale}
                  onSubmit={(answers) => {
                    const summary = Object.entries(answers)
                      .filter(([, v]) => v)
                      .map(([k, v]) => `${k}=${v}`)
                      .join(", ");
                    send(`${m.diagForm!.partType} (${summary})`);
                  }}
                />
              )}

              {/* Phase B — generated B2B quotation. Monospace block + one-click copy. */}
              {m.quotation && (
                <QuotationCard data={m.quotation} locale={locale} />
              )}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex justify-start">
            <div className="bg-white border border-gray-200 rounded-2xl rounded-bl-sm px-3 py-2 text-[13px] text-gray-400 shadow-sm flex gap-1 items-center">
              <span className="w-1.5 h-1.5 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
              <span className="w-1.5 h-1.5 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
              <span className="w-1.5 h-1.5 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="px-3 py-2 border-t border-gray-100 bg-white flex gap-1.5 overflow-x-auto scrollbar-none">
        {suggestions.map(s => (
          <button key={s.cmd} onClick={() => send(s.cmd)} disabled={busy}
            className="shrink-0 text-[11px] border border-gray-200 rounded-full px-2.5 py-1 text-gray-600 hover:border-violet-400 hover:text-violet-600 cursor-pointer bg-white transition-colors disabled:opacity-50 font-sans">
            {s.label}
          </button>
        ))}
      </div>

      <div className="p-3 border-t border-gray-100 bg-white flex gap-1.5 items-center">
        {!isAdminPath && (
          <>
            <button onClick={() => fileInputRef.current?.click()} disabled={busy || uploadingImg}
              title="Зураг ачаалах"
              className="w-9 h-9 flex items-center justify-center rounded-xl text-gray-400 hover:text-violet-600 hover:bg-violet-50 cursor-pointer bg-transparent border border-gray-200 transition-colors shrink-0 disabled:opacity-50">
              {uploadingImg ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" hidden
              onChange={e => handleImagePick(e.target.files?.[0] || null)} />
          </>
        )}
        {voiceSupported && (
          <button onClick={toggleVoice} disabled={busy}
            title={listening ? "Зогсоох" : "Хоолой бичих"}
            className={`w-9 h-9 flex items-center justify-center rounded-xl cursor-pointer border transition-colors shrink-0 disabled:opacity-50 ${
              listening
                ? "text-white bg-red-500 border-red-500 hover:bg-red-600 animate-pulse"
                : "text-gray-400 hover:text-violet-600 hover:bg-violet-50 bg-transparent border-gray-200"
            }`}>
            {listening ? <MicOff size={14} /> : <Mic size={14} />}
          </button>
        )}
        <input value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && send()}
          disabled={busy}
          placeholder={listening ? (locale === "en" ? "Listening..." : "Хүлээж байна...") : placeholder}
          className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-[13px] focus:border-violet-500 focus:bg-white transition-colors outline-none" />
        <button onClick={() => send()} disabled={busy || !input.trim()}
          className="w-9 h-9 flex items-center justify-center bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-700 hover:to-fuchsia-700 disabled:from-violet-300 disabled:to-fuchsia-300 text-white rounded-xl cursor-pointer border-none transition-colors shrink-0">
          <Send size={14} />
        </button>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// DiagFormCard — inline disambiguation widget rendered by layout="diag_form".
//
// Tiny self-contained form that captures the answers the AI asked for
// (year / model / side / position) and submits them back as a single
// chat turn. We deliberately keep it minimal — the source of truth for
// available fields is the backend's vagueQueryFormFor() registry.
// ────────────────────────────────────────────────────────────────────
function DiagFormCard({
  data, locale, onSubmit,
}: {
  data: { partType: string; fields: DiagField[]; note?: string };
  locale: "mn" | "en";
  onSubmit: (answers: Record<string, string>) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const ready = data.fields
    .filter((f) => f.required)
    .every((f) => answers[f.key] && answers[f.key].length > 0);

  return (
    <div className="mt-2 border border-amber-200 bg-amber-50 rounded-lg p-2 space-y-1.5 text-[12px]">
      <div className="font-semibold text-amber-800">
        {locale === "en" ? `Narrow down: ${data.partType}` : `Тодруулъя — ${data.partType}`}
      </div>
      {data.note && <div className="text-[10px] text-amber-700 italic">{data.note}</div>}
      {data.fields.map((f) => (
        <div key={f.key} className="flex items-center gap-2">
          <label className="w-24 text-amber-900 shrink-0">{f.label}{f.required ? " *" : ""}</label>
          {f.type === "select" && f.options ? (
            <select
              value={answers[f.key] || ""}
              onChange={(e) => setAnswers((a) => ({ ...a, [f.key]: e.target.value }))}
              className="flex-1 bg-white border border-amber-300 rounded px-2 py-1 text-[12px] outline-none">
              <option value="">—</option>
              {f.options.map((o) => (<option key={o} value={o}>{o}</option>))}
            </select>
          ) : f.type === "year" ? (
            <input
              type="number" min={1980} max={2030}
              value={answers[f.key] || ""}
              onChange={(e) => setAnswers((a) => ({ ...a, [f.key]: e.target.value }))}
              className="flex-1 bg-white border border-amber-300 rounded px-2 py-1 text-[12px] outline-none" />
          ) : (
            <input
              type="text"
              value={answers[f.key] || ""}
              onChange={(e) => setAnswers((a) => ({ ...a, [f.key]: e.target.value }))}
              className="flex-1 bg-white border border-amber-300 rounded px-2 py-1 text-[12px] outline-none" />
          )}
        </div>
      ))}
      <button
        onClick={() => onSubmit(answers)}
        disabled={!ready}
        className="w-full mt-1 bg-amber-600 hover:bg-amber-700 disabled:bg-amber-300 text-white rounded px-2 py-1.5 text-[12px] font-semibold cursor-pointer border-none transition-colors">
        {locale === "en" ? "Search →" : "Хайх →"}
      </button>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// QuotationCard — renders layout="quotation". The bodyText is already
// preformatted plain-text (template lives in sellerInsights.service.js),
// so this component is intentionally dumb: monospace block + a copy-to-
// clipboard button so the seller can paste it straight into an email.
// ────────────────────────────────────────────────────────────────────
function QuotationCard({
  data, locale,
}: {
  data: { quoteId: string; bodyText: string; summary: Record<string, unknown> };
  locale: "mn" | "en";
}) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(data.bodyText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API can fail in non-HTTPS contexts; fall back to select.
      const ta = document.createElement("textarea");
      ta.value = data.bodyText;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); setCopied(true); setTimeout(() => setCopied(false), 2000); }
      catch { /* user can still select manually */ }
      document.body.removeChild(ta);
    }
  };

  return (
    <div className="mt-2 border border-emerald-200 bg-emerald-50 rounded-lg overflow-hidden text-[11px]">
      <div className="flex items-center justify-between px-2 py-1 bg-emerald-100 text-emerald-800">
        <span className="font-mono font-semibold">{data.quoteId}</span>
        <button
          onClick={handleCopy}
          className="text-[10px] px-2 py-0.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded cursor-pointer border-none transition-colors">
          {copied
            ? (locale === "en" ? "✓ Copied" : "✓ Хууллаа")
            : (locale === "en" ? "Copy" : "Хуулах")}
        </button>
      </div>
      <pre className="px-2 py-1.5 m-0 whitespace-pre overflow-x-auto font-mono text-[10px] leading-tight text-emerald-900 bg-white">
{data.bodyText}
      </pre>
      {data.summary && Object.keys(data.summary).length > 0 && (
        <div className="px-2 py-1 bg-emerald-50 text-[10px] text-emerald-700 font-mono">
          {Object.entries(data.summary)
            .filter(([k]) => !["validUntil"].includes(k))
            .map(([k, v]) => `${k}: ${typeof v === "number" ? v.toLocaleString() : String(v)}`)
            .join(" · ")}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// AdminWidget — Phase C BI renderer.
//
// Renders layout="admin_widget" payloads in one of four chart styles
// based on payload.kind. Pure CSS / inline SVG — no chart library
// dependency, no runtime download.
//
//   kpi_grid    : compact key-value grid (existing behavior)
//   bar_chart   : horizontal bars from data.x[] + data.y[]
//   line_chart  : inline SVG polyline from data.x[] + data.y[]
//   pie_chart   : legend table from data.slices = [{label, value}]
//
// Falls back to kpi_grid for any unknown kind so the chat never crashes.
// ────────────────────────────────────────────────────────────────────
function AdminWidget({
  data,
}: {
  data: { kind: NonNullable<AIResponse["payload"]["kind"]>; title: string; data: Record<string, unknown> };
}) {
  const d = data.data || {};
  return (
    <div className="mt-2 border border-indigo-200 rounded-lg p-2 text-[11px] bg-indigo-50">
      {data.title && <div className="font-semibold text-indigo-700 mb-1">{data.title}</div>}
      {data.kind === "bar_chart"   && <BarChartView d={d} />}
      {data.kind === "line_chart"  && <LineChartView d={d} />}
      {data.kind === "pie_chart"   && <PieLegendView d={d} />}
      {(data.kind === "kpi_grid" || !["bar_chart","line_chart","pie_chart"].includes(data.kind)) && (
        <KpiGridView d={d} />
      )}
    </div>
  );
}

// Helpers — extract typed arrays from a loose data bag without throwing.
function asNumberArray(v: unknown): number[] {
  return Array.isArray(v) ? v.map((x) => Number(x) || 0) : [];
}
function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x ?? "")) : [];
}

// Horizontal-bar chart, CSS-only.
function BarChartView({ d }: { d: Record<string, unknown> }) {
  const labels = asStringArray(d.x);
  const values = asNumberArray(d.y);
  const max = Math.max(1, ...values);
  if (labels.length === 0) {
    return (
      <div className="text-[11px] text-indigo-700 italic">
        {String(d.note || "Өгөгдөл алга.")}
      </div>
    );
  }
  return (
    <div className="space-y-1">
      {labels.map((label, i) => {
        const v = values[i] || 0;
        const pct = Math.max(2, Math.round((v / max) * 100));
        return (
          <div key={`${label}-${i}`} className="flex items-center gap-2">
            <div className="w-24 text-[10px] text-gray-700 truncate font-mono shrink-0" title={label}>{label}</div>
            <div className="flex-1 h-3 bg-white rounded overflow-hidden border border-indigo-100">
              <div className="h-full bg-gradient-to-r from-indigo-400 to-fuchsia-500" style={{ width: `${pct}%` }} />
            </div>
            <div className="w-12 text-right text-[10px] font-mono text-indigo-700 shrink-0">{v.toLocaleString()}</div>
          </div>
        );
      })}
      {d.seasonalNote ? <div className="mt-1 text-[10px] text-indigo-600 italic">{String(d.seasonalNote)}</div> : null}
      {d.note ? <div className="mt-1 text-[10px] text-indigo-600 italic">{String(d.note)}</div> : null}
    </div>
  );
}

// Inline SVG polyline (trend lines).
function LineChartView({ d }: { d: Record<string, unknown> }) {
  const labels = asStringArray(d.x);
  const values = asNumberArray(d.y);
  if (values.length < 2) {
    return <div className="text-[11px] text-indigo-700 italic">Хангалттай цэг алга.</div>;
  }
  const W = 300, H = 80, P = 4;
  const max = Math.max(...values), min = Math.min(...values, 0);
  const span = Math.max(1, max - min);
  const xStep = (W - 2 * P) / (values.length - 1);
  const points = values
    .map((v, i) => {
      const x = P + i * xStep;
      const y = P + (H - 2 * P) * (1 - (v - min) / span);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <div>
      <svg width={W} height={H} className="w-full h-auto">
        <polyline fill="none" stroke="rgb(99, 102, 241)" strokeWidth="2" points={points} />
        {values.map((v, i) => (
          <circle key={i} cx={P + i * xStep} cy={P + (H - 2 * P) * (1 - (v - min) / span)} r="2.5" fill="rgb(217, 70, 239)" />
        ))}
      </svg>
      <div className="flex justify-between text-[9px] text-indigo-500 font-mono mt-0.5">
        {labels.map((l, i) => <span key={`${l}-${i}`}>{l}</span>)}
      </div>
    </div>
  );
}

// Pie chart → legend table (cheap, readable, accessible).
function PieLegendView({ d }: { d: Record<string, unknown> }) {
  const slices = (Array.isArray(d.slices) ? d.slices : []) as Array<{ label: string; value: number }>;
  if (slices.length === 0) {
    return <div className="text-[11px] text-indigo-700 italic">Хуваарилалт алга.</div>;
  }
  const total = slices.reduce((s, sl) => s + (Number(sl.value) || 0), 0) || 1;
  const palette = ["bg-indigo-500", "bg-fuchsia-500", "bg-emerald-500", "bg-amber-500", "bg-rose-500", "bg-cyan-500", "bg-violet-500"];
  return (
    <div className="space-y-1">
      {slices.map((sl, i) => {
        const pct = Math.round(((Number(sl.value) || 0) / total) * 100);
        return (
          <div key={`${sl.label}-${i}`} className="flex items-center gap-2 text-[10px]">
            <span className={`w-3 h-3 rounded-sm shrink-0 ${palette[i % palette.length]}`} />
            <span className="flex-1 truncate text-gray-700">{sl.label}</span>
            <span className="font-mono text-indigo-700">{pct}%</span>
            <span className="font-mono text-gray-500 w-16 text-right">{Number(sl.value).toLocaleString()}</span>
          </div>
        );
      })}
    </div>
  );
}

// KPI grid — scalars + nested topBrands list when present.
function KpiGridView({ d }: { d: Record<string, unknown> }) {
  const topBrands = Array.isArray(d.topBrands) ? d.topBrands : null;
  const statusBreakdown = (d.statusBreakdown && typeof d.statusBreakdown === "object")
    ? d.statusBreakdown as Record<string, number>
    : null;

  // Scalars only — strip nested objects / arrays for the grid.
  const scalars = Object.entries(d).filter(([, v]) => {
    return v !== null && (typeof v !== "object" || v instanceof Date);
  });

  return (
    <div>
      {scalars.length > 0 && (
        <div className="grid grid-cols-2 gap-1">
          {scalars.map(([k, v]) => (
            <div key={k} className="bg-white rounded px-2 py-1">
              <div className="text-gray-500 text-[10px]">{k}</div>
              <div className="font-mono text-gray-900 truncate">
                {typeof v === "number" ? v.toLocaleString() : String(v)}
                {k.endsWith("Percent") || k.startsWith("growthRate") ? "%" : ""}
              </div>
            </div>
          ))}
        </div>
      )}
      {topBrands && topBrands.length > 0 && (
        <div className="mt-2 pt-2 border-t border-indigo-200">
          <div className="text-[10px] text-indigo-600 font-semibold mb-1">Топ брэндүүд</div>
          <BarChartView d={{
            x: topBrands.map((b: { brand?: string }) => b.brand || "?"),
            y: topBrands.map((b: { revenue?: number }) => b.revenue || 0),
          }} />
        </div>
      )}
      {statusBreakdown && (
        <div className="mt-2 pt-2 border-t border-indigo-200">
          <div className="text-[10px] text-indigo-600 font-semibold mb-1">Захиалгын төлөв</div>
          <PieLegendView d={{
            slices: Object.entries(statusBreakdown).map(([label, value]) => ({ label, value })),
          }} />
        </div>
      )}
    </div>
  );
}
