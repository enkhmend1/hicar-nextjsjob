"use client";

/**
 * Global "Ask AI" bridge — mirrors the cartDrawer pattern.
 *
 * Any surface (NavSearch dropdown, banners, empty states…) can call
 * `openAIChat("query")` and the globally-mounted AIChatWidget opens
 * itself and auto-sends the query through the normal agent pipeline
 * (vehicle context, OEM cross-refs, diagnostics — everything).
 *
 * Kept as a tiny standalone Zustand slice so subscribers don't
 * re-render on unrelated chat-internal state.
 */

import { create } from "zustand";

interface AIChatBridge {
  /** One-shot "please open" trigger — the widget consumes + resets it. */
  open: boolean;
  /** Query the widget should auto-send on next open (one-shot). */
  pendingQuery: string | null;
  set: (open: boolean) => void;
  askAI: (query?: string) => void;
  consumeQuery: () => string | null;
}

export const useAIChat = create<AIChatBridge>((set, get) => ({
  open: false,
  pendingQuery: null,
  set: (open) => set({ open }),
  askAI: (query) => set({ open: true, pendingQuery: query?.trim() || null }),
  consumeQuery: () => {
    const q = get().pendingQuery;
    if (q) set({ pendingQuery: null });
    return q;
  },
}));

export const openAIChat = (query?: string) => useAIChat.getState().askAI(query);
