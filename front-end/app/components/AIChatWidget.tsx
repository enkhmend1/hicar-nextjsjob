"use client";

import { useEffect, useRef, useState, useCallback, useMemo, type PointerEvent as ReactPointerEvent } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import * as XLSX from "xlsx";
import { api } from "@/lib/api";
import { useAuthStore, useCarStore, type ActiveVehicle } from "@/store";
import { useLocale } from "@/lib/i18n";
import { Product, Order } from "@/app/types";
import { createVoiceRecognition, isVoiceSupported } from "@/lib/voice";
import { useAgent } from "@/app/hooks/useAgent";
import { useAIChat } from "@/app/lib/aiChat";
import { detectMongolianPlate, normalizeMongolianPlate } from "@/app/lib/plateDetector";
import { MessageCircle, X, Minus, Send, Bot, Sparkles, FileSpreadsheet, AlertTriangle, Mic, MicOff, ImagePlus, Loader2, Car, ChevronDown, Clock } from "lucide-react";
// Chat-widget types + sub-renderers extracted to ./ai-chat/* (Phase: split a
// 1.4k-line file). This component keeps only the orchestrating shell.
import type { Message, Suggestion } from "./ai-chat/types";
import DiagFormCard from "./ai-chat/DiagFormCard";
import QuotationCard from "./ai-chat/QuotationCard";
import DiagnosticCard from "./ai-chat/DiagnosticCard";
import { ConfidenceBadge, ConfidenceEscalation } from "./ai-chat/ConfidenceBits";
import VehicleSwitcher from "./ai-chat/VehicleSwitcher";
import AdminWidget from "./ai-chat/AdminWidget";
import { layoutToMessage } from "./ai-chat/layoutToMessage";

/** /car or /changecar — both open the switcher dropdown without sending. */
const SLASH_CAR_RX = /^\/(?:car|changecar)\b/i;

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

/** Keep a dragged position fully inside the current viewport (8px margin). */
const clampToView = (x: number, y: number, w: number, h: number) => ({
  x: Math.min(Math.max(8, x), Math.max(8, window.innerWidth - w - 8)),
  y: Math.min(Math.max(8, y), Math.max(8, window.innerHeight - h - 8)),
});

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
  // Auth screens (/auth/login|register|forgot|reset) are a minimal,
  // single-task flow — the floating launcher overlaps their submit
  // buttons on small phones and has no business being there.
  const isAuthPath = !!pathname?.startsWith("/auth");

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

  // ── Draggable widget ──────────────────────────────────────────────
  // The launcher (and the open panel via its header) can be dragged out of
  // the way of anything it overlaps. FAB + panel keep SEPARATE persisted
  // positions (different footprints); panel dragging is desktop-only since
  // the panel is a fullscreen sheet on mobile.
  const [fabPos, setFabPos] = useState<{ x: number; y: number } | null>(null);
  const [panelPos, setPanelPos] = useState<{ x: number; y: number } | null>(null);
  const [isDesktop, setIsDesktop] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const fabRef = useRef<HTMLButtonElement>(null);
  const dragRef = useRef<{ sx: number; sy: number; dx: number; dy: number; w: number; h: number; setter: (p: { x: number; y: number }) => void; key: string } | null>(null);
  const movedRef = useRef(false);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const load = (k: string) => {
      try { const r = localStorage.getItem(k); return r ? (JSON.parse(r) as { x: number; y: number }) : null; }
      catch { return null; }
    };
    // Persisted positions are raw pixels from SOME past viewport. Mobile
    // browsers change innerWidth/innerHeight between visits (URL bar,
    // keyboard, rotation), so an unclamped restore can park the widget
    // outside the visible screen with no way to drag it back. Re-clamp
    // against the CURRENT viewport on restore and on every resize.
    // Panel size = its md+ footprint (360×600) — custom pos is desktop-only.
    const fabSize = () => {
      const r = fabRef.current?.getBoundingClientRect();
      return { w: r?.width || 160, h: r?.height || 48 };
    };
    const clampSaved = (p: { x: number; y: number } | null, w: number, h: number) =>
      p ? clampToView(p.x, p.y, w, h) : null;
    const s = fabSize();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFabPos(clampSaved(load("hicar-aichat-fab"), s.w, s.h));
    setPanelPos(clampSaved(load("hicar-aichat-panel"), 360, 600));
    const reclamp = () => {
      const cs = fabSize();
      setFabPos((p) => (p ? clampToView(p.x, p.y, cs.w, cs.h) : p));
      setPanelPos((p) => (p ? clampToView(p.x, p.y, 360, 600) : p));
    };
    window.addEventListener("resize", reclamp);
    const mq = window.matchMedia("(min-width: 768px)");
    const sync = () => setIsDesktop(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => { window.removeEventListener("resize", reclamp); mq.removeEventListener("change", sync); };
  }, []);

  const beginDrag = (e: ReactPointerEvent, el: HTMLElement | null, setter: (p: { x: number; y: number }) => void, key: string) => {
    if (!el) return;
    const r = el.getBoundingClientRect();
    dragRef.current = { sx: e.clientX, sy: e.clientY, dx: e.clientX - r.left, dy: e.clientY - r.top, w: r.width, h: r.height, setter, key };
    movedRef.current = false;
    lastPosRef.current = null;
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* unsupported */ }
  };
  const moveDrag = (e: ReactPointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    // Treat as a drag (not a click) only past a 5px dead-zone from the start —
    // tolerates finger jitter so a plain tap still opens the chat. Inside the
    // dead-zone nothing moves or persists: a tap must never trade the
    // responsive bottom/right anchor for a stale absolute pixel position.
    if (!movedRef.current && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) <= 5) return;
    movedRef.current = true;
    const p = clampToView(e.clientX - d.dx, e.clientY - d.dy, d.w, d.h);
    lastPosRef.current = p;
    d.setter(p);
  };
  const endDrag = () => {
    const d = dragRef.current;
    if (!d) return;
    if (lastPosRef.current) { try { localStorage.setItem(d.key, JSON.stringify(lastPosRef.current)); } catch { /* quota */ } }
    dragRef.current = null;
  };

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
        : `Сайн уу 👋 Таны ${car}-ын ямар сэлбэгийг хайя?`;
    } else {
      greet = locale === "en" ? USER_GREETING_EN : USER_GREETING_MN;
    }
    // Greet message reset — legitimate sync setState in effect (locale or
    // surface change → swap opening bubble). React 19's compiler lint is
    // overly aggressive on this canonical pattern.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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

  // `pushAi` нь дараах useCallback-ууд дотроос дуудагдах учир ЭХЛЭЭД
  // зарлах ёстой — JS-ийн const/let нь hoist хийгддэггүй (TDZ). Closure-
  // ийн lookup нь runtime-д явдаг учир хуучин код практик дээр ажилладаг
  // байсан ч ESLint react-compiler болон strict-mode хоёр анхааруулдаг.
  const pushAi = useCallback((m: Omit<Message, "id" | "role">) => {
    setMessages(prev => [...prev, { id: idRef.current++, role: "ai", ...m }]);
  }, []);

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
  }, [agent, locale, pushAi]);

  const clearVehicle = useCallback(async () => {
    await agent.clearVehicle();
    setSwitcherOpen(false);
  }, [agent]);

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

    const result = await agent.sendChat(history);
    if (!result.ok) {
      // Phase M.2.2: errorMessage comes back in-band so we don't read a
      // stale `agent.chatError` from a closure that captured the value
      // BEFORE setState had a chance to flush.
      pushAi({ text: result.errorMessage, error: true });
      return;
    }

    // Dispatch on layout — pure UI logic stays in the widget.
    pushAi(layoutToMessage(result.response));
  }, [input, busy, isAdminPath, messages, agent, pushAi]);

  // ── Global "Ask AI" bridge ─────────────────────────────────────
  // NavSearch (or any surface) calls openAIChat("query") — the widget
  // opens itself and auto-sends the query through the normal agent
  // pipeline. If a reply is already in flight, the query is parked in
  // the input instead so nothing is silently dropped.
  const askOpen = useAIChat((s) => s.open);
  useEffect(() => {
    if (!askOpen) return;
    useAIChat.getState().set(false); // one-shot trigger consumed
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsOpen(true);
    setIsMinimized(false);
    const q = useAIChat.getState().consumeQuery();
    if (q) {
      if (busy) setInput(q);
      else void send(q);
    }
  }, [askOpen, busy, send]);

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

  // Hidden entirely on auth screens. Placed after every hook so the
  // hooks order stays identical across renders (rules-of-hooks).
  if (isAuthPath) return null;

  // Route-aware mobile anchor for the launcher:
  //  • /shop/[id] has a sticky add-to-cart bar (bottom-16 + ~4.5rem tall)
  //    that the default 4.5rem anchor lands ON TOP of — lift above it.
  //  • /admin + /seller layouts have no MobileBottomNav, so the default
  //    stilt would leave the button floating mid-air — drop to 1.25rem.
  //  • everywhere else: clear the 56px bottom tab bar (+ iOS safe area).
  const isProductDetail = /^\/shop\/[^/]+/.test(pathname ?? "");
  const hasBottomNav = !(pathname?.startsWith("/admin") || pathname?.startsWith("/seller"));
  const fabAnchor = isProductDetail
    ? "bottom-[calc(8.75rem+env(safe-area-inset-bottom))]"
    : hasBottomNav
      ? "bottom-[calc(4.5rem+env(safe-area-inset-bottom))]"
      : "bottom-[calc(1.25rem+env(safe-area-inset-bottom))]";

  if (!isOpen || isMinimized) {
    return (
      <button
        ref={fabRef}
        // Click opens — unless the pointer was dragged (reposition), in which
        // case we swallow the click so a drag never accidentally opens chat.
        onClick={() => { if (movedRef.current) { movedRef.current = false; return; } setIsOpen(true); setIsMinimized(false); }}
        onPointerDown={(e) => beginDrag(e, e.currentTarget, setFabPos, "hicar-aichat-fab")}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        // Default anchor lifts above the 56px mobile bottom nav (+ iOS safe
        // area); once dragged, an inline left/top overrides the anchor.
        style={fabPos ? { left: fabPos.x, top: fabPos.y, right: "auto", bottom: "auto" } : undefined}
        className={`fixed ${fabAnchor} md:bottom-5 right-5 z-50 flex items-center gap-2 bg-gradient-to-r from-blue-600 to-amber-600 hover:from-blue-700 hover:to-amber-700 text-white rounded-full shadow-lg shadow-blue-300 px-4 h-12 cursor-pointer active:cursor-grabbing touch-none select-none border-none transition-colors font-sans`}
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
    // Mobile (<md): true fullscreen sheet so the keyboard + thread get the
    // whole viewport. md+: floating 360px panel anchored bottom-right, or a
    // dragged left/top position (desktop only — mobile stays fullscreen).
    <div ref={panelRef}
      style={panelPos && isDesktop ? { left: panelPos.x, top: panelPos.y, right: "auto", bottom: "auto", margin: 0 } : undefined}
      className="fixed inset-0 z-50 w-full h-full bg-white border-0 shadow-2xl flex flex-col overflow-hidden md:inset-auto md:bottom-5 md:right-5 md:w-[360px] md:max-w-[calc(100vw-2rem)] md:h-[600px] md:max-h-[calc(100vh-2rem)] md:border md:border-gray-200 md:rounded-2xl">
      <div
        // Drag handle (desktop only — the panel is fullscreen on mobile).
        // Ignore drags that start on an interactive control inside the header.
        onPointerDown={(e) => { if (!isDesktop) return; if ((e.target as HTMLElement).closest("button")) return; beginDrag(e, panelRef.current, setPanelPos, "hicar-aichat-panel"); }}
        onPointerMove={(e) => { if (dragRef.current) moveDrag(e); }}
        onPointerUp={endDrag}
        className={`flex items-center justify-between px-4 py-3 md:cursor-grab md:active:cursor-grabbing select-none ${isAdminPath ? "bg-gradient-to-r from-blue-700 to-indigo-700" : "bg-gradient-to-r from-blue-600 to-amber-500"} text-white`}>
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
                className="mt-0.5 -ml-1 text-[11px] opacity-90 hover:opacity-100 flex items-center gap-1 truncate cursor-pointer bg-white/10 hover:bg-white/20 rounded-md border-none text-white px-1.5 py-1 m-0 font-sans transition-colors">
                <Car size={11} />
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
                <ChevronDown size={11} className={`transition-transform ${switcherOpen ? "rotate-180" : ""}`} />
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
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/15 cursor-pointer bg-transparent border-none text-white">
            <Minus size={14} />
          </button>
          <button onClick={() => { setIsOpen(false); setIsMinimized(false); }}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/15 cursor-pointer bg-transparent border-none text-white">
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
                ? "bg-blue-600 text-white rounded-br-sm"
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
                    <Link key={p.id} href={`/shop/${p.id}`} className="block bg-gray-50 hover:bg-blue-50 border border-gray-200 hover:border-blue-300 rounded-lg p-2.5 transition-colors">
                      <div className="text-[12px] font-semibold text-gray-900 line-clamp-1">{p.name}</div>
                      <div className="text-[10px] text-gray-400 font-mono">{p.oem}{p.brand ? ` · ${p.brand}` : ""}</div>
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-[12px] font-bold text-blue-600">₮{p.price.toLocaleString()}</span>
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

              {/* Phase AL — "Хамт ихэвчлэн авдаг" bundle strip. Renders
                  ONLY when both main products AND related items are
                  present (related without main = stale UX). Horizontal-
                  scroll layout to avoid pushing the next assistant bubble
                  off-screen — Amazon's mobile pattern. */}
              {m.related && m.related.length > 0 && m.products && m.products.length > 0 && (
                <div className="mt-2.5 pt-2 border-t border-gray-100">
                  <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                    ＋ Хамт ихэвчлэн авдаг
                  </div>
                  <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-0.5 px-0.5 scrollbar-none">
                    {m.related.map((p) => (
                      <Link
                        key={p.id}
                        href={`/shop/${p.id}`}
                        className="shrink-0 w-[130px] bg-blue-50/60 hover:bg-blue-100/80 border border-blue-100 hover:border-blue-300 rounded-lg p-2 transition-colors"
                      >
                        <div className="text-[11px] font-semibold text-gray-900 line-clamp-2 mb-1 min-h-[2.4em]">
                          {p.name}
                        </div>
                        <div className="text-[11px] font-bold text-blue-700">
                          ₮{p.price.toLocaleString()}
                        </div>
                      </Link>
                    ))}
                  </div>
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
                <div className="mt-2 border border-blue-200 rounded-lg overflow-hidden text-[11px]">
                  <div className="bg-blue-50 px-2 py-1 font-semibold text-blue-700">
                    {locale === "en" ? "Cross-references" : "Сонголтууд"}
                  </div>
                  <div className="divide-y divide-blue-100">
                    {m.crossRefs.map((cr, i) => (
                      <div key={`${cr.oem}-${i}`} className="px-2 py-1.5 flex items-center justify-between gap-2">
                        <span className="font-mono text-gray-700 truncate">{cr.oem}</span>
                        <span className="text-gray-500 truncate">{cr.brand}</span>
                        <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded ${cr.role === "oem" ? "bg-blue-100 text-blue-700" : "bg-emerald-100 text-emerald-700"}`}>
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
                                  ? <Link href={cell.href} className="text-blue-600 underline">{cell.label}</Link>
                                  : <button className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded border border-blue-200 text-[10px]">{cell.label}</button>
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
            className="shrink-0 text-[12px] border border-gray-200 rounded-full px-3 py-1.5 text-gray-600 hover:border-blue-400 hover:text-blue-600 cursor-pointer bg-white transition-colors disabled:opacity-50 font-sans">
            {s.label}
          </button>
        ))}
      </div>

      <div className="p-3 border-t border-gray-100 bg-white flex gap-1.5 items-center">
        {!isAdminPath && (
          <>
            <button onClick={() => fileInputRef.current?.click()} disabled={busy || uploadingImg}
              title="Зураг ачаалах"
              className="w-10 h-10 flex items-center justify-center rounded-xl text-gray-400 hover:text-blue-600 hover:bg-blue-50 cursor-pointer bg-transparent border border-gray-200 transition-colors shrink-0 disabled:opacity-50">
              {uploadingImg ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" hidden
              onChange={e => handleImagePick(e.target.files?.[0] || null)} />
          </>
        )}
        {voiceSupported && (
          <button onClick={toggleVoice} disabled={busy}
            title={listening ? "Зогсоох" : "Хоолой бичих"}
            className={`w-10 h-10 flex items-center justify-center rounded-xl cursor-pointer border transition-colors shrink-0 disabled:opacity-50 ${
              listening
                ? "text-white bg-red-500 border-red-500 hover:bg-red-600 animate-pulse"
                : "text-gray-400 hover:text-blue-600 hover:bg-blue-50 bg-transparent border-gray-200"
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
          // text-[16px] on mobile prevents iOS Safari's auto-zoom on focus
          // (it zooms any input with font-size < 16px); compact 13px from md up.
          className={`flex-1 min-w-0 ${inCooldown ? "bg-amber-50 border-amber-200" : "bg-gray-50 border-gray-200"} border rounded-xl px-3 py-2 text-[16px] md:text-[13px] focus:border-blue-500 focus:bg-white transition-colors outline-none`} />
        <button onClick={() => send()} disabled={busy || !input.trim()}
          className="w-10 h-10 flex items-center justify-center bg-gradient-to-r from-blue-600 to-amber-600 hover:from-blue-700 hover:to-amber-700 disabled:from-blue-300 disabled:to-amber-300 text-white rounded-xl cursor-pointer border-none transition-colors shrink-0">
          <Send size={14} />
        </button>
      </div>
    </div>
  );
}
