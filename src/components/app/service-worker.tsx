"use client";

import { useEffect, useSyncExternalStore } from "react";

/**
 * Registers /sw.js (production builds only: the dev server's hot reload and a caching worker fight).
 * Set NEXT_PUBLIC_SW_IN_DEV=1 to try it under `next dev`.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_SW_IN_DEV !== "1") return;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then(() => navigator.serviceWorker.ready)
      .then((reg) => {
        // Hand over what this first page loaded before the worker took control.
        const urls = [
          location.href,
          ...performance
            .getEntriesByType("resource")
            .map((e) => e.name)
            .filter((u) => u.startsWith(`${location.origin}/_next/static/`)),
        ];
        reg.active?.postMessage({ type: "CACHE_URLS", urls });
      })
      .catch(() => {
        /* unsupported or blocked (private mode): the app still works online */
      });
  }, []);
  return null;
}

const subscribe = (cb: () => void) => {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
};

export const useOnline = () => useSyncExternalStore(subscribe, () => navigator.onLine, () => true);

export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div role="status" className="sticky top-0 z-30 bg-foreground px-4 py-2 text-center text-sm text-background">
      You&rsquo;re offline. Showing saved copies; prices and opening times may have changed.
    </div>
  );
}
