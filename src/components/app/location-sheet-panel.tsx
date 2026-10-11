"use client";

// The location sheet itself, loaded the first time someone opens it (see LocationSheet in location-sheet.tsx).

import { LocateFixed, MapPin, ShieldCheck } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/app/chip";
import { getT } from "@/lib/i18n";
import { chooseArea, clearOrigin, locate, useOrigin, type OriginState } from "@/lib/explore/origin";
import type { AreaOption } from "./location-sheet";

const STATUS_TEXT: Partial<Record<OriginState["status"], string>> = {
  locating: "Finding you…",
  denied: "Location permission is off. Allow it in your browser settings, or pick an area.",
  unavailable: "Couldn't get a location fix. Try again, or pick an area.",
  insecure: "Your browser only shares location over a secure (https) connection. Pick an area instead.",
};

/** GPS with a manual area-picker fallback (Section 3A). */
export function LocationSheet({ open, onOpenChange, areas }: { open: boolean; onOpenChange: (o: boolean) => void; areas: AreaOption[] }) {
  const t = getT();
  const state = useOrigin();
  const message = STATUS_TEXT[state.status];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" showCloseButton={false} className="mx-auto max-h-[88dvh] max-w-2xl gap-0 rounded-t-2xl p-0">
        <SheetHeader className="border-b">
          <SheetTitle>{t("explore.location.title")}</SheetTitle>
          <SheetDescription className="flex items-start gap-1.5">
            <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0" />
            {t("explore.location.private")}
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-5 overflow-y-auto p-4">
          <div className="space-y-2">
            <Button
              className="h-12 w-full text-base"
              onClick={() => {
                locate();
              }}
              disabled={state.status === "locating"}
            >
              <LocateFixed aria-hidden />
              {state.status === "locating" ? "Finding you…" : t("explore.location.useGps")}
            </Button>
            {state.origin?.kind === "gps" && state.status === "idle" && (
              <p className="text-sm text-success" role="status">
                Using your location (±{state.origin.accuracyM} m).
              </p>
            )}
            {message && state.status !== "locating" && (
              <p className="text-sm text-destructive" role="alert">
                {message}
              </p>
            )}
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t("explore.location.orArea")}</legend>
            <div className="flex flex-wrap gap-2">
              {areas
                .filter((a) => a.lat !== null && a.lng !== null)
                .map((a) => (
                  <Chip
                    key={a.id}
                    pressed={state.origin?.kind === "area" && state.origin.areaId === a.id}
                    onClick={() => {
                      chooseArea({ id: a.id, name: a.name, lat: a.lat!, lng: a.lng! });
                      onOpenChange(false);
                    }}
                  >
                    <MapPin aria-hidden className="size-3.5" />
                    {a.name}
                  </Chip>
                ))}
            </div>
            <p className="text-xs text-muted-foreground">Distances are then measured from the middle of that area.</p>
          </fieldset>
        </div>
        <SheetFooter className="flex-row border-t">
          {state.origin && (
            <Button variant="outline" className="h-11 flex-1" onClick={clearOrigin}>
              Forget location
            </Button>
          )}
          <Button className="h-11 flex-1" variant={state.origin ? "default" : "outline"} onClick={() => onOpenChange(false)}>
            {t("explore.done")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
