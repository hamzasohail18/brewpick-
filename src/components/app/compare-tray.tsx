"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Columns3, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MAX_COMPARE } from "@/lib/compare/params";
import { clearTray, trayHref, useTray } from "@/lib/compare/tray";
import { cn } from "@/lib/utils";

/** Floating bar above the bottom nav while there are picks to compare. */
export function CompareTray() {
  const tray = useTray();
  const pathname = usePathname();
  if (tray.length === 0 || pathname.startsWith("/compare")) return null;
  const ready = tray.length >= 2;
  return (
    <div
      data-compare-tray
      className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-40 px-3 pb-2"
      role="region"
      aria-label="Compare picks"
    >
      <div className="mx-auto flex max-w-lg items-center gap-2 rounded-xl border bg-card p-2 shadow-lg">
        <p className="min-w-0 flex-1 truncate ps-1 text-sm" aria-live="polite">
          <span className="font-semibold">
            {tray.length}/{MAX_COMPARE}
          </span>{" "}
          {ready ? "picked: " : "picked, add one more: "}
          <span className="text-muted-foreground">{tray.map((e) => e.label).join(", ")}</span>
        </p>
        <Button variant="ghost" size="icon" className="size-11 shrink-0" onClick={clearTray} aria-label="Clear compare picks">
          <X aria-hidden />
        </Button>
        <Button asChild className={cn("h-11 shrink-0", !ready && "pointer-events-none opacity-50")} aria-disabled={!ready}>
          <Link href={trayHref(tray)} tabIndex={ready ? undefined : -1}>
            <Columns3 aria-hidden />
            Compare
          </Link>
        </Button>
      </div>
    </div>
  );
}
