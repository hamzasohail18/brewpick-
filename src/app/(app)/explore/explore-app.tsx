"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { List, Map as MapIcon, MapPin, Search, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Chip } from "@/components/app/chip";
import { nativeSelect } from "@/components/admin/native-select";
import { LocationSheet, originLabel, type AreaOption } from "@/components/app/location-sheet";
import { cn } from "@/lib/utils";
import { getT } from "@/lib/i18n";
import {
  activeFilterCount,
  filtersToParams,
  parseFilters,
  SERVER_KEYS,
  SORT_LABELS,
  SORTS,
  type ExploreFilters,
} from "@/lib/explore/filters";
import { openStatus } from "@/lib/explore/hours";
import { useNow, useOrigin } from "@/lib/explore/origin";
import type { PlaceSummary } from "@/lib/explore/repo";
import { distanceM } from "@/lib/explore/travel";
import { formatPkr } from "@/lib/explore/format";
import { FilterSheet, type FilterOptions } from "./filter-sheet";
import { PlaceCard, PlaceCardSkeleton } from "./place-card";

const PlacesMap = dynamic(() => import("@/components/app/places-map"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-muted" />,
});

type Sort = (typeof SORTS)[number];

export function ExploreApp({
  initialKey,
  initialPlaces,
  areas,
  options,
}: {
  initialKey: string;
  initialPlaces: PlaceSummary[];
  areas: AreaOption[];
  options: FilterOptions;
}) {
  const t = getT();
  const searchParams = useSearchParams();
  const filters = useMemo(() => parseFilters(searchParams), [searchParams]);
  const view = searchParams.get("view") === "map" ? "map" : "list";
  const serverKey = filtersToParams(filters, SERVER_KEYS).toString();

  const writeUrl = (next: ExploreFilters, nextView: "list" | "map" = view) => {
    const p = filtersToParams(next);
    if (nextView === "map") p.set("view", "map");
    const qs = p.toString();
    // Next.js syncs useSearchParams with history.replaceState, without a server round trip.
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  };
  const update = (patch: Partial<ExploreFilters>) => writeUrl({ ...filters, ...patch });
  const toggle = (key: "openNow" | "deals" | "wifi" | "family" | "halal" | "driveThru" | "dairyFree") =>
    update({ [key]: filters[key] ? undefined : true });

  // Search box: local text, written to the URL after a pause.
  const [text, setText] = useState(filters.q ?? "");
  useEffect(() => {
    const q = text.trim() || undefined;
    if (q === filters.q) return;
    const id = setTimeout(() => writeUrl({ ...filters, q }), 300);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the typed text should trigger this
  }, [text]);

  const query = useQuery({
    queryKey: ["places", serverKey],
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/places${serverKey ? `?${serverKey}` : ""}`, { signal });
      if (!res.ok) throw new Error(`Couldn't load places (${res.status})`);
      return ((await res.json()) as { places: PlaceSummary[] }).places;
    },
    initialData: serverKey === initialKey ? initialPlaces : undefined,
    placeholderData: keepPreviousData,
  });

  const originState = useOrigin();
  const origin = originState.origin;
  const now = useNow();
  const sort: Sort = filters.sort ?? (origin ? "distance" : "name");

  const rows = useMemo(() => {
    const list = (query.data ?? []).map((place) => ({
      place,
      distanceM: origin ? distanceM(origin, place) : null,
      open: now ? openStatus(place.hours, now) : null,
      pick: sort === "calories" ? (place.lightest ?? place.cheapest) : place.cheapest,
    }));
    const filtered = list.filter(
      (r) =>
        (!filters.openNow || !r.open || r.open.state === "open") &&
        (!filters.maxKm || r.distanceM === null || r.distanceM <= filters.maxKm * 1000),
    );
    const last = Number.POSITIVE_INFINITY;
    const key: Record<Sort, (r: (typeof list)[number]) => number | string> = {
      distance: (r) => r.distanceM ?? last,
      price: (r) => r.place.cheapest?.pricePkr ?? last,
      calories: (r) => r.place.lightest?.kcal ?? last,
      rating: (r) => -(r.place.rating ?? -1),
      name: (r) => `${r.place.name} ${r.place.branchName ?? ""}`.toLowerCase(),
    };
    const k = key[sort === "distance" && !origin ? "name" : sort];
    return filtered.sort((a, b) => {
      const ka = k(a);
      const kb = k(b);
      return ka < kb ? -1 : ka > kb ? 1 : a.place.name.localeCompare(b.place.name);
    });
  }, [query.data, origin, now, filters.openNow, filters.maxKm, sort]);

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [locationOpen, setLocationOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const filterCount = activeFilterCount(filters);
  const clearAll = () => {
    setText("");
    writeUrl({ sort: filters.sort });
  };
  const limits = filters.maxKcal || filters.maxSugar || filters.minCaffeine;
  const active = rows.find((r) => r.place.id === activeId) ?? null;
  const distanceFrom = origin ? (origin.kind === "gps" ? "you" : origin.name) : null;

  return (
    <main className="mx-auto max-w-2xl">
      <div className="sticky top-0 z-30 space-y-3 border-b bg-background/95 px-4 pt-4 pb-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">{t("explore.title")}</h1>
          <Button variant="outline" className="h-11 max-w-[55%] rounded-full" onClick={() => setLocationOpen(true)}>
            <MapPin aria-hidden className={cn(origin ? "text-primary" : "text-muted-foreground")} />
            <span className="truncate">{originLabel(originState)}</span>
          </Button>
        </div>

        <div className="relative">
          <Search aria-hidden className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("explore.search")}
            aria-label={t("explore.search")}
            className="h-11 ps-9 text-base md:text-sm"
            enterKeyHint="search"
          />
        </div>

        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none]" role="group" aria-label="Quick filters">
          <Chip pressed={filterCount > 0} onClick={() => setFiltersOpen(true)}>
            <SlidersHorizontal aria-hidden className="size-4" />
            {t("explore.filters")}
            {filterCount > 0 && <span className="rounded-full bg-primary-foreground/20 px-1.5 text-xs tabular-nums">{filterCount}</span>}
          </Chip>
          <Chip pressed={!!filters.openNow} onClick={() => toggle("openNow")}>Open now</Chip>
          <Chip pressed={!!filters.deals} onClick={() => toggle("deals")}>Deals</Chip>
          <Chip pressed={!!filters.wifi} onClick={() => toggle("wifi")}>Wi-Fi</Chip>
          <Chip pressed={!!filters.family} onClick={() => toggle("family")}>Family seating</Chip>
          <Chip pressed={!!filters.halal} onClick={() => toggle("halal")}>Halal</Chip>
          <Chip pressed={!!filters.dairyFree} onClick={() => toggle("dairyFree")}>Dairy-free</Chip>
          <Chip pressed={!!filters.driveThru} onClick={() => toggle("driveThru")}>Drive-thru</Chip>
        </div>

        <div className="flex items-center gap-2">
          <p className="me-auto shrink-0 text-sm text-muted-foreground" aria-live="polite">
            {query.isFetching && !query.isPlaceholderData ? "Loading…" : `${rows.length} ${rows.length === 1 ? "place" : "places"}`}
            {query.isFetching && query.isPlaceholderData && <span className="sr-only"> (updating)</span>}
          </p>
          <label className="sr-only" htmlFor="sort">
            {t("explore.sort")}
          </label>
          <select
            id="sort"
            className={cn(nativeSelect, "h-10 w-auto min-w-0 shrink px-2")}
            value={sort}
            onChange={(e) => update({ sort: e.target.value as Sort })}
          >
            {SORTS.map((s) => (
              <option key={s} value={s} disabled={s === "distance" && !origin}>
                {SORT_LABELS[s]}
                {s === "distance" && !origin ? " (set location)" : ""}
              </option>
            ))}
          </select>
          <div className="flex shrink-0 rounded-md border p-0.5" role="group" aria-label="View">
            {(["list", "map"] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => writeUrl(filters, v)}
                className={cn(
                  "inline-flex h-9 min-w-10 items-center justify-center gap-1 rounded px-2.5 text-sm font-medium",
                  view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {v === "list" ? <List aria-hidden className="size-4" /> : <MapIcon aria-hidden className="size-4" />}
                <span className="max-sm:sr-only">{v === "list" ? t("explore.list") : t("explore.map")}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className={cn("px-4 py-4 transition-opacity", query.isFetching && query.isPlaceholderData && "opacity-60")}>
        {query.isError && (
          <p role="alert" className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {query.error.message}. {query.data ? "Showing the last results." : ""}
          </p>
        )}
        {(limits || filters.avoid) && (
          <p className="mb-3 text-xs text-muted-foreground">
            Drinks with missing {filters.avoid ? "allergen" : "nutrition"} data are left out of these limits, not counted as zero.
          </p>
        )}

        {view === "map" ? (
          <div className="space-y-3">
            <div className="h-[55dvh] min-h-80 overflow-hidden rounded-xl border">
              <PlacesMap
                className="h-full w-full"
                pins={rows.map((r) => ({
                  id: r.place.id,
                  lat: r.place.lat,
                  lng: r.place.lng,
                  label: r.pick ? formatPkr(r.pick.pricePkr) : "☕",
                  title: r.place.branchName ? `${r.place.name}, ${r.place.branchName}` : r.place.name,
                  dimmed: r.open?.state === "closed",
                }))}
                origin={origin ? { lat: origin.lat, lng: origin.lng, kind: origin.kind } : null}
                activeId={activeId}
                onSelect={setActiveId}
              />
            </div>
            {active ? (
              <div className="relative">
                <PlaceCard place={active.place} pick={active.pick} distanceM={active.distanceM} distanceFrom={distanceFrom} open={active.open} />
                <button
                  type="button"
                  onClick={() => setActiveId(null)}
                  className="absolute -top-2 -right-2 z-10 grid size-11 place-items-center rounded-full"
                  aria-label="Close place preview"
                >
                  <span className="grid size-7 place-items-center rounded-full border bg-background shadow-sm">
                    <X aria-hidden className="size-4" />
                  </span>
                </button>
              </div>
            ) : (
              <p className="text-center text-sm text-muted-foreground">Tap a pin to see the place.</p>
            )}
          </div>
        ) : query.data === undefined ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }, (_, i) => (
              <PlaceCardSkeleton key={i} />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-xl border border-dashed p-8 text-center">
            <p className="font-medium">{t("explore.empty")}</p>
            <p className="mt-1 text-sm text-muted-foreground">Try fewer filters or a wider distance.</p>
            <Button variant="outline" className="mt-4 h-11" onClick={clearAll}>
              {t("explore.clearAll")}
            </Button>
          </div>
        ) : (
          <ul className="space-y-3">
            {rows.map((r) => (
              <li key={r.place.id}>
                <PlaceCard place={r.place} pick={r.pick} distanceM={r.distanceM} distanceFrom={distanceFrom} open={r.open} />
              </li>
            ))}
          </ul>
        )}
      </div>

      <FilterSheet
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        filters={filters}
        update={update}
        clearAll={clearAll}
        options={options}
        areas={areas}
        resultCount={rows.length}
        hasOrigin={!!origin}
      />
      <LocationSheet open={locationOpen} onOpenChange={setLocationOpen} areas={areas} />
    </main>
  );
}
