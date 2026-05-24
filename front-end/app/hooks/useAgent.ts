"use client";

/**
 * useAgent() — the single orchestrator hook the chat UI consumes.
 *
 * Why this exists:
 *   The widget previously did three jobs: render UI, call HTTP, mutate
 *   Zustand. That made the widget 700+ lines and meant every new
 *   capability (memory, plate switcher, …) bloated the same file.
 *
 *   useAgent() centralises the AGENT side of the work — talk to the
 *   /api/ai/* endpoints, keep the store in sync, expose loading +
 *   error state per concern. The widget becomes thin: render and emit.
 *
 * What it owns:
 *   • sendChat(text, imageUrl?, opts?)  — POST /api/ai/chat
 *   • switchVehicleByPlate(plate)       — POST /memory/active-vehicle {plate}
 *   • switchVehicleByVehicleId(id)      — POST /memory/active-vehicle {vehicleId}
 *   • clearVehicle()                    — DELETE /memory/active-vehicle
 *   • hydrateMemory()                   — GET /memory + merge into store
 *
 * What it does NOT own:
 *   • The `messages[]` chat thread (UI state — stays in widget)
 *   • Slash-command parsing (UI affordance — stays in widget)
 *   • The XLSX downloads (browser-only side effect — stays in widget)
 *
 *   Those are inherently UI concerns and leaking them into the hook
 *   would only add indirection without removing complexity.
 *
 * State exposed:
 *   • busy            — chat send in flight
 *   • plateBusy       — vehicle switch / lookup in flight
 *   • chatError       — last chat send failure ("" if none)
 *   • plateError      — last vehicle switch failure ("" if none)
 *   • clearErrors()   — reset both error slots
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuthStore, useCarStore, type ActiveVehicle } from "@/store";
import { useLocale } from "@/lib/i18n";
import { ApiError } from "@/lib/api";
import {
  memoryService, toActiveVehicle, type ServerVehicle,
} from "@/app/lib/services/memory.service";
import {
  chatService, type AIResponse, type ChatMessage,
} from "@/app/lib/services/chat.service";

export interface UseAgentReturn {
  // State
  busy: boolean;
  plateBusy: boolean;
  chatError: string;
  plateError: string;

  // Phase M.1: rate-limit cooldown. `rateLimitedUntil` is epoch ms;
  // 0 = not rate limited. `secondsUntilRetry` is the live countdown the
  // UI shows in the input affordance. While cooldown is active, the
  // last attempt auto-resends once when it expires.
  rateLimitedUntil:  number;
  secondsUntilRetry: number;
  cancelRateLimit:   () => void;

  // Chat
  sendChat: (messages: ChatMessage[]) => Promise<AIResponse | null>;

  // Vehicle switcher
  switchVehicleByPlate:    (plate: string) => Promise<{ ok: boolean; vehicle?: ActiveVehicle; message?: string }>;
  switchVehicleByVehicleId:(id: string)    => Promise<{ ok: boolean; vehicle?: ActiveVehicle; message?: string }>;
  clearVehicle:            () => Promise<void>;

  // Memory sync
  hydrateMemory:           () => Promise<void>;

  // Misc
  clearErrors:             () => void;
}

export function useAgent(): UseAgentReturn {
  const { user }         = useAuthStore();
  const { locale }       = useLocale();
  const activeVehicle    = useCarStore((s) => s.activeVehicle);
  const setActiveVehicle = useCarStore((s) => s.setActiveVehicle);
  const clearActiveVehicleInStore = useCarStore((s) => s.clearActiveVehicle);
  const hydrateRecentVehicles     = useCarStore((s) => s.hydrateRecentVehicles);

  const [busy,       setBusy]       = useState(false);
  const [plateBusy,  setPlateBusy]  = useState(false);
  const [chatError,  setChatError]  = useState("");
  const [plateError, setPlateError] = useState("");

  // Phase M.1: rate-limit cooldown machinery.
  //   • rateLimitedUntil — epoch ms. 0 means "not in cooldown".
  //   • _tick           — forces a re-render each second so countdown updates.
  //   • autoRetryTimer  — pending auto-resend; cleared if user cancels.
  //   • inAutoRetry     — true while running the post-cooldown retry, so
  //                       a SECOND 429 doesn't schedule a THIRD attempt
  //                       (we cap automatic retries at one per failure).
  const [rateLimitedUntil, setRateLimitedUntil] = useState<number>(0);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_tick, setTick] = useState(0);
  const autoRetryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inAutoRetry    = useRef<boolean>(false);

  // Tick once per second while we're in cooldown so consumers reading
  // `secondsUntilRetry` see a live countdown. Tear down the interval
  // when cooldown is cleared OR the component unmounts.
  useEffect(() => {
    if (rateLimitedUntil <= Date.now()) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [rateLimitedUntil]);

  // Derived: live countdown the UI shows in the input affordance.
  const secondsUntilRetry = rateLimitedUntil > Date.now()
    ? Math.ceil((rateLimitedUntil - Date.now()) / 1000)
    : 0;

  // Cancel auto-retry on unmount so we don't fire a request into a dead
  // component (which would set state and warn in React 19).
  useEffect(() => () => {
    if (autoRetryTimer.current) {
      clearTimeout(autoRetryTimer.current);
      autoRetryTimer.current = null;
    }
  }, []);

  const cancelRateLimit = useCallback(() => {
    if (autoRetryTimer.current) {
      clearTimeout(autoRetryTimer.current);
      autoRetryTimer.current = null;
    }
    setRateLimitedUntil(0);
    inAutoRetry.current = false;
  }, []);

  // ── Chat ─────────────────────────────────────────────────────────
  // Phase J.2: error mapping table — distinguish rate-limit, upstream
  // outage, validation-failure, and generic so the user sees a useful
  // message instead of a flat "Алдаа гарлаа".
  //
  // Phase M.1: ref-pattern indirection so the auto-retry timer can call
  // the LATEST sendChat without taking it as a useCallback dep (which
  // would re-create the callback on every retry and break the dep array).
  const sendChatRef = useRef<((messages: ChatMessage[]) => Promise<AIResponse | null>) | null>(null);
  const sendChat = useCallback(async (messages: ChatMessage[]): Promise<AIResponse | null> => {
    setBusy(true); setChatError("");
    try {
      const resp = await chatService.send(messages, { locale, vehicle: activeVehicle });
      // Phase M.1: successful response — clear any lingering cooldown
      // (e.g. user manually retried mid-countdown and it worked).
      if (rateLimitedUntil > 0) {
        setRateLimitedUntil(0);
        inAutoRetry.current = false;
      }
      return resp;
    } catch (e) {
      const ae = e as ApiError;
      const code = (ae.data?.code as string | undefined);
      let msg: string;
      switch (code) {
        case "AI_RATE_LIMITED": {
          const wait = Math.max(3, Math.min(60, Number(ae.data?.retryAfter) || 8));
          // Phase M.1: instead of a dead error, schedule an auto-retry.
          // We only schedule once per failure (`inAutoRetry` flag) so a
          // SECOND 429 during the retry doesn't loop forever — that path
          // surfaces the error and the user can decide.
          if (!inAutoRetry.current) {
            const until = Date.now() + wait * 1000;
            setRateLimitedUntil(until);
            if (autoRetryTimer.current) clearTimeout(autoRetryTimer.current);
            autoRetryTimer.current = setTimeout(() => {
              autoRetryTimer.current = null;
              inAutoRetry.current = true;
              // Re-fire the SAME messages array via the ref so we always
              // call the latest sendChat (and don't capture a stale one
              // from the closure). If this also 429s, the inAutoRetry
              // guard prevents another schedule and the error surfaces.
              void sendChatRef.current?.(messages).finally(() => {
                inAutoRetry.current = false;
              });
            }, wait * 1000);
            msg = locale === "en"
              ? `Rate limited — auto-retrying in ${wait}s…`
              : `Хүсэлт хэт олон — ${wait} секундын дараа автоматаар дахин илгээнэ…`;
          } else {
            // Second 429 during auto-retry. Don't schedule again.
            msg = locale === "en"
              ? "Still rate limited — please wait a moment and try again."
              : "Дахиад л хязгаарт хүрсэн — түр хүлээж дахин оролдоно уу.";
          }
          break;
        }
        case "AI_AUTH_FAILED":
          msg = locale === "en"
            ? "AI provider auth failed. Operator must check API keys."
            : "AI үйлчилгээ нэвтрэх алдаатай. Оператортой холбогдоно уу.";
          break;
        case "AI_PROVIDER_UNAVAILABLE":
        case "AI_UPSTREAM_UNREACHABLE":
        case "AI_UPSTREAM_ERROR":
          msg = locale === "en"
            ? "AI service is temporarily unavailable. Please retry shortly."
            : "AI үйлчилгээ түр ажиллахгүй байна. Дахин оролдоно уу.";
          break;
        case "EMPTY_PROMPT":
          msg = locale === "en"
            ? "Please describe what you're looking for in more detail."
            : "Юу хайж байгаагаа илүү дэлгэрэнгүй бичээрэй.";
          break;
        case "VISION_PROVIDER_UNAVAILABLE":
          msg = locale === "en"
            ? "Image analysis isn't configured. Type the part name instead."
            : "Зургийн AI тохируулагдаагүй. Сэлбэгийн нэрийг бичээрэй.";
          break;
        case "AI_DISABLED_FOR_IMAGE":
          msg = locale === "en"
            ? "Image search needs an AI provider. Try text search instead."
            : "Зургийн хайлт AI шаардана. Текстээр хайна уу.";
          break;
        case "AI_INTERNAL_ERROR":
          msg = locale === "en"
            ? "Something broke internally. We've logged it — please retry."
            : "Дотоод алдаа гарлаа. Бид бүртгэсэн — дахин оролдоно уу.";
          break;
        default:
          // Use the server's message if it looks human-readable, otherwise
          // fall back to the generic.
          msg = ae.message && ae.message.length < 200 && !ae.message.includes("\n")
            ? ae.message
            : (locale === "en"
              ? "Chat failed — please try again."
              : "Чат алдаа гарлаа — дахин оролдоно уу.");
      }
      setChatError(msg);
      return null;
    } finally {
      setBusy(false);
    }
  }, [locale, activeVehicle, rateLimitedUntil]);

  // Keep sendChatRef pointed at the latest sendChat. The auto-retry
  // timer fires via sendChatRef.current(), so this assignment guarantees
  // it always sees the freshest closure (latest locale / vehicle).
  useEffect(() => {
    sendChatRef.current = sendChat;
  }, [sendChat]);

  // ── Vehicle switcher ─────────────────────────────────────────────
  // Both switch paths share the same post-success effect: update Zustand
  // active vehicle + hydrate the recents from the server (which is the
  // source of truth across devices).
  const applySwitchResult = useCallback((v: ServerVehicle, recents: ServerVehicle[] | undefined) => {
    const active = toActiveVehicle(v);
    setActiveVehicle(active);
    if (recents?.length) hydrateRecentVehicles(recents.map(toActiveVehicle));
    return active;
  }, [setActiveVehicle, hydrateRecentVehicles]);

  const switchVehicleByPlate = useCallback(async (plate: string) => {
    setPlateBusy(true); setPlateError("");
    try {
      const r = await memoryService.setActiveByPlate(plate);
      const v = applySwitchResult(r.vehicle, r.memory?.recentVehicles);
      return { ok: true, vehicle: v };
    } catch (e) {
      const ae = e as ApiError;
      const message = (ae.data?.code === "PLATE_LOOKUP_FAILED")
        ? `${plate} дугаар олдсонгүй. Дугаараа дахин нягтлана уу.`
        : (ae.data?.code === "PLATE_INVALID")
        ? "Дугаар буруу — 4 тоо + 3 кирилл (1234УБА)"
        : (ae.message || (locale === "en" ? "Vehicle switch failed" : "Машин солих үед алдаа гарлаа"));
      setPlateError(message);
      return { ok: false, message };
    } finally {
      setPlateBusy(false);
    }
  }, [applySwitchResult, locale]);

  const switchVehicleByVehicleId = useCallback(async (id: string) => {
    setPlateBusy(true); setPlateError("");
    try {
      const r = await memoryService.setActiveByVehicleId(id);
      const v = applySwitchResult(r.vehicle, r.memory?.recentVehicles);
      return { ok: true, vehicle: v };
    } catch (e) {
      const ae = e as ApiError;
      const message = ae.message || (locale === "en"
        ? "Vehicle switch failed"
        : "Машин солих үед алдаа гарлаа");
      setPlateError(message);
      return { ok: false, message };
    } finally {
      setPlateBusy(false);
    }
  }, [applySwitchResult, locale]);

  const clearVehicle = useCallback(async () => {
    setPlateBusy(true); setPlateError("");
    try {
      // Server clear is best-effort. Even if it fails, we always drop
      // the local active — the user explicitly asked.
      if (user) await memoryService.clearActive();
    } catch {
      /* swallow — local clear below is what the user sees */
    } finally {
      clearActiveVehicleInStore();
      setPlateBusy(false);
    }
  }, [user, clearActiveVehicleInStore]);

  // ── Memory hydrate ──────────────────────────────────────────────
  const hydrateMemory = useCallback(async () => {
    if (!user) return;       // anon users have no server-side memory
    const memory = await memoryService.load();
    if (!memory) return;
    if (memory.recentVehicles?.length) {
      hydrateRecentVehicles(memory.recentVehicles.map(toActiveVehicle));
    }
    // If the server knows an active vehicle but localStorage was
    // cleared (e.g. private window), restore it locally.
    if (!activeVehicle && memory.activeVehicle) {
      setActiveVehicle(toActiveVehicle(memory.activeVehicle));
    }
  }, [user, activeVehicle, hydrateRecentVehicles, setActiveVehicle]);

  const clearErrors = useCallback(() => {
    setChatError("");
    setPlateError("");
  }, []);

  return {
    busy, plateBusy, chatError, plateError,
    rateLimitedUntil, secondsUntilRetry, cancelRateLimit,
    sendChat,
    switchVehicleByPlate, switchVehicleByVehicleId, clearVehicle,
    hydrateMemory,
    clearErrors,
  };
}
