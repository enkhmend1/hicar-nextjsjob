"use client";
import { create } from "zustand";
import { api } from "@/lib/api";

interface WishlistStore {
  ids: Set<string>;
  loading: boolean;
  load: () => Promise<void>;
  toggle: (productId: string) => Promise<boolean>; // returns new isFavorite
  has: (productId: string) => boolean;
  clear: () => void;
}

export const useWishlistStore = create<WishlistStore>((set, get) => ({
  ids: new Set<string>(),
  loading: false,
  load: async () => {
    set({ loading: true });
    try {
      const { items } = await api.get<{ items: Array<{ _id: string }> }>("/wishlist");
      set({ ids: new Set(items.map(i => i._id)), loading: false });
    } catch {
      set({ loading: false });
    }
  },
  toggle: async (productId) => {
    const has = get().ids.has(productId);
    try {
      if (has) {
        await api.delete(`/wishlist/${productId}`);
        const next = new Set(get().ids);
        next.delete(productId);
        set({ ids: next });
        return false;
      } else {
        await api.post("/wishlist", { productId });
        const next = new Set(get().ids);
        next.add(productId);
        set({ ids: next });
        return true;
      }
    } catch {
      return has;
    }
  },
  has: (id) => get().ids.has(id),
  clear: () => set({ ids: new Set() }),
}));
