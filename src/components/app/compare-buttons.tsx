"use client";

import { useState } from "react";
import { Check, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { MAX_COMPARE } from "@/lib/compare/params";
import { toggleTray, useTray, type TrayEntry } from "@/lib/compare/tray";

const keyOf = (e: TrayEntry) => (e.kind === "size" ? `size:${e.id}` : `place:${e.slug}`);

function useToggle() {
  const tray = useTray();
  const [full, setFull] = useState(false);
  const has = (e: TrayEntry) => tray.some((x) => keyOf(x) === keyOf(e));
  const toggle = (e: TrayEntry) => setFull(!toggleTray(e));
  return { has, toggle, full };
}

/** "Compare" toggle on a place card (compares the same drink across places). */
export function ComparePlaceToggle({ slug, label }: { slug: string; label: string }) {
  const { has, toggle, full } = useToggle();
  const entry: TrayEntry = { kind: "place", slug, label };
  const on = has(entry);
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => toggle(entry)}
      className={cn(
        "relative z-10 inline-flex min-h-11 items-center gap-1 rounded-full border px-3 text-xs font-medium",
        on ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-accent",
      )}
    >
      {on ? <Check aria-hidden className="size-3.5" /> : <Plus aria-hidden className="size-3.5" />}
      Compare
      <span className="sr-only"> {label}</span>
      {full && !on && <span role="status" className="sr-only">Compare is full ({MAX_COMPARE} max)</span>}
    </button>
  );
}

/** Per-size compare chips under a menu item: "Compare: + Regular  + Large". */
export function CompareSizeButtons({ sizes, drinkName, placeName }: { sizes: { id: string; label: string }[]; drinkName: string; placeName: string }) {
  const { has, toggle, full } = useToggle();
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="font-medium">Compare:</span>
      {sizes.map((s) => {
        const entry: TrayEntry = { kind: "size", id: s.id, label: `${drinkName} ${s.label}, ${placeName}` };
        const on = has(entry);
        return (
          <button
            key={s.id}
            type="button"
            aria-pressed={on}
            aria-label={`Compare ${drinkName}, ${s.label}`}
            onClick={() => toggle(entry)}
            className={cn(
              "inline-flex min-h-11 items-center gap-1 rounded-full border px-3 font-medium",
              on ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-accent",
            )}
          >
            {on ? <Check aria-hidden className="size-3.5" /> : <Plus aria-hidden className="size-3.5" />}
            {s.label}
          </button>
        );
      })}
      {full && (
        <span role="status" className="text-destructive">
          You can compare up to {MAX_COMPARE}. Remove one first.
        </span>
      )}
    </div>
  );
}
