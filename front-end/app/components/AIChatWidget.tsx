"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import * as XLSX from "xlsx";
import { api } from "@/lib/api";
import { useAuthStore, useCarStore, type ActiveVehicle } from "@/store";
import { useLocale } from "@/lib/i18n";
import { Product, Order, User } from "@/app/types";
import { createVoiceRecognition, isVoiceSupported } from "@/lib/voice";
import { useAgent } from "@/app/hooks/useAgent";
import { detectMongolianPlate, normalizeMongolianPlate } from "@/app/lib/plateDetector";
import type { AIResponse } from "@/app/lib/services/chat.service";
import { MessageCircle, X, Minus, Send, Bot, Sparkles, FileSpreadsheet, AlertTriangle, Mic, MicOff, ImagePlus, Loader2, Car, ChevronDown, Search as SearchIcon, Clock } from "lucide-react";

/** /car or /changecar — both open the switcher dropdown without sending. */
const SLASH_CAR_RX = /^\/(?:car|changecar)\b/i;

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
  /** Phase I — diagnostic card. */
  diagnostic?: {
    symptom:             string;
    candidates:          NonNullable<AIResponse["payload"]["candidates"]>;
    clarifyingQuestions: string[];
    urgency:             "low" | "medium" | "high";
  };
  /**
   * Phase H — confidence + escalation attached to assistant bubbles.
   * Only assistant bubbles can carry these (user messages always 100%).
   */
  confidence?: number | null;
  escalation?: NonNullable<AIResponse["escalation"]>;
  error?: boolean;
}

/**
 * Phase H-prep: AIResponse wire shape is owned by chat.service.ts so the
 * widget and the hook share the same TS contract. Local aliases below
 * preserve the legacy component-local field names without re-declaring
 * the union.
 */
type DiagField = NonNullable<AIResponse["payload"]["fields"]>[number];
type CrossRef  = NonNullable<AIResponse["payload"]["crossRefs"]>[number];

const USER_GREETING_MN = `Сайн байна уу 👋
Ямар сэлбэг хайж байна вэ?`;
const USER_GREETING_EN = `Hi there 👋
What auto part are you looking for?`;

const SELLER_GREETING_MN = `Барааны AI бэлэн 📦
Жишээ: "deadstock", "04465-02220 хаана байна", "энэ сарын борлуулалт", "Бат-д үнийн санал".`;
const SELLER_GREETING_EN = `Inventory AI ready 📦
Try: "deadstock", "where is 04465-02220", "this month's sales", "quote for Bat".`;

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
const SELLER_SUGGESTIONS: Suggestion[] = [
  { label: "📦 Deadstock", cmd: "deadstock" },
  { label: "🔻 Цөөн үлдсэн", cmd: "цөөн үлдсэн" },
  { label: "📊 Энэ сарын борлуулалт", cmd: "энэ сарын борлуулалт" },
  { label: "📋 Үнийн санал", cmd: "үнийн санал" },
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
  const activeVehicle    = useCarStore((s) => s.activeVehicle);
  const recentVehicles   = useCarStore((s) => s.recentVehicles);
  // Phase J: detect the THREE possible chat surfaces. Path-AND-role
  // both have to agree — a logged-out user hitting /admin/* still
  // gets the buyer chat (the page itself will block them).
  const isAdminPath  = pathname?.startsWith("/admin")  && user?.role === "admin";
  const isSellerPath = pathname?.startsWith("/seller") && user?.role === "seller";
  const isBuyerPath  = !isAdminPath && !isSellerPath;

  // ── Phase H-prep: useAgent() owns ALL backend orchestration ─────
  // Widget no longer talks to api.* directly or mutates the car
  // store — it emits intents to the hook and renders the resulting
  // state. This keeps the widget under ~500 lines and tests can mock
  // useAgent in isolation.
  const agent = useAgent();

  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [listening, setListening] = useState(false);
  const [uploadingImg, setUploadingImg] = useState(false);
  /** Phase G — header dropdown open/close + plate-input value (pure UI state). */
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [plateInput,   setPlateInput]   = useState("");
  /** Detected-plate confirmation chip — surfaces when input contains a plate. */
  const detectedPlate = useMemo(() => {
    if (!input || activeVehicle?.plate === normalizeMongolianPlate(input)) return null;
    return detectMongolianPlate(input);
  }, [input, activeVehicle?.plate]);
  // Aliases for legacy ref points below (kept short to minimise diff).
  // Phase M.1: during the rate-limit cooldown the input is also disabled
  // — the auto-retry will fire when the timer expires, and we don't want
  // the user to fire a duplicate request that just adds to the queue.
  const inCooldown = agent.secondsUntilRetry > 0;
  const busy      = agent.busy || agent.plateBusy || inCooldown;
  const plateBusy = agent.plateBusy;
  const plateErr  = agent.plateError;
  const idRef = useRef(10);
  const endRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const voiceRef = useRef<ReturnType<typeof createVoiceRecognition>>(null);
  const voiceSupported = isVoiceSupported();

  useEffect(() => {
    // Three-surface greeting selector (Phase J).
    //   admin  → admin command menu
    //   seller → inventory AI hints
    //   buyer  → vehicle-aware greeting if a car is picked, generic
    //            "what part are you looking for" otherwise.
    let greet: string;
    if (isAdminPath) {
      greet = locale === "en" ? ADMIN_GREETING_EN : ADMIN_GREETING_MN;
    } else if (isSellerPath) {
      greet = locale === "en" ? SELLER_GREETING_EN : SELLER_GREETING_MN;
    } else if (activeVehicle?.manufacturer && activeVehicle?.model) {
      const car = `${activeVehicle.manufacturer} ${activeVehicle.model}${activeVehicle.generation ? ` [${activeVehicle.generation}]` : ""}`;
      greet = locale === "en"
        ? `Hi 👋 Your car is ${car}. What part are you looking for?`
        : `Сайн уу 👋 Таны ${car}-ын ямар сэлбэг хайя?`;
    } else {
      greet = locale === "en" ? USER_GREETING_EN : USER_GREETING_MN;
    }
    setMessages([{ id: 1, role: "ai", text: greet }]);
  }, [isAdminPath, isSellerPath, locale, activeVehicle?.manufacturer, activeVehicle?.model, activeVehicle?.generation]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  // ── Phase H-prep: thin wrappers around useAgent() ────────────────
  // Memory hydrate on chat open — agent decides if user is logged-in.
  useEffect(() => {
    if (isOpen) void agent.hydrateMemory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, user?.id]);

  /** Pick a recent vehicle → switch + close dropdown. */
  const switchToVehicleId = useCallback(async (id: string) => {
    const r = await agent.switchVehicleByVehicleId(id);
    if (r.ok) setSwitcherOpen(false);
  }, [agent]);

  /** Manual plate input → switch + close dropdown + announce in chat. */
  const switchToPlate = useCallback(async (rawPlate: string) => {
    const r = await agent.switchVehicleByPlate(rawPlate);
    if (r.ok && r.vehicle) {
      setPlateInput("");
      setSwitcherOpen(false);
      pushAi({
        text: locale === "en"
          ? `Switched to ${r.vehicle.manufacturer} ${r.vehicle.model}. What part are you looking for?`
          : `Машин солигдсон: ${r.vehicle.manufacturer} ${r.vehicle.model}. Ямар сэлбэг хайя?`,
      });
    }
  }, [agent, locale]);

  const clearVehicle = useCallback(async () => {
    await agent.clearVehicle();
    setSwitcherOpen(false);
  }, [agent]);

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

    // ── Phase G slash commands: intercept BEFORE sending to backend ──
    // `/car` and `/changecar` open the switcher dropdown instead of
    // burning a Groq round-trip. The user's typed command is also
    // not added to the chat thread — it's a UI affordance, not a
    // message worth recording.
    if (text && !imageUrl && SLASH_CAR_RX.test(text)) {
      setInput("");
      setSwitcherOpen(true);
      return;
    }

    setInput("");

    // User-visible message
    const userMsg: Message = { id: idRef.current++, role: "user", text, imageUrl };
    setMessages(prev => [...prev, userMsg]);

    // Admin Excel commands intercepted client-side (browser-only side
    // effect; does not need the agent hook).
    if (isAdminPath) {
      const handled = await handleClientExcelCommand(text);
      if (handled) return;
    }

    // Single entry point — agent owns HTTP + vehicleContext threading +
    // memory write-back. Widget just renders the result.
    const history = [...messages, userMsg]
      .filter(m => m.text || m.imageUrl)
      .map(m => {
        if (m.role === "user" && m.imageUrl) {
          return { role: "user" as const, content: m.text || "Энэ зурагт ямар сэлбэг байна?", imageUrl: m.imageUrl };
        }
        return { role: m.role === "ai" ? "assistant" as const : "user" as const, content: m.text! };
      });

    const resp = await agent.sendChat(history);
    if (!resp) {
      // Hook already populated chatError; surface it in the chat thread
      // so the user sees what happened.
      pushAi({ text: agent.chatError || "Алдаа гарлаа", error: true });
      return;
    }

    // Dispatch on layout — pure UI logic stays in the widget.
    pushAi(layoutToMessage(resp));
  }, [input, busy, isAdminPath, messages, agent, pushAi]);

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

  // Phase J — three-surface chips + placeholder picker.
  const suggestions = isAdminPath
    ? ADMIN_SUGGESTIONS
    : isSellerPath
      ? SELLER_SUGGESTIONS
      : (locale === "en" ? USER_SUGGESTIONS_EN : USER_SUGGESTIONS_MN);
  const placeholder = isAdminPath
    ? (locale === "en" ? "Type a command or question..."         : "Команд эсвэл асуулт...")
    : isSellerPath
      ? (locale === "en" ? "Inventory question, OEM, or quote..." : "Бараа, OEM, эсвэл үнийн санал...")
      : (locale === "en" ? "Search part name or OEM code..."     : "Сэлбэгийн нэр эсвэл OEM код...");

  if (!isOpen || isMinimized) {
    return (
      <button onClick={() => { setIsOpen(true); setIsMinimized(false); }}
        className="fixed bottom-5 right-5 z-50 flex items-center gap-2 bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-700 hover:to-fuchsia-700 text-white rounded-full shadow-lg shadow-violet-300 px-4 h-12 cursor-pointer border-none transition-all font-sans"
        aria-label="AI chat">
        {isAdminPath ? <Bot size={18} /> : isSellerPath ? <FileSpreadsheet size={18} /> : <MessageCircle size={18} />}
        <span className="text-[13px] font-semibold">
          {isAdminPath ? "Admin AI"
            : isSellerPath ? (locale === "en" ? "Inventory AI" : "Барааны AI")
            : (locale === "en" ? "AI Assistant" : "AI туслах")}
        </span>
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
            {isBuyerPath ? (
              // Phase G — clickable car badge ONLY on the buyer surface
              // (seller / admin chats are not about a specific car).
              <button
                onClick={() => setSwitcherOpen((v) => !v)}
                title={locale === "en" ? "Switch vehicle" : "Машин солих"}
                className="text-[10px] opacity-90 hover:opacity-100 flex items-center gap-1 truncate cursor-pointer bg-transparent border-none text-white p-0 m-0 font-sans">
                <Car size={9} />
                {activeVehicle ? (
                  <>
                    <span>{activeVehicle.manufacturer} {activeVehicle.model}</span>
                    {activeVehicle.generation && (
                      <span className="opacity-70">· {activeVehicle.generation}</span>
                    )}
                  </>
                ) : (
                  <span className="italic opacity-80">
                    {locale === "en" ? "Add a vehicle…" : "Машин нэмэх…"}
                  </span>
                )}
                <ChevronDown size={9} className={`transition-transform ${switcherOpen ? "rotate-180" : ""}`} />
              </button>
            ) : isSellerPath ? (
              <div className="text-[10px] opacity-80">
                {locale === "en" ? "Inventory assistant" : "Барааны туслах"}
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

      {/* Phase G — vehicle switcher dropdown. Renders below the
          header, above the message thread. Click-outside is handled
          by the surrounding chat panel; we don't need a portal. */}
      {switcherOpen && !isAdminPath && (
        <VehicleSwitcher
          activeVehicle={activeVehicle}
          recentVehicles={recentVehicles}
          plateInput={plateInput}
          plateBusy={plateBusy}
          plateErr={plateErr}
          locale={locale}
          onPlateInputChange={setPlateInput}
          onLookupPlate={() => switchToPlate(plateInput)}
          onPickRecent={switchToVehicleId}
          onClear={clearVehicle}
          onClose={() => { setSwitcherOpen(false); agent.clearErrors(); }}
        />
      )}

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

              {/* Phase I — diagnostic ranked candidates + clarifying Q. */}
              {m.diagnostic && (
                <DiagnosticCard
                  data={m.diagnostic}
                  locale={locale}
                  onQuickAnswer={(q) => send(q)}
                />
              )}

              {/* Phase H — escalation banner (CRITICAL band only).
                  Renders BEFORE confidence badge so the prominent CTA
                  is the first thing the user sees on a low-confidence
                  turn. */}
              {m.role === "ai" && m.escalation && (
                <ConfidenceEscalation data={m.escalation} locale={locale} />
              )}

              {/* Phase H — subtle confidence badge for medium/low bands.
                  High (≥90) shows nothing; critical is replaced by the
                  escalation banner above. */}
              {m.role === "ai" && !m.escalation && typeof m.confidence === "number" && m.confidence < 90 && (
                <ConfidenceBadge value={m.confidence} locale={locale} />
              )}
            </div>
          </div>
        ))}
        {/* Phase M.1: separate visual for "actively waiting on AI" vs
            "cooling down before auto-retry". The cooldown chip shows a
            live countdown + cancel affordance so the user knows
            EXACTLY what's happening and can bail out if they want. */}
        {busy && !inCooldown && (
          <div className="flex justify-start">
            <div className="bg-white border border-gray-200 rounded-2xl rounded-bl-sm px-3 py-2 text-[13px] text-gray-400 shadow-sm flex gap-1 items-center">
              <span className="w-1.5 h-1.5 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
              <span className="w-1.5 h-1.5 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
              <span className="w-1.5 h-1.5 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
            </div>
          </div>
        )}
        {inCooldown && (
          <div className="flex justify-start">
            <div className="bg-amber-50 border border-amber-200 rounded-2xl rounded-bl-sm px-3 py-2 text-[12px] text-amber-800 shadow-sm flex items-center gap-2">
              <Clock size={12} className="animate-pulse" />
              <span>
                {locale === "en"
                  ? `Auto-retrying in ${agent.secondsUntilRetry}s…`
                  : `${agent.secondsUntilRetry}с дараа автоматаар…`}
              </span>
              <button onClick={agent.cancelRateLimit}
                className="text-amber-700 hover:text-amber-900 underline cursor-pointer bg-transparent border-none text-[11px] p-0">
                {locale === "en" ? "Cancel" : "Болих"}
              </button>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Phase G — inline plate confirmation chip. Surfaces when the
          user types something matching the Mongolian plate pattern.
          Acting on the chip is one-tap; ignoring it lets the user
          continue typing normally. */}
      {!isAdminPath && detectedPlate && (
        <div className="px-3 py-2 border-t border-amber-100 bg-amber-50 flex items-center gap-2 text-[12px]">
          <Car size={12} className="text-amber-600 shrink-0" />
          <span className="text-amber-900 truncate">
            <strong className="font-mono">{detectedPlate}</strong>{" "}
            {locale === "en" ? "detected — switch vehicle?" : "дугаар олдов — машин солих уу?"}
          </span>
          <button
            onClick={() => { void switchToPlate(detectedPlate); setInput(""); }}
            disabled={plateBusy}
            className="ml-auto shrink-0 text-[11px] px-2.5 py-1 bg-amber-600 hover:bg-amber-700 disabled:bg-amber-300 text-white rounded-md cursor-pointer border-none transition-colors font-sans">
            {plateBusy
              ? (locale === "en" ? "Looking up…" : "Хайж байна…")
              : (locale === "en" ? "Switch" : "Солих")}
          </button>
          <button
            onClick={() => setInput("")}
            className="shrink-0 text-[11px] text-amber-700 hover:text-amber-900 cursor-pointer bg-transparent border-none px-1.5 py-1 font-sans">
            {locale === "en" ? "Dismiss" : "Үл тоох"}
          </button>
        </div>
      )}

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
          placeholder={
            inCooldown
              ? (locale === "en"
                  ? `Auto-retrying in ${agent.secondsUntilRetry}s…`
                  : `${agent.secondsUntilRetry}с дараа автоматаар…`)
              : listening
                ? (locale === "en" ? "Listening..." : "Хүлээж байна...")
                : placeholder
          }
          className={`flex-1 ${inCooldown ? "bg-amber-50 border-amber-200" : "bg-gray-50 border-gray-200"} border rounded-xl px-3 py-2 text-[13px] focus:border-violet-500 focus:bg-white transition-colors outline-none`} />
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
// Phase I — DiagnosticCard.
//
// Renders layout="diagnostic" payloads as a mechanic's-style ranked
// candidate list with a horizontal likelihood bar per row, plus ONE
// clarifying-question prompt that the user can answer in-place by
// clicking the chip (which then submits as the next user message).
//
// Urgency colour-codes the card border:
//   low    — slate (informational)
//   medium — amber (worth checking soon)
//   high   — rose  (safety / drivability — bring to mechanic)
// ────────────────────────────────────────────────────────────────────
function DiagnosticCard({
  data, locale, onQuickAnswer,
}: {
  data: NonNullable<Message["diagnostic"]>;
  locale: "mn" | "en";
  onQuickAnswer: (text: string) => void;
}) {
  const urgencyStyle = {
    low:    { wrap: "border-slate-200 bg-slate-50", chip: "bg-slate-200 text-slate-700", label: locale === "en" ? "Low" : "Бага" },
    medium: { wrap: "border-amber-200 bg-amber-50",  chip: "bg-amber-200 text-amber-800",  label: locale === "en" ? "Medium" : "Дунд" },
    high:   { wrap: "border-rose-200 bg-rose-50",    chip: "bg-rose-200 text-rose-800",    label: locale === "en" ? "High" : "Өндөр" },
  }[data.urgency];

  return (
    <div className={`mt-2 border rounded-lg overflow-hidden text-[11px] ${urgencyStyle.wrap}`}>
      {/* Header — symptom + urgency badge */}
      <div className="px-2.5 py-1.5 flex items-center gap-2 border-b border-current/10">
        <span className="font-semibold text-gray-800 truncate flex-1">
          {locale === "en" ? "Possible causes" : "Боломжит шалтгаан"}
        </span>
        <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold ${urgencyStyle.chip}`}>
          {locale === "en" ? "Urgency" : "Чухал"}: {urgencyStyle.label}
        </span>
      </div>

      {/* Candidate ranked list */}
      <div className="px-2.5 py-1.5 space-y-1.5 bg-white">
        {data.candidates.map((c, i) => {
          const pct = Math.round((c.likelihood || 0) * 100);
          return (
            <div key={`${c.name}-${i}`} className="space-y-0.5">
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-gray-700 truncate flex-1">
                  {i + 1}. {c.name}
                </span>
                <span className="text-[10px] text-gray-500 font-mono shrink-0">{pct}%</span>
              </div>
              <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className={`h-full ${
                    c.urgency === "high"   ? "bg-rose-500" :
                    c.urgency === "medium" ? "bg-amber-500" :
                                              "bg-slate-400"
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              {c.location && (
                <div className="text-[10px] text-gray-500">📍 {c.location}</div>
              )}
            </div>
          );
        })}
      </div>

      {/* Clarifying question chips */}
      {data.clarifyingQuestions.length > 0 && (
        <div className="px-2.5 py-1.5 border-t border-current/10 space-y-1">
          <div className="text-[10px] text-gray-500 uppercase tracking-wide font-semibold">
            {locale === "en" ? "Help narrow it down" : "Нэмэлт асуулт"}
          </div>
          {data.clarifyingQuestions.slice(0, 2).map((q, i) => (
            <button
              key={i}
              onClick={() => onQuickAnswer(q)}
              className="w-full text-left text-[11px] px-2 py-1.5 bg-white hover:bg-violet-50 border border-gray-200 hover:border-violet-300 rounded cursor-pointer transition-colors font-sans text-gray-700">
              ❓ {q}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Phase H — Confidence badge (medium / low bands).
//
// Subtle inline pill below the assistant bubble. Color shifts by band:
//   70-89  amber  ("Магадлал: 78%")
//   50-69  rose   ("AI бүрэн итгэлгүй байна — Магадлал: 62%")
//
// We deliberately DO NOT show this in the high band (≥90) — the
// product UX rule is "no chrome for happy paths". Critical (<50) gets
// the escalation banner instead, not a badge.
// ────────────────────────────────────────────────────────────────────
function ConfidenceBadge({ value, locale }: { value: number; locale: "mn" | "en" }) {
  const isLow = value < 70;
  const wrap  = isLow
    ? "border-rose-200 bg-rose-50 text-rose-700"
    : "border-amber-200 bg-amber-50 text-amber-700";
  const label = locale === "en"
    ? (isLow ? `Low confidence — ${value}%` : `Confidence: ${value}%`)
    : (isLow ? `AI бүрэн итгэлгүй байна — Магадлал: ${value}%` : `Магадлал: ${value}%`);

  return (
    <div className={`mt-1.5 inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border ${wrap}`}>
      <AlertTriangle size={9} />
      <span>{label}</span>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Phase H — Escalation banner (CRITICAL band).
//
// Prominent block under the assistant bubble inviting the user to
// connect to a human operator. Renders when reflection.shouldEscalate
// fires (confidence < 50% OR a tool errored mid-turn).
// ────────────────────────────────────────────────────────────────────
function ConfidenceEscalation({
  data, locale,
}: {
  data: NonNullable<AIResponse["escalation"]>;
  locale: "mn" | "en";
}) {
  return (
    <div className="mt-2 border border-rose-200 bg-rose-50 rounded-lg p-2.5 space-y-1.5">
      <div className="flex items-start gap-2 text-[12px]">
        <AlertTriangle size={13} className="text-rose-600 shrink-0 mt-0.5" />
        <span className="text-rose-900">{data.message}</span>
      </div>
      <Link
        href={data.suggestedAction.href}
        className="inline-block text-[11px] px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-md font-semibold transition-colors"
        style={{ textDecoration: "none" }}>
        {locale === "en" ? "Contact operator →" : "Оператортой холбогдох →"}
      </Link>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// layoutToMessage — pure dispatcher from AIResponse → chat-bubble payload.
//
// Extracted out of `send()` so the widget's main render path stays
// readable. The function is pure (no hooks, no store touch), trivial
// to unit-test, and the same shape every AI response converges on.
// ────────────────────────────────────────────────────────────────────
function layoutToMessage(resp: AIResponse): Omit<Message, "id" | "role"> {
  const p = resp.payload || {};
  const msg: Omit<Message, "id" | "role"> = {
    text: resp.reply,
    // Phase H — bubble carries its own confidence/escalation so older
    // bubbles keep their badges when the user keeps chatting.
    confidence: typeof resp.confidence === "number" ? resp.confidence : null,
    escalation: resp.escalation || undefined,
  };
  switch (resp.layout) {
    case "user_cards":
      if (p.items?.length)     msg.products  = p.items;
      if (p.crossRefs?.length) msg.crossRefs = p.crossRefs;
      break;
    case "seller_table":
      if (p.columns && p.rows) {
        msg.table = { columns: p.columns, rows: p.rows, summary: p.summary ?? null };
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
    case "diagnostic":
      if (p.candidates?.length || p.clarifyingQuestions?.length) {
        msg.diagnostic = {
          symptom:             p.symptom || "",
          candidates:          p.candidates || [],
          clarifyingQuestions: p.clarifyingQuestions || [],
          urgency:             p.urgency || "low",
        };
      }
      break;
    // "plain" → reply text only.
  }
  return msg;
}

// ────────────────────────────────────────────────────────────────────
// VehicleSwitcher — Phase G dropdown rendered below the chat header.
//
// One self-contained panel for THREE entry points:
//   ① "Active vehicle" row at the top (with a Clear button)
//   ② Recent vehicles list (move-to-front LRU, capped at 5)
//   ③ Plate input — manual lookup that creates/activates a Vehicle
//
// All actions resolve via callbacks the parent supplied, so the
// switcher is purely presentational. State (loading, error) is also
// owned by the parent so a stale switcher mount can't get out of sync
// after a chat re-render.
// ────────────────────────────────────────────────────────────────────
function VehicleSwitcher({
  activeVehicle, recentVehicles, plateInput, plateBusy, plateErr,
  locale, onPlateInputChange, onLookupPlate, onPickRecent, onClear, onClose,
}: {
  activeVehicle:       ActiveVehicle | null;
  recentVehicles:      ActiveVehicle[];
  plateInput:          string;
  plateBusy:           boolean;
  plateErr:            string;
  locale:              "mn" | "en";
  onPlateInputChange:  (v: string) => void;
  onLookupPlate:       () => void;
  onPickRecent:        (vehicleId: string) => void;
  onClear:             () => void;
  onClose:             () => void;
}) {
  // Filter out the active vehicle from the "recents" list — showing
  // it twice is noise.
  const others = recentVehicles.filter((v) => v.id !== activeVehicle?.id);

  return (
    <div className="border-b border-gray-200 bg-white px-3 py-2.5 text-[12px] space-y-2">
      {/* Active vehicle row */}
      <div className="flex items-center gap-2">
        <Car size={13} className="text-violet-600 shrink-0" />
        <div className="flex-1 min-w-0">
          {activeVehicle ? (
            <>
              <div className="font-semibold text-gray-900 truncate">
                {activeVehicle.manufacturer} {activeVehicle.model}
                {activeVehicle.generation && (
                  <span className="text-gray-400 font-normal"> · {activeVehicle.generation}</span>
                )}
              </div>
              <div className="text-[10px] text-gray-500 font-mono">{activeVehicle.plate}</div>
            </>
          ) : (
            <div className="text-gray-500 italic">
              {locale === "en" ? "No vehicle selected" : "Машин сонгоогүй"}
            </div>
          )}
        </div>
        {activeVehicle && (
          <button
            onClick={onClear} disabled={plateBusy}
            title={locale === "en" ? "Clear vehicle" : "Машингүй болгох"}
            className="text-[10px] px-2 py-0.5 rounded border border-gray-200 text-gray-500 hover:text-red-600 hover:border-red-300 cursor-pointer bg-white transition-colors disabled:opacity-50 font-sans">
            {locale === "en" ? "Clear" : "Цуцлах"}
          </button>
        )}
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 cursor-pointer bg-transparent border-none p-0.5">
          <X size={12} />
        </button>
      </div>

      {/* Recents */}
      {others.length > 0 && (
        <div className="space-y-1 pt-1 border-t border-gray-100">
          <div className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">
            {locale === "en" ? "Recent" : "Сүүлийн машинууд"}
          </div>
          <div className="space-y-0.5">
            {others.map((v) => (
              <button
                key={v.id}
                onClick={() => onPickRecent(v.id)}
                disabled={plateBusy}
                className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-violet-50 cursor-pointer bg-transparent border-none transition-colors disabled:opacity-50 font-sans">
                <Car size={11} className="text-gray-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] text-gray-800 truncate">
                    {v.manufacturer} {v.model}
                    {v.generation && <span className="text-gray-400 font-normal"> · {v.generation}</span>}
                  </div>
                  <div className="text-[10px] text-gray-400 font-mono">{v.plate}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Manual plate input */}
      <div className="pt-1 border-t border-gray-100 space-y-1.5">
        <div className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">
          {locale === "en" ? "New plate" : "Шинэ дугаар"}
        </div>
        <div className="flex gap-1.5">
          <input
            value={plateInput}
            onChange={(e) => onPlateInputChange(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === "Enter" && !plateBusy && onLookupPlate()}
            placeholder="1234УБА"
            className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1.5 text-[12px] font-mono focus:border-violet-500 focus:bg-white outline-none transition-colors"
            autoCapitalize="characters"
            spellCheck={false}
          />
          <button
            onClick={onLookupPlate}
            disabled={plateBusy || !plateInput.trim()}
            className="shrink-0 inline-flex items-center gap-1 bg-violet-600 hover:bg-violet-700 disabled:bg-violet-300 text-white rounded-lg px-2.5 py-1.5 text-[11px] font-semibold cursor-pointer border-none transition-colors font-sans">
            {plateBusy
              ? <Loader2 size={11} className="animate-spin" />
              : <SearchIcon size={11} />}
            {locale === "en" ? "Look up" : "Хайх"}
          </button>
        </div>
        {plateErr && (
          <div className="text-[11px] text-red-600 flex items-center gap-1">
            <AlertTriangle size={10} /> {plateErr}
          </div>
        )}
        <div className="text-[10px] text-gray-400 italic">
          {locale === "en"
            ? "Tip: type /car anywhere to open this menu."
            : "Зөвлөгөө: чат дотор /car бичвэл энэ цонх нээгдэнэ."}
        </div>
      </div>
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
