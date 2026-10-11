"use client";

import { useMemo, useState } from "react";
import { Chip } from "@/components/app/chip";
import { CardsButton } from "@/components/app/cards-sheet";
import { DealCard } from "@/components/app/deal-card";
import { nativeSelect } from "@/components/admin/native-select";
import { cn } from "@/lib/utils";
import { getT } from "@/lib/i18n";
import { useCards } from "@/lib/deals/cards";
import { dealStatus, lahoreNow } from "@/lib/deals/engine";
import type { DealView } from "@/lib/deals/repo";
import { DEAL_TYPE_LABELS } from "@/lib/explore/format";
import { useNow, useOrigin } from "@/lib/explore/origin";
import { distanceM } from "@/lib/explore/travel";

type Sort = "ending" | "nearest";

/** All live deals (expired ones never reach the page), filtered and sorted on the phone. */
export function DealsApp({ deals }: { deals: DealView[] }) {
  const t = getT();
  const cards = useCards();
  const nowDate = useNow();
  const { origin } = useOrigin();
  const [type, setType] = useState<string | null>(null);
  const [usableOnly, setUsableOnly] = useState(false);
  const [onNow, setOnNow] = useState(false);
  const [sortChoice, setSort] = useState<Sort>("ending");
  const sort: Sort = sortChoice === "nearest" && !origin ? "ending" : sortChoice;

  const types = useMemo(() => [...new Set(deals.map((d) => d.dealType))], [deals]);

  const rows = useMemo(() => {
    const now = nowDate ? lahoreNow(nowDate) : null;
    return deals
      .map((d) => ({
        d,
        status: now ? dealStatus(d, cards, now) : null,
        nearest: origin ? Math.min(...d.places.map((p) => distanceM(origin, p))) : null,
      }))
      .filter(
        (r) =>
          (!type || r.d.dealType === type) &&
          (!usableOnly || !r.status || r.status.usable) &&
          (!onNow || !r.status || r.status.onNow),
      )
      .sort((a, b) =>
        sort === "nearest"
          ? (a.nearest ?? 0) - (b.nearest ?? 0)
          : a.d.validTo.localeCompare(b.d.validTo) || a.d.title.localeCompare(b.d.title),
      );
  }, [deals, cards, nowDate, origin, type, usableOnly, onNow, sort]);

  const usableCount = nowDate ? deals.filter((d) => dealStatus(d, cards, lahoreNow(nowDate)).usable).length : null;

  return (
    <main className="mx-auto max-w-2xl">
      <div className="sticky top-0 z-30 space-y-3 border-b bg-background/95 px-4 pt-4 pb-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">{t("nav.deals")}</h1>
          <CardsButton />
        </div>
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {deals.length} live {deals.length === 1 ? "deal" : "deals"}
          {usableCount !== null && ` · ${usableCount} you can use`}
          {cards.length === 0 && " · add your cards to see which"}
        </p>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none]" role="group" aria-label="Deal filters">
          <Chip pressed={usableOnly} onClick={() => setUsableOnly(!usableOnly)}>
            I can use
          </Chip>
          <Chip pressed={onNow} onClick={() => setOnNow(!onNow)}>
            On now
          </Chip>
          {types.map((ty) => (
            <Chip key={ty} pressed={type === ty} onClick={() => setType(type === ty ? null : ty)}>
              {DEAL_TYPE_LABELS[ty] ?? ty}
            </Chip>
          ))}
        </div>
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            {rows.length} {rows.length === 1 ? "deal" : "deals"} shown
          </p>
          <label className="flex items-center gap-2 text-sm">
            <span className="sr-only">Sort</span>
            <select className={cn(nativeSelect, "h-10 w-auto")} value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              <option value="ending">Ending soonest</option>
              <option value="nearest" disabled={!origin}>
                Nearest{origin ? "" : " (set location on Explore)"}
              </option>
            </select>
          </label>
        </div>
      </div>

      <div className="px-4 py-4">
        {rows.length === 0 ? (
          <div className="rounded-xl border border-dashed p-8 text-center">
            <p className="font-medium">No deals match.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {usableOnly && cards.length === 0 ? "You haven't added any cards yet." : "Try removing a filter."}
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {rows.map((r) => (
              <li key={r.d.id}>
                <DealCard deal={r.d} showPlaces nearestM={r.nearest} />
              </li>
            ))}
          </ul>
        )}
        <p className="mt-6 text-xs text-muted-foreground">
          Expired deals disappear automatically. Bank and app offers change often. Check the terms with the cafe or your bank before
          you pay.
        </p>
      </div>
    </main>
  );
}
