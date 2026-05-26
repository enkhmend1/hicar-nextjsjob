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
  // Phase O.4: `_hasHydrated` lets SSR-aware components gate any UI
  // that depends on persisted cart contents (e.g. the navbar count
  // badge). Without it, server renders count=0 (empty store) and the
  // client renders count=N after rehydration → hydration mismatch.
  _hasHydrated: boolean;
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
    _hasHydrated: false,
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
  }), {
    name: "hicar-cart",
    // Only persist the items themselves — `_hasHydrated` is derived
    // state and must reset to false on every fresh mount so the gating
    // logic gives SSR a turn to render the empty-cart shell first.
    partialize: (s) => ({ items: s.items }),
    onRehydrateStorage: () => () => {
      queueMicrotask(() => useCartStore.setState({ _hasHydrated: true }));
    },
  })
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
  /**
   * Phase V.2: hydration flag (same Phase O.4 pattern as auth/cart
   * stores). Needed so the Navbar vehicle badge doesn't pop in from
   * nowhere after client rehydration → SSR mismatch warning.
   */
  _hasHydrated: boolean;
  /**
   * Phase G — last-N vehicles the user has interacted with (LRU,
   * move-to-front). Powers the chat header switcher dropdown so the
   * user can flip between "own car / family / work" in one click
   * instead of re-looking-up plates. Capped at 5 client-side; the
   * server-side aiMemory has the same cap.
   */
  recentVehicles: ActiveVehicle[];
  setCar: (car: import("@/app/types").Car | null) => void;
  setActiveVehicle: (v: ActiveVehicle | null) => void;
  /** Move-to-front + cap at 5. Called when a plate lookup succeeds. */
  pushRecentVehicle: (v: ActiveVehicle) => void;
  /** Used when /api/ai/memory hydrate returns the server's truth. */
  hydrateRecentVehicles: (list: ActiveVehicle[]) => void;
  clearActiveVehicle: () => void;
}

const VEHICLE_RECENT_CAP = 5;

export const useCarStore = create<CarStore>()(
  persist((set, get) => ({
    selectedCar: null,
    activeVehicle: null,
    _hasHydrated: false,
    recentVehicles: [],
    setCar: (car) => set({ selectedCar: car }),
    setActiveVehicle: (v) => {
      if (v) {
        // Setting an active vehicle is the same UX moment as "I just
        // used this car" — push it to the recents LRU automatically.
        const prev = get().recentVehicles.filter((x) => x.id !== v.id);
        set({
          activeVehicle: v,
          recentVehicles: [v, ...prev].slice(0, VEHICLE_RECENT_CAP),
        });
      } else {
        set({ activeVehicle: null });
      }
    },
    pushRecentVehicle: (v) => {
      const prev = get().recentVehicles.filter((x) => x.id !== v.id);
      set({ recentVehicles: [v, ...prev].slice(0, VEHICLE_RECENT_CAP) });
    },
    hydrateRecentVehicles: (list) => {
      // Trust the server snapshot but merge to preserve any locally-
      // added vehicle the user just picked but hasn't synced yet.
      const seen = new Set<string>();
      const merged: ActiveVehicle[] = [];
      for (const v of [...get().recentVehicles, ...list]) {
        if (!v?.id || seen.has(v.id)) continue;
        seen.add(v.id);
        merged.push(v);
        if (merged.length >= VEHICLE_RECENT_CAP) break;
      }
      set({ recentVehicles: merged });
    },
    clearActiveVehicle: () => set({ activeVehicle: null }),
  }), {
    name: "hicar-car",
    // Phase V.2: don't persist the hydration flag — it must reset to
    // false on every fresh mount so the gate fires.
    partialize: (s) => ({
      selectedCar:    s.selectedCar,
      activeVehicle:  s.activeVehicle,
      recentVehicles: s.recentVehicles,
    }),
    onRehydrateStorage: () => () => {
      queueMicrotask(() => useCarStore.setState({ _hasHydrated: true }));
    },
  })
);
