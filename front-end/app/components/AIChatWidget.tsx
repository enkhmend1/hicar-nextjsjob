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
  lowStock?: ProductCard[];
  excelHint?: { filename: string };
  error?: boolean;
}

interface AIResponse {
  reply: string;
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
    const greet = isAdminPath
      ? (locale === "en" ? ADMIN_GREETING_EN : ADMIN_GREETING_MN)
      : (locale === "en" ? USER_GREETING_EN : USER_GREETING_MN);
    setMessages([{ id: 1, role: "ai", text: greet }]);
  }, [isAdminPath, locale]);

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
      // Vehicle-aware path: when a Vehicle is active (user came from
      // /lookup) and the user sent a text-only query, route through
      // /api/search/smart so the AI translator + external parts API +
      // OEM matcher all kick in. This is *materially* better than the
      // generic chat for parts queries.
      // ─────────────────────────────────────────────────────────────
      if (!isAdminPath && activeVehicle && text && !imageUrl) {
        type SmartResp = {
          ai: { plan: { api_english_name: string; standard_category: string }; source: string };
          external: { provider: string; oems: string[] };
          oemBag: string[];
          items: ProductCard[];
          fallbackSearch: { used: boolean };
        };
        const r = await api.post<SmartResp>("/search/smart", {
          vehicleId: activeVehicle.id,
          query: text,
          limit: 8,
        });
        const headline = r.items.length > 0
          ? (locale === "en"
              ? `${r.items.length} parts matched for "${r.ai.plan.api_english_name}" on ${activeVehicle.manufacturer} ${activeVehicle.model}.`
              : `${r.items.length} тохирох сэлбэг олдлоо — "${r.ai.plan.api_english_name}" / ${activeVehicle.manufacturer} ${activeVehicle.model}`)
          : (locale === "en"
              ? `No products found for "${r.ai.plan.api_english_name}". OEM bag size: ${r.oemBag.length}.`
              : `"${r.ai.plan.api_english_name}" гэсэн утгаар бараа алга. OEM bag: ${r.oemBag.length}`);
        pushAi({ text: headline, products: r.items });
        return;
      }

      // ── Generic path: free-form chat / image search ─────────────
      const history = [...messages, userMsg]
        .filter(m => m.text || m.imageUrl)
        .map(m => {
          if (m.role === "user" && m.imageUrl) {
            return { role: "user", content: m.text || "Энэ зурагт ямар сэлбэг байна?", imageUrl: m.imageUrl };
          }
          return { role: m.role === "ai" ? "assistant" : "user", content: m.text! };
        });

      const resp = await api.post<AIResponse>("/ai/chat", {
        messages: history,
        locale,
        mode: isAdminPath ? "admin" : "user",
      });

      // Surface tool results
      const searchTool = resp.toolCalls?.find(c => c.name === "search_products");
      const lowStockTool = resp.toolCalls?.find(c => c.name === "get_low_stock");
      const products = searchTool?.result && typeof searchTool.result === "object" && "items" in (searchTool.result as Record<string, unknown>)
        ? (searchTool.result as { items: ProductCard[] }).items
        : undefined;
      const lowStock = lowStockTool?.result && typeof lowStockTool.result === "object" && "items" in (lowStockTool.result as Record<string, unknown>)
        ? (lowStockTool.result as { items: ProductCard[] }).items
        : undefined;

      pushAi({ text: resp.reply, products, lowStock });
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
