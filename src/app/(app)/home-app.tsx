"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ChevronRight, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CardsButton } from "@/components/app/cards-sheet";
import { DealCard } from "@/components/app/deal-card";
import { LocationSheet, originLabel, type AreaOption } from "@/components/app/location-sheet";
import { getT } from "@/lib/i18n";
import { useCards } from "@/lib/deals/cards";
import { dealStatus, lahoreNow } from "@/lib/deals/engine";
import type { DealView } from "@/lib/deals/repo";
import { openStatus } from "@/lib/explore/hours";
import { useNow, useOrigin } from "@/lib/explore/origin";
import type { PlaceSummary } from "@/lib/explore/repo";
import { distanceM } from "@/lib/explore/travel";
import { BUDGETS, quizHref } from "@/lib/scoring/quiz";
import { useUsualBudget } from "@/lib/profile/client";
import { cn } from "@/lib/utils";
import { PlaceCard } from "./explore/place-card";

export function HomeApp({ places, deals, areas }: { places: PlaceSummary[]; deals: DealView[]; areas: AreaOption[] }) {
  const t = getT();
  const originState = useOrigin();
  const { origin } = originState;
  const now = useNow();
  const cards = useCards();
  const [locationOpen, setLocationOpen] = useState(false);
  const usualBudget = useUsualBudget();

  // Nearby top 3: the closest places open now (top rated when we don't know where you are).
  const nearby = useMemo(() => {
    const rows = places.map((p) => ({
      p,
      d: origin ? distanceM(origin, p) : null,
      open: now ? openStatus(p.hours, now) : null,
    }));
    return rows
      .filter((r) => !r.open || r.open.state !== "closed")
      .sort((a, b) => (origin ? a.d! - b.d! : (b.p.rating ?? 0) - (a.p.rating ?? 0)))
      .slice(0, 3);
  }, [places, origin, now]);

  // Today's best deals: ones you can use and that are on today, ending soonest first.
  const todays = useMemo(() => {
    if (!now) return deals.slice(0, 3);
    const ln = lahoreNow(now);
    return deals
      .map((d) => ({ d, s: dealStatus(d, cards, ln) }))
      .filter((x) => x.s.usable && x.s.today)
      .sort((a, b) => Number(b.s.onNow) - Number(a.s.onNow) || a.d.validTo.localeCompare(b.d.validTo))
      .slice(0, 3)
      .map((x) => x.d);
  }, [deals, cards, now]);

  return (
    <main id="main" className="mx-auto max-w-2xl space-y-8 px-4 pt-6 pb-8">
      <header className="flex items-center justify-between gap-3">
        <p className="text-lg font-semibold">{t("app.name")}</p>
        <Button variant="outline" className="h-11 max-w-[55%] rounded-full" onClick={() => setLocationOpen(true)}>
          <MapPin aria-hidden className={origin ? "text-primary" : "text-muted-foreground"} />
          <span className="truncate">{originLabel(originState)}</span>
        </Button>
      </header>

      {/* The first quiz question lives right here, so a recommendation is 4 taps from opening the app. */}
      <section aria-labelledby="hero" className="space-y-4 rounded-3xl bg-primary p-5 text-primary-foreground">
        <div className="space-y-1">
          <h1 id="hero" className="text-2xl leading-tight font-semibold">
            What should I drink?
          </h1>
          <p className="text-sm text-primary-foreground/85">Four taps. We weigh price after your deals, distance and calories.</p>
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">First, your budget:</legend>
          <ul className="grid grid-cols-2 gap-2">
            {BUDGETS.map((b) => (
              <li key={b.value}>
                <Link
                  href={quizHref({ budgetMax: b.value === "any" ? null : Number(b.value) })}
                  className={cn(
                    "flex min-h-14 flex-col items-center justify-center rounded-xl bg-background px-3 text-center text-base font-semibold text-foreground transition-colors hover:bg-background/90 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
                    usualBudget !== null && String(usualBudget) === b.value && "ring-4 ring-background/50",
                  )}
                >
                  {b.label}
                  {usualBudget !== null && String(usualBudget) === b.value && <span className="text-xs font-normal text-muted-foreground">Your usual</span>}
                </Link>
              </li>
            ))}
          </ul>
        </fieldset>
      </section>

      <section aria-labelledby="nearby" className="space-y-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 id="nearby" className="text-lg font-semibold">
            {origin ? "Open near you" : "Top rated, open now"}
          </h2>
          <Link href="/explore" className="inline-flex min-h-11 items-center gap-0.5 text-sm text-primary">
            See all <ChevronRight aria-hidden className="size-4" />
          </Link>
        </div>
        {!origin && (
          <p className="text-sm text-muted-foreground">
            <button type="button" onClick={() => setLocationOpen(true)} className="min-h-11 underline underline-offset-2">
              Set your location
            </button>{" "}
            to see what&apos;s closest.
          </p>
        )}
        {nearby.length === 0 ? (
          <p className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">Nothing open right now.</p>
        ) : (
          <ul className="space-y-3">
            {nearby.map((r) => (
              <li key={r.p.id}>
                <PlaceCard
                  place={r.p}
                  pick={r.p.cheapest}
                  distanceM={r.d}
                  distanceFrom={origin ? (origin.kind === "gps" ? "you" : origin.name) : null}
                  open={r.open}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="todays-deals" className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 id="todays-deals" className="text-lg font-semibold">
            Today&apos;s best deals
          </h2>
          <CardsButton compact />
        </div>
        {todays.length === 0 ? (
          <p className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">
            {cards.length ? "No deals for your cards today." : "No open deals today. Add your cards to see bank and app offers."}
          </p>
        ) : (
          <ul className="space-y-3">
            {todays.map((d) => (
              <li key={d.id}>
                <DealCard deal={d} showPlaces nearestM={origin ? Math.min(...d.places.map((p) => distanceM(origin, p))) : null} />
              </li>
            ))}
          </ul>
        )}
        <Link href="/deals" className="inline-flex min-h-11 items-center gap-0.5 text-sm text-primary">
          All deals <ChevronRight aria-hidden className="size-4" />
        </Link>
      </section>

      <LocationSheet open={locationOpen} onOpenChange={setLocationOpen} areas={areas} />
    </main>
  );
}
