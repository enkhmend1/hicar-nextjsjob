"use client";
import { create } from "zustand";
import { tierUnitPrice } from "@/app/lib/price";
import { persist } from "zustand/middleware";
import { CartItem, Product, User } from "@/app/types";
import { deliveryPriceFor } from "@/app/lib/delivery";
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
  addItem: (product: Product, dt?: CartItem["deliveryType"], qty?: number) => void;
  removeItem: (id: string) => void;
  updateQty: (id: string, qty: number) => void;
  updateDelivery: (id: string, dt: CartItem["deliveryType"]) => void;
  clearCart: () => void;
  total: () => number;
  count: () => number;
}
/**
 * B2B line rules: quantity must be >= moq AND a multiple of orderMultiple
 * (parts sold in pairs/packs). `dir` rounds toward the caller's intent so
 * the ±1 steppers in the cart still move whole packs (4 −1 → 2, 4 +1 → 6).
 * Defaults (moq=1, multiple=1) make this an identity for normal products,
 * including old persisted cart snapshots that predate the fields.
 */
const snapQty = (p: Product, q: number, dir: 1 | -1 | 0 = 0) => {
  const mu = Math.max(1, p.orderMultiple ?? 1);
  const mq = Math.max(1, p.moq ?? 1);
  const min = Math.ceil(mq / mu) * mu;
  const rounded =
    dir > 0 ? Math.ceil(q / mu) * mu
    : dir < 0 ? Math.floor(q / mu) * mu
    : Math.round(q / mu) * mu;
  return Math.max(min, rounded);
};

export const useCartStore = create<CartStore>()(
  persist((set, get) => ({
    items: [],
    _hasHydrated: false,
    addItem: (product, dt = "normal", qty = 1) =>
      set(s => {
        const k = pid(product);
        const ex = s.items.find(i => pid(i.product) === k);
        const safeQty = snapQty(product, Math.max(1, Math.floor(qty)), 1);
        // Phase AS: respect explicit quantity. If item already in cart,
        // INCREMENT by safeQty (matches user mental model: "Add 3" = add 3
        // more, not "set to 3").
        if (ex) return { items: s.items.map(i => pid(i.product) === k ? { ...i, quantity: i.quantity + safeQty } : i) };
        return { items: [...s.items, { product, quantity: safeQty, deliveryType: dt }] };
      }),
    removeItem: id => set(s => ({ items: s.items.filter(i => pid(i.product) !== id) })),
    updateQty: (id, qty) =>
      set(s => ({
        items: qty <= 0
          ? s.items.filter(i => pid(i.product) !== id)
          : s.items.map(i => {
              if (pid(i.product) !== id) return i;
              // Round toward the requested direction so pack-multiple
              // products step in whole packs and never go below their MOQ.
              const dir = qty > i.quantity ? 1 : qty < i.quantity ? -1 : 0;
              return { ...i, quantity: snapQty(i.product, qty, dir) };
            }),
      })),
    updateDelivery: (id, dt) =>
      set(s => ({ items: s.items.map(i => pid(i.product) === id ? { ...i, deliveryType: dt } : i) })),
    clearCart: () => set({ items: [] }),
    // Delivery fee resolves from each item's seller config (Phase AV) — the
    // server re-derives the authoritative total at checkout regardless.
    // Price is coerced with ?? 0 so a corrupt/null product.price never
    // produces NaN that propagates through all display totals.
    total: () => get().items.reduce((s, i) => s + tierUnitPrice(i.product, i.quantity) * i.quantity + deliveryPriceFor(i.product.seller, i.deliveryType), 0),
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
  /** Motor model code from Garage.mn — "2GR-FSE", "4A-FE", "K20A".
   *  This is what mechanics + parts catalogues use as the engine identifier. */
  engineCode?: string;
  /** Fuel/motor type — "gasoline" / "diesel" / "hybrid" / "ev".
   *  NOT a substitute for engineCode — different concept. */
  engineType?: string;
  /** Engine displacement string — "2500cc" / "1.8L". Used for display. */
  displacement?: string;
  /** Raw Mongolian carname snapshot — "TOYOTA CROWN 2.5 HYBRID". */
  carname?: string;
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
  /** Drop a single recent vehicle (user removed it from the Navbar dropdown). */
  removeRecentVehicle: (id: string) => void;
  /** Drop ALL recents — used by "Clear history" affordance. */
  clearRecentVehicles: () => void;
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
    removeRecentVehicle: (id) => {
      const next = get().recentVehicles.filter((x) => x.id !== id);
      // If the removed one was ALSO the active vehicle, clear it too —
      // otherwise the Navbar badge would point at a vehicle the user
      // just told us to forget.
      const wasActive = get().activeVehicle?.id === id;
      set({
        recentVehicles: next,
        ...(wasActive ? { activeVehicle: null } : {}),
      });
    },
    clearRecentVehicles: () => set({ recentVehicles: [] }),
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
