"use client";

import Link from "next/link";
import { Check, X } from "lucide-react";
import { ConfidenceBadge, SampleBadge } from "@/components/app/badges";
import { cn } from "@/lib/utils";
import { bestIndices, type Better } from "@/lib/compare/best";
import type { CompareColumn } from "@/lib/compare/repo";
import { formatDistance } from "@/lib/capture/geo";
import { CHANNEL_LABELS, checkedAgo, formatPkr } from "@/lib/explore/format";
import { ROAST_LABELS } from "@/lib/explore/filters";
import { describeOpenStatus, openStatus } from "@/lib/explore/hours";
import { useNow, useOrigin } from "@/lib/explore/origin";
import { distanceM, formatTravel, travelEstimate } from "@/lib/explore/travel";

interface Row {
  label: string;
  hint?: string;
  values: (number | null)[];
  better?: Better;
  bestLabel?: string;
  cell: (c: CompareColumn, i: number) => React.ReactNode;
}

/**
 * The comparison as a real table: drinks are columns (<th scope="col">), measures are rows
 * (<th scope="row">), so screen readers announce "Calories, Saffron Steam Coffee: 179". The best value
 * in a row is marked with an icon and hidden text, not colour alone.
 */
export function CompareTable({ columns, removeHref }: { columns: CompareColumn[]; removeHref: (key: string) => string }) {
  const { origin } = useOrigin();
  const now = useNow();
  const d = (c: CompareColumn) => c.drink;
  const dist = columns.map((c) => (origin ? distanceM(origin, c.place) : null));
  const anyEstimated = columns.some((c) => c.drink?.nutritionConfidence === "estimated");
  const anyDeal = columns.some((c) => c.drink && c.drink.discountPkr > 0);

  const rows: Row[] = [
    {
      label: "Price",
      values: columns.map((c) => d(c)?.pricePkr ?? null),
      better: "lower",
      bestLabel: "cheapest",
      cell: (c) =>
        c.drink && (
          <>
            {formatPkr(c.drink.pricePkr)}
            <Sub>
              {c.drink.taxInclusive === true ? "incl. tax" : c.drink.taxInclusive === false ? "+ tax" : "tax not stated"}
              {c.drink.channel !== "dine_in" && ` · ${CHANNEL_LABELS[c.drink.channel]}`}
            </Sub>
          </>
        ),
    },
    {
      label: "After deals",
      hint: "Best deal open to everyone, right now",
      values: columns.map((c) => d(c)?.effectivePricePkr ?? null),
      better: anyDeal ? "lower" : undefined,
      bestLabel: "cheapest after deals",
      cell: (c) =>
        c.drink && (
          <>
            {formatPkr(c.drink.effectivePricePkr)}
            <Sub>{c.drink.dealTitle ? `${c.drink.dealTitle} (−${formatPkr(c.drink.discountPkr)})` : "No deal now"}</Sub>
          </>
        ),
    },
    {
      label: "Size",
      values: columns.map((c) => d(c)?.volumeMl ?? null),
      cell: (c) =>
        c.drink && (
          <>
            {c.drink.volumeMl ? `${c.drink.volumeIsAssumed ? "≈" : ""}${c.drink.volumeMl} ml` : "—"}
            <Sub>{c.drink.size}</Sub>
          </>
        ),
    },
    {
      label: "Price per 100 ml",
      values: columns.map((c) => d(c)?.pricePer100ml ?? null),
      better: "lower",
      bestLabel: "best value",
      cell: (c) => (c.drink?.pricePer100ml != null ? formatPkr(Math.round(c.drink.pricePer100ml)) : null),
    },
    {
      label: "Calories",
      hint: anyEstimated ? "Estimated from the recipe" : undefined,
      values: columns.map((c) => d(c)?.kcal ?? null),
      better: "lower",
      bestLabel: "fewest",
      cell: (c) => (c.drink?.kcal != null ? `${c.drink.kcal} kcal` : null),
    },
    {
      label: "Sugar",
      values: columns.map((c) => d(c)?.sugarG ?? null),
      better: "lower",
      bestLabel: "least",
      cell: (c) => (c.drink?.sugarG != null ? `${c.drink.sugarG} g` : null),
    },
    {
      label: "Caffeine",
      values: columns.map((c) => d(c)?.caffeineMg ?? null),
      better: "higher",
      bestLabel: "strongest",
      cell: (c) => (c.drink?.caffeineMg != null ? `${c.drink.caffeineMg} mg` : null),
    },
    {
      label: "Calories per Rs 100",
      values: columns.map((c) => (d(c)?.kcalPerPkr != null ? Math.round(d(c)!.kcalPerPkr! * 100) : null)),
      cell: (c) => (c.drink?.kcalPerPkr != null ? `${Math.round(c.drink.kcalPerPkr * 100)} kcal` : null),
    },
    {
      label: "Beans",
      values: columns.map(() => null),
      cell: (c) =>
        c.beans && (
          <>
            {c.beans.roast ? `${ROAST_LABELS[c.beans.roast as keyof typeof ROAST_LABELS] ?? c.beans.roast} roast` : "Roast not known"}
            <Sub>
              {[c.beans.kind === "single_origin" ? "Single origin" : c.beans.kind === "blend" ? "Blend" : null, c.beans.origin, c.beans.arabicaPct === 100 ? "100% Arabica" : c.beans.arabicaPct ? `${c.beans.arabicaPct}% Arabica` : null]
                .filter(Boolean)
                .join(" · ")}
            </Sub>
          </>
        ),
    },
    {
      label: "Distance",
      values: dist,
      better: "lower",
      bestLabel: "nearest",
      cell: (_, i) =>
        dist[i] !== null ? (
          <>
            {formatDistance(dist[i]!)}
            <Sub>{origin?.kind === "gps" ? `~${formatTravel(travelEstimate(dist[i]!))}` : `from ${origin?.kind === "area" ? origin.name : ""}`}</Sub>
          </>
        ) : null,
    },
    {
      label: "Open now",
      values: columns.map(() => null),
      cell: (c) => (now ? describeOpenStatus(openStatus(c.place.hours, now)).label : null),
    },
    {
      label: "Rating",
      values: columns.map((c) => c.place.rating),
      better: "higher",
      bestLabel: "top rated",
      cell: (c) =>
        c.place.rating !== null && (
          <>
            ★ {c.place.rating.toFixed(1)}
            <Sub>{c.place.ratingCount} ratings</Sub>
          </>
        ),
    },
    {
      label: "Deals",
      values: columns.map(() => null),
      cell: (c) => (
        <Link href={`/places/${c.place.slug}#deals`} className="underline underline-offset-2">
          {c.place.activeDeals === 0 ? "None" : `${c.place.activeDeals} active`}
        </Link>
      ),
    },
    {
      label: "How sure",
      values: columns.map(() => null),
      cell: (c) =>
        c.drink && (
          <span className="flex flex-col items-start gap-1">
            <ConfidenceBadge level={c.drink.priceConfidence} wrap className="max-w-full rounded-lg px-1.5 text-[10px]" />
            <Sub>{checkedAgo(c.drink.priceVerifiedAt)}</Sub>
            {c.drink.priceSourceName && <Sub>Source: {c.drink.priceSourceName}</Sub>}
          </span>
        ),
    },
  ];

  return (
    <div className="-mx-4 overflow-x-auto px-2" role="region" aria-label="Comparison table" tabIndex={0}>
      <table className="w-full table-fixed border-separate border-spacing-0 text-sm" style={{ minWidth: `calc(4.5rem + ${columns.length} * 5.5rem)` }}>
        <caption className="sr-only">
          Side-by-side comparison. Each column is a drink at a place; the best value in each row is marked.
        </caption>
        <colgroup>
          <col className="w-[4.5rem]" />
          {columns.map((c) => (
            <col key={c.key} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <td className="sticky left-0 z-10 bg-background" />
            {columns.map((c) => (
              <th key={c.key} scope="col" className="relative px-1.5 pb-2 text-start align-top font-normal">
                <Link href={`/places/${c.place.slug}`} className="block pe-6 font-semibold leading-tight underline-offset-2 hover:underline">
                  {c.place.name}
                </Link>
                {c.place.branchName && <span className="block text-xs text-muted-foreground">{c.place.branchName}</span>}
                <span className="mt-0.5 block text-xs">{c.drink ? `${c.drink.name}` : <em className="text-muted-foreground">Not on the menu</em>}</span>
                {c.place.isSample && <SampleBadge wrap className="mt-1 max-w-full px-1.5 text-[10px]" />}
                <Link
                  href={removeHref(c.key)}
                  className="absolute -top-2 right-0 grid size-11 place-items-center text-muted-foreground hover:text-foreground"
                  aria-label={`Remove ${c.place.name} from the comparison`}
                  scroll={false}
                >
                  <X aria-hidden className="size-4" />
                </Link>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const best = r.better ? bestIndices(r.values, r.better) : new Set<number>();
            return (
              <tr key={r.label}>
                <th scope="row" className="sticky left-0 z-10 border-t bg-background py-2 pe-1.5 text-start align-top text-xs font-medium">
                  {r.label}
                  {r.hint && <span className="mt-0.5 block font-normal text-muted-foreground">{r.hint}</span>}
                </th>
                {columns.map((c, i) => {
                  const content = r.cell(c, i);
                  const isBest = best.has(i);
                  return (
                    <td
                      key={c.key}
                      className={cn("border-t px-1.5 py-2 align-top tabular-nums break-words", isBest && "bg-success/10 font-semibold")}
                    >
                      {isBest && (
                        <span className="mb-0.5 flex items-center gap-0.5 text-[11px] font-semibold text-success">
                          <Check aria-hidden className="size-3" />
                          {r.bestLabel ? r.bestLabel.charAt(0).toUpperCase() + r.bestLabel.slice(1) : "Best"}
                        </span>
                      )}
                      {content ?? <span className="text-muted-foreground" aria-label="not known">—</span>}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const Sub = ({ children }: { children: React.ReactNode }) => (
  <span className="block text-[11px] font-normal text-muted-foreground">{children}</span>
);
