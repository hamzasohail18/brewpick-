"use client";

import dynamic from "next/dynamic";
import { getT } from "@/lib/i18n";
import type { OriginState } from "@/lib/explore/origin";
import { preloadOnFirstInteraction, useEverOpened } from "./lazy";

export interface AreaOption {
  id: number;
  name: string;
  lat: number | null;
  lng: number | null;
}

/** Short label for the location button: "Near you", "Gulberg", or "Set location". */
export function originLabel(s: OriginState): string {
  const t = getT();
  if (s.origin?.kind === "gps") return t("explore.location.near");
  if (s.origin?.kind === "area") return s.origin.name;
  return t("explore.location.set");
}

// The sheet loads on first open, not with every page.
const loadLocationSheetPanel = () => import("./location-sheet-panel");
const LocationSheetPanel = dynamic(() => loadLocationSheetPanel().then((m) => m.LocationSheet), { ssr: false });
preloadOnFirstInteraction(loadLocationSheetPanel);

/** GPS with a manual area-picker fallback (Section 3A). */
export function LocationSheet(props: { open: boolean; onOpenChange: (o: boolean) => void; areas: AreaOption[] }) {
  return useEverOpened(props.open) ? <LocationSheetPanel {...props} /> : null;
}
