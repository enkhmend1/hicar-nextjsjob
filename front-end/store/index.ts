"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { CartItem, Product, User } from "@/app/types";
import { DELIVERY_PRICE } from "@/lib/data";
import { setToken, onAuthExpired, api } from "@/lib/api";

const pid = (p: Product) => (p._id ?? p.id) as string;

/* ── Cart ─────────────────────────────────────────────────────── */
interface CartStore {
  items: CartItem[];
  addItem: (product: Product, dt?: CartItem["deliveryType"]) => void;
  removeItem: (id: string) => void;
  updateQty: (id: string, qty: number) => void;
  updateDelivery: (id: string, dt: CartItem["deliveryType"]) => void;
  clearCart: () => void;
  total: () => number;
  count: () => number;
}
export const useCartStore = create<CartStore>()(
  persist((set, get) => ({
    items: [],
    addItem: (product, dt = "normal") =>
      set(s => {
        const k = pid(product);
        const ex = s.items.find(i => pid(i.product) === k);
        if (ex) return { items: s.items.map(i => pid(i.product) === k ? { ...i, quantity: i.quantity + 1 } : i) };
        return { items: [...s.items, { product, quantity: 1, deliveryType: dt }] };
      }),
    removeItem: id => set(s => ({ items: s.items.filter(i => pid(i.product) !== id) })),
    updateQty: (id, qty) =>
      set(s => ({ items: qty <= 0 ? s.items.filter(i => pid(i.product) !== id) : s.items.map(i => pid(i.product) === id ? { ...i, quantity: qty } : i) })),
    updateDelivery: (id, dt) =>
      set(s => ({ items: s.items.map(i => pid(i.product) === id ? { ...i, deliveryType: dt } : i) })),
    clearCart: () => set({ items: [] }),
    total: () => get().items.reduce((s, i) => s + i.product.price * i.quantity + DELIVERY_PRICE[i.deliveryType], 0),
    count: () => get().items.reduce((s, i) => s + i.quantity, 0),
  }), { name: "hicar-cart" })
);

/* ── Auth ─────────────────────────────────────────────────────── */
interface AuthStore {
  user: User | null;
  token: string | null;
  _hasHydrated: boolean;
  setSession: (user: User, token: string) => void;
  setUser: (user: User) => void;
  logout: () => void;
}
export const useAuthStore = create<AuthStore>()(
  persist((set) => ({
    user: null,
    token: null,
    _hasHydrated: false,
    setSession: (user, token) => { setToken(token); set({ user, token }); },
    setUser: user => set({ user }),
    logout: () => {
      api.logout().catch(() => {}); // fire-and-forget — clears refresh cookie server-side
      set({ user: null, token: null });
    },
  }), {
    name: "hicar-auth",
    partialize: (s) => ({ user: s.user, token: s.token }),
    onRehydrateStorage: () => (state) => {
      if (state?.token) setToken(state.token);
      queueMicrotask(() => useAuthStore.setState({ _hasHydrated: true }));
    },
  })
);

// Wire api → store so that a 401 on any request resets the session
if (typeof window !== "undefined") {
  onAuthExpired(() => {
    useAuthStore.setState({ user: null, token: null });
    // Clear cross-feature in-memory state that depends on session
    import("./wishlist").then(m => m.useWishlistStore.getState().clear());
  });
  // Lazy-load wishlist whenever user transitions from null → non-null
  useAuthStore.subscribe((state, prev) => {
    if (state.user && !prev.user) {
      import("./wishlist").then(m => m.useWishlistStore.getState().load());
    } else if (!state.user && prev.user) {
      import("./wishlist").then(m => m.useWishlistStore.getState().clear());
    }
  });
}

/* ── Car / Active vehicle context ─────────────────────────────────
 * Anything that needs to scope a search/chat to "the vehicle the user is
 * currently looking at" reads from this store. /lookup page sets it after
 * a successful plate identification; AIChatWidget reads it to switch from
 * generic chat → vehicle-aware /search/smart.
 */
export interface ActiveVehicle {
  id: string;                   // backend Vehicle._id
  plate: string;
  manufacturer: string;
  model: string;
  generation?: string;
  engineCode?: string;
  engineType?: string;
}

interface CarStore {
  selectedCar: import("@/app/types").Car | null;   // legacy display obj
  activeVehicle: ActiveVehicle | null;             // canonical id-based context
  setCar: (car: import("@/app/types").Car | null) => void;
  setActiveVehicle: (v: ActiveVehicle | null) => void;
}
export const useCarStore = create<CarStore>()(
  persist((set) => ({
    selectedCar: null,
    activeVehicle: null,
    setCar: (car) => set({ selectedCar: car }),
    setActiveVehicle: (v) => set({ activeVehicle: v }),
  }), { name: "hicar-car" })
);
