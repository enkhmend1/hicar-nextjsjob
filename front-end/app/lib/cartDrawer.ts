"use client";

/**
 * Cart drawer state — Phase Y.
 *
 * Tiny Zustand slice that only tracks open/closed for the slide-out
 * <CartDrawer />. Kept separate from useCartStore so opening the
 * drawer doesn't accidentally re-render every Cart-aware component on
 * the page (only Navbar's cart-icon button + the drawer itself
 * subscribe).
 *
 * Usage:
 *   import { useCartDrawer } from "@/app/lib/cartDrawer";
 *   const open = useCartDrawer((s) => s.open);
 *   const set  = useCartDrawer((s) => s.set);
 *
 *   set(true);   // open after add-to-cart
 *   set(false);  // close
 *
 * Or call the shortcut helpers exported below.
 */

import { create } from "zustand";

interface CartDrawerStore {
  open: boolean;
  set: (open: boolean) => void;
  toggle: () => void;
}

export const useCartDrawer = create<CartDrawerStore>((set) => ({
  open: false,
  set:    (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
}));

export const openCartDrawer  = () => useCartDrawer.getState().set(true);
export const closeCartDrawer = () => useCartDrawer.getState().set(false);
