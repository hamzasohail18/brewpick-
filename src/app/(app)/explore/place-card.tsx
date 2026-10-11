import Link from "next/link";
import { Star, Tag } from "lucide-react";
import { cn } from "@/lib/utils";
import { ConfidenceBadge, SampleBadge, Tone } from "@/components/app/badges";
import { ComparePlaceToggle } from "@/components/app/compare-buttons";
import { formatDistance } from "@/lib/capture/geo";
import { CHANNEL_LABELS, formatPkr } from "@/lib/explore/format";
import { PLACE_TYPE_LABELS } from "@/lib/explore/filters";
import { describeOpenStatus, type OpenStatus } from "@/lib/explore/hours";
import type { DrinkPick, PlaceSummary } from "@/lib/explore/repo";
import { formatTravel, travelEstimate } from "@/lib/explore/travel";

export interface PlaceCardProps {
  place: PlaceSummary;
  pick: DrinkPick | null;
  distanceM: number | null;
  /** Where the distance is from: "you" (GPS) or an area name. */
  distanceFrom: string | null;
  open: OpenStatus | null;
  className?: string;
}

/** Result card: effective price, distance and calories up front (Section 4). */
export function PlaceCard({ place, pick, distanceM, distanceFrom, open, className }: PlaceCardProps) {
  const status = open ? describeOpenStatus(open) : null;
  return (
    <article className={cn("relative rounded-xl border bg-card p-4 shadow-xs transition-colors hover:border-primary/40", className)}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold leading-snug">
            <Link href={`/places/${place.slug}`} className="after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none">
              {place.name}
              {place.branchName && <span className="font-normal text-muted-foreground"> · {place.branchName}</span>}
            </Link>
          </h3>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
            <span>{PLACE_TYPE_LABELS[place.type as keyof typeof PLACE_TYPE_LABELS] ?? place.type}</span>
            {place.areaName && <span>· {place.areaName}</span>}
            {place.rating !== null && (
              <span className="inline-flex items-center gap-0.5">
                · <Star aria-hidden className="size-3 fill-current text-warning" />
                <span className="sr-only">Rating</span>
                {place.rating.toFixed(1)}
                <span className="opacity-80">({place.ratingCount})</span>
              </span>
            )}
          </p>
        </div>
        {place.isSample && <SampleBadge className="shrink-0" />}
      </div>

      <dl className="mt-3 grid grid-cols-3 gap-2 rounded-lg bg-muted/60 p-2.5 text-center">
        <div className="min-w-0">
          <dt className="text-[11px] text-muted-foreground">Price</dt>
          <dd className="text-base font-semibold tabular-nums">{pick ? formatPkr(pick.pricePkr) : "—"}</dd>
          <dd className="truncate text-[11px] text-muted-foreground">
            {pick ? `${pick.name} · ${pick.size}${pick.channel !== "dine_in" ? ` · ${CHANNEL_LABELS[pick.channel]}` : ""}` : place.hasMenu ? "No match" : "No prices yet"}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[11px] text-muted-foreground">Distance</dt>
          <dd className="text-base font-semibold tabular-nums">{distanceM !== null ? formatDistance(distanceM) : "—"}</dd>
          <dd className="truncate text-[11px] text-muted-foreground">
            {distanceM !== null ? (distanceFrom === "you" ? `~${formatTravel(travelEstimate(distanceM))}` : `from ${distanceFrom}`) : "Set location"}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[11px] text-muted-foreground">Calories</dt>
          <dd className="text-base font-semibold tabular-nums">{pick?.kcal !== null && pick?.kcal !== undefined ? `${pick.kcal} kcal` : "—"}</dd>
          <dd className="truncate text-[11px] text-muted-foreground">
            {pick?.kcal !== null && pick?.kcal !== undefined ? (pick.nutritionConfidence === "estimated" ? "Estimated" : "Per serving") : pick ? "Not known" : ""}
          </dd>
        </div>
      </dl>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {status ? <Tone tone={status.tone}>{status.label}</Tone> : <span className="h-4 w-24 animate-pulse rounded bg-muted" />}
        {place.dealCount > 0 && (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
            <Tag aria-hidden className="size-3" />
            {place.dealCount} {place.dealCount === 1 ? "deal" : "deals"}
          </span>
        )}
        <span className="ms-auto flex flex-wrap items-center justify-end gap-2">
          {place.hasMenu && <ComparePlaceToggle slug={place.slug} label={place.branchName ? `${place.name} ${place.branchName}` : place.name} />}
          {pick ? (
            <ConfidenceBadge level={pick.priceConfidence} checkedAt={pick.priceVerifiedAt} />
          ) : (
            place.sourceName && <span className="text-[11px] text-muted-foreground">Listed from {place.sourceName}</span>
          )}
        </span>
      </div>
    </article>
  );
}

export function PlaceCardSkeleton() {
  return (
    <div className="rounded-xl border bg-card p-4" aria-hidden>
      <div className="h-5 w-2/3 animate-pulse rounded bg-muted" />
      <div className="mt-2 h-3 w-1/3 animate-pulse rounded bg-muted" />
      <div className="mt-3 h-16 animate-pulse rounded-lg bg-muted" />
      <div className="mt-3 h-4 w-1/2 animate-pulse rounded bg-muted" />
    </div>
  );
}
