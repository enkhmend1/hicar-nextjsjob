"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { CartItem, Product, User, Order } from "@/app/types";
import { DELIVERY_PRICE } from "@/lib/data";

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
        const ex = s.items.find(i => i.product.id === product.id);
        if (ex) return { items: s.items.map(i => i.product.id === product.id ? { ...i, quantity: i.quantity + 1 } : i) };
        return { items: [...s.items, { product, quantity: 1, deliveryType: dt }] };
      }),
    removeItem: id => set(s => ({ items: s.items.filter(i => i.product.id !== id) })),
    updateQty: (id, qty) =>
      set(s => ({ items: qty <= 0 ? s.items.filter(i => i.product.id !== id) : s.items.map(i => i.product.id === id ? { ...i, quantity: qty } : i) })),
    updateDelivery: (id, dt) =>
      set(s => ({ items: s.items.map(i => i.product.id === id ? { ...i, deliveryType: dt } : i) })),
    clearCart: () => set({ items: [] }),
    total: () => get().items.reduce((s, i) => s + i.product.price * i.quantity + DELIVERY_PRICE[i.deliveryType], 0),
    count: () => get().items.reduce((s, i) => s + i.quantity, 0),
  }), { name: "hicar-cart" })
);

/* ── Auth ─────────────────────────────────────────────────────── */
interface AuthStore {
  user: User | null;
  login: (u: User) => void;
  logout: () => void;
  topUpWallet: (amount: number) => void;
  deductWallet: (amount: number) => void;
}
export const useAuthStore = create<AuthStore>()(
  persist((set) => ({
    user: null,
    login: user => set({ user }),
    logout: () => set({ user: null }),
    topUpWallet: amount => set(s => s.user ? { user: { ...s.user, walletBalance: s.user.walletBalance + amount } } : s),
    deductWallet: amount => set(s => s.user ? { user: { ...s.user, walletBalance: s.user.walletBalance - amount } } : s),
  }), { name: "hicar-auth" })
);

/* ── Orders ───────────────────────────────────────────────────── */
interface OrderStore {
  orders: Order[];
  addOrder: (order: Order) => void;
  updateStatus: (id: string, status: Order["status"]) => void;
}
export const useOrderStore = create<OrderStore>()(
  persist((set) => ({
    orders: [],
    addOrder: order => set(s => ({ orders: [order, ...s.orders] })),
    updateStatus: (id, status) => set(s => ({ orders: s.orders.map(o => o.id === id ? { ...o, status } : o) })),
  }), { name: "hicar-orders" })
);

/* ── Car ──────────────────────────────────────────────────────── */
interface CarStore {
  selectedCar: import("@/app/types").Car | null;
  setCar: (car: import("@/app/types").Car | null) => void;
}
export const useCarStore = create<CarStore>()(
  persist((set) => ({
    selectedCar: null,
    setCar: car => set({ selectedCar: car }),
  }), { name: "hicar-car" })
);
