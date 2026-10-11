import { useState } from "react";

/**
 * True from the first time `open` is true. Lets a sheet's code load on first open and then stay
 * mounted, so its close animation still plays.
 */
export function useEverOpened(open: boolean): boolean {
  const [ever, setEver] = useState(open);
  if (open && !ever) setEver(true);
  return ever || open;
}

/**
 * Starts loading a lazily-loaded chunk on the first tap or key press anywhere, so it's ready (and in
 * the offline cache) before the sheet is opened, without costing anything during page load.
 */
export function preloadOnFirstInteraction(load: () => Promise<unknown>) {
  if (typeof window === "undefined") return;
  const events = ["pointerdown", "keydown", "touchstart"] as const;
  const go = () => {
    events.forEach((e) => window.removeEventListener(e, go, true));
    load().catch(() => {
      /* offline: it'll load when opened */
    });
  };
  events.forEach((e) => window.addEventListener(e, go, { capture: true, passive: true }));
}
