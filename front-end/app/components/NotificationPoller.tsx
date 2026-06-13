"use client";

/**
 * NotificationPoller — mounted ONCE in the root layout so notifications work
 * on every surface (buyer/seller/admin, mobile + desktop) regardless of which
 * layout is active. Renders nothing.
 *
 * Polls every 25s while signed in, and also refreshes the moment the tab
 * regains focus (so a reply that arrived while the user was away shows up
 * immediately on return). Clears + resets the store on logout.
 */

import { useEffect } from "react";
import { useAuthStore } from "@/store";
import { useNotifications } from "@/app/lib/notifications";

const POLL_MS = 25_000;

export default function NotificationPoller() {
  const user = useAuthStore((s) => s.user);
  const hydrated = useAuthStore((s) => s._hasHydrated);

  useEffect(() => {
    if (!hydrated) return;
    if (!user) { useNotifications.getState().reset(); return; }

    const load = () => useNotifications.getState().load();
    load();
    const timer = setInterval(load, POLL_MS);
    const onFocus = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("focus", onFocus);
    };
  }, [user, hydrated]);

  return null;
}
