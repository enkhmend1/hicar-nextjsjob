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

import { useCallback, useState } from "react";
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

  // ── Chat ─────────────────────────────────────────────────────────
  // Phase J.2: error mapping table — distinguish rate-limit, upstream
  // outage, validation-failure, and generic so the user sees a useful
  // message instead of a flat "Алдаа гарлаа".
  const sendChat = useCallback(async (messages: ChatMessage[]): Promise<AIResponse | null> => {
    setBusy(true); setChatError("");
    try {
      const resp = await chatService.send(messages, { locale, vehicle: activeVehicle });
      return resp;
    } catch (e) {
      const ae = e as ApiError;
      const code = (ae.data?.code as string | undefined);
      let msg: string;
      switch (code) {
        case "AI_RATE_LIMITED": {
          const wait = Number(ae.data?.retryAfter) || 30;
          msg = locale === "en"
            ? `Rate limited — please retry in ~${wait}s.`
            : `Хүсэлт хэт олон — ойролцоогоор ${wait} секундын дараа дахин оролдоно уу.`;
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
  }, [locale, activeVehicle]);

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
    sendChat,
    switchVehicleByPlate, switchVehicleByVehicleId, clearVehicle,
    hydrateMemory,
    clearErrors,
  };
}
