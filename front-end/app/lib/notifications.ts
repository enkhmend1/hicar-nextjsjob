"use client";

/**
 * Notifications store — single source of truth for the bell across EVERY
 * surface (buyer navbar desktop + mobile, seller layout, admin layout).
 *
 * Why a store instead of per-bell state: the bell used to live only in the
 * buyer navbar (desktop-only), so sellers/admins and all mobile users never
 * saw their RFQ / support / order notifications. Now a single global poller
 * (<NotificationPoller/> in the root layout) drives this store, and any
 * number of presentational <NotificationBell/> instances read from it — one
 * fetch, one "new notification" alert, consistent unread count everywhere.
 *
 * Immediacy: the poller refreshes on an interval AND on tab focus. When a
 * genuinely NEW unread notification appears, `load()` fires a best-effort
 * cue — a short Web-Audio chime, a vibrate, and a toast — so the user
 * notices without staring at the bell. (Sound/vibrate are best-effort:
 * browsers may suppress audio until the user has interacted with the page.)
 */

import { create } from "zustand";
import { api } from "@/lib/api";
import { toast } from "@/app/lib/toast";

export interface Notif {
  _id: string;
  type: string;
  title: string;
  body: string;
  link: string;
  read: boolean;
  createdAt: string;
}

interface NotifState {
  items: Notif[];
  unread: number;
  loaded: boolean;
  load: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAll: () => Promise<void>;
  remove: (id: string) => Promise<void>;
  reset: () => void;
}

// Module-level so it survives re-renders. `null` = not yet primed: the FIRST
// successful load only records a baseline and never alerts (otherwise every
// page load would chime for pre-existing unread items).
let seenIds: Set<string> | null = null;

// Shared AudioContext. Browsers start it "suspended" until a user gesture, so
// we create + resume it once on the first interaction (unlockAudio, wired from
// <NotificationPoller/>). Reusing one unlocked context is what makes the chime
// actually fire on later notifications, including on mobile Safari/Chrome.
let audioCtx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  try {
    const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
    const Ctx = w.AudioContext || w.webkitAudioContext;
    if (!Ctx) return null;
    if (!audioCtx) audioCtx = new Ctx();
    if (audioCtx.state === "suspended") void audioCtx.resume();
    return audioCtx;
  } catch { return null; }
}

/** Unlock audio on the first user gesture so later chimes aren't blocked. */
export function unlockAudio() {
  getCtx();
}

/** Short, self-contained "ding" via Web Audio — no asset file needed. */
function chime() {
  try {
    const ctx = getCtx();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(1175, ctx.currentTime + 0.09);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
    osc.start();
    osc.stop(ctx.currentTime + 0.42);
  } catch { /* autoplay blocked / unsupported — toast still fires */ }
}

export const useNotifications = create<NotifState>((set) => ({
  items: [],
  unread: 0,
  loaded: false,

  load: async () => {
    try {
      const { items, unreadCount } = await api.get<{ items: Notif[]; unreadCount: number }>(
        "/notifications?limit=20",
      );
      // Alert only for UNREAD items we've never seen — and never on the very
      // first prime, so a fresh page load is silent.
      if (seenIds) {
        const fresh = items.filter((n) => !n.read && !seenIds!.has(n._id));
        if (fresh.length > 0) {
          chime();
          try { navigator.vibrate?.([120, 60, 120]); } catch { /* unsupported */ }
          const top = fresh[0];
          toast.info(
            top.title || "Шинэ мэдэгдэл",
            top.link ? { action: { label: "Үзэх", href: top.link } } : undefined,
          );
        }
      }
      seenIds = new Set(items.map((n) => n._id));
      set({ items, unread: unreadCount, loaded: true });
    } catch { /* network blip — keep previous state */ }
  },

  markRead: async (id) => {
    set((s) => ({
      items: s.items.map((n) => (n._id === id ? { ...n, read: true } : n)),
      unread: Math.max(0, s.unread - 1),
    }));
    try { await api.patch(`/notifications/${id}/read`); } catch { /* optimistic */ }
  },

  markAll: async () => {
    set((s) => ({ items: s.items.map((n) => ({ ...n, read: true })), unread: 0 }));
    try { await api.patch("/notifications/read-all"); } catch { /* optimistic */ }
  },

  remove: async (id) => {
    set((s) => ({ items: s.items.filter((n) => n._id !== id) }));
    try { await api.delete(`/notifications/${id}`); } catch { /* optimistic */ }
  },

  reset: () => {
    seenIds = null;
    set({ items: [], unread: 0, loaded: false });
  },
}));
