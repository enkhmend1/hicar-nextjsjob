"use client";

/**
 * useBackClose — wire an open overlay (camera, drawer, modal, mobile nav)
 * into browser history so the device / browser BACK button closes it instead
 * of navigating away from the page. This is the standard mobile-web pattern
 * used by Amazon / Facebook / Instagram:
 *
 *   • Opening an overlay pushes one throwaway history entry.
 *   • Pressing Back pops that entry → we fire `onClose` (overlay closes,
 *     the user stays on the page).
 *   • Closing the overlay yourself (X button, capture, route change) pops the
 *     same entry so the user's Back button is never left as a dead no-op.
 *
 * Usage:
 *   useBackClose(isOpen, onClose);
 *
 * Notes:
 *   • No-op on the server and while `open` is false.
 *   • `onClose` may change every render — we read it through a ref so the
 *     popstate listener is subscribed exactly once per open cycle.
 *   • If a navigation (router.push) happened while the overlay was open, the
 *     top history entry is no longer ours, so we DON'T call history.back()
 *     on cleanup — that would undo the navigation. The redundant same-URL
 *     entry left behind is harmless.
 */

import { useEffect, useRef } from "react";

const OVERLAY_MARK = "__hicarOverlay";

export function useBackClose(open: boolean, onClose: () => void) {
  // Always point at the latest onClose without re-running the effect.
  const cbRef = useRef(onClose);
  cbRef.current = onClose;
  // Did WE push the history entry that represents this open overlay?
  const pushedRef = useRef(false);

  useEffect(() => {
    if (!open || typeof window === "undefined") return;

    // Push a throwaway entry (same URL) meaning "an overlay is open".
    try {
      window.history.pushState({ [OVERLAY_MARK]: true }, "");
      pushedRef.current = true;
    } catch {
      // pushState can throw in rare sandboxed contexts — degrade silently.
      pushedRef.current = false;
    }

    const onPop = () => {
      // Back was pressed: the browser already popped our entry. Mark it gone
      // so cleanup doesn't try to pop it a second time, then close.
      pushedRef.current = false;
      cbRef.current();
    };
    window.addEventListener("popstate", onPop);

    return () => {
      window.removeEventListener("popstate", onPop);
      // Overlay closed by the app (not by Back). Remove the entry we added so
      // the Back button isn't a dead press — but ONLY if it's still on top
      // (a navigation may have stacked a new entry over it).
      const stateRec = window.history.state as Record<string, unknown> | null;
      if (pushedRef.current && stateRec?.[OVERLAY_MARK] === true) {
        pushedRef.current = false;
        window.history.back();
      }
    };
  }, [open]);
}
