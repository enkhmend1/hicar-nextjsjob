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
  /** Image File the widget should upload + vision-search on next open (one-shot). */
  pendingImage: File | null;
  set: (open: boolean) => void;
  askAI: (query?: string) => void;
  /** Open the chat and run an image (vision) search with this File. */
  askImage: (file: File) => void;
  consumeQuery: () => string | null;
  consumeImage: () => File | null;
}

export const useAIChat = create<AIChatBridge>((set, get) => ({
  open: false,
  pendingQuery: null,
  pendingImage: null,
  set: (open) => set({ open }),
  askAI: (query) => set({ open: true, pendingQuery: query?.trim() || null }),
  askImage: (file) => set({ open: true, pendingImage: file }),
  consumeQuery: () => {
    const q = get().pendingQuery;
    if (q) set({ pendingQuery: null });
    return q;
  },
  consumeImage: () => {
    const f = get().pendingImage;
    if (f) set({ pendingImage: null });
    return f;
  },
}));

export const openAIChat = (query?: string) => useAIChat.getState().askAI(query);
/** Open the AI chat and run a vision search on a captured/picked image. */
export const openAIChatWithImage = (file: File) => useAIChat.getState().askImage(file);
