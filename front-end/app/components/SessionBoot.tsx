"use client";
import { useEffect } from "react";
import { useAuthStore } from "@/store";
import { useWishlistStore } from "@/store/wishlist";
import { api } from "@/lib/api";

/**
 * Runs once on app load:
 *  - If we have a persisted access token, try to refresh it from the httpOnly cookie
 *    so the session survives token expiry & restarts.
 *  - Loads wishlist into memory once user is known.
 */
export default function SessionBoot() {
  const { user, _hasHydrated, setSession } = useAuthStore();

  // Refresh the session on boot
  useEffect(() => {
    if (!_hasHydrated) return;
    if (!user) return;
    // We have persisted user but maybe access token expired — try refresh
    api.refresh().then((newToken) => {
      if (newToken) {
        // user object stays, only token updated (already done by api.refresh via setToken)
        // Sync to store so subsequent persists are correct
        setSession(user, newToken);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [_hasHydrated]);

  // Sync wishlist with user state. Access store via getState() so we don't
  // subscribe to function identity — Zustand selectors via `useWishlistStore(s => s.fn)`
  // produce stable references when using create() directly, but reading via
  // getState() is the explicit, safe pattern for effects that don't need reactivity.
  useEffect(() => {
    if (!_hasHydrated) return;
    const { load, clear } = useWishlistStore.getState();
    if (user) load();
    else clear();
  }, [user, _hasHydrated]);

  return null;
}
