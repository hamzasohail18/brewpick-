"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Columns3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { nativeSelect } from "@/components/admin/native-select";
import { SampleBadge } from "@/components/app/badges";
import { cn } from "@/lib/utils";
import { compareHref, MAX_COMPARE } from "@/lib/compare/params";
import { clearTray, trayHref, useTray } from "@/lib/compare/tray";
import { formatDistance } from "@/lib/capture/geo";
import { formatPkr } from "@/lib/explore/format";
import { useOrigin } from "@/lib/explore/origin";
import type { PlaceSummary } from "@/lib/explore/repo";
import { distanceM } from "@/lib/explore/travel";

/** Nothing selected yet: continue with the tray, or pick a drink and 2–4 places right here. */
export function CompareStart({ drinks }: { drinks: { slug: string; name: string }[] }) {
  const router = useRouter();
  const tray = useTray();
  const { origin } = useOrigin();
  const [drink, setDrink] = useState("latte");
  const [picked, setPicked] = useState<string[]>([]);

  const query = useQuery({
    queryKey: ["places", `drink=${drink}`],
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/places?drink=${encodeURIComponent(drink)}`, { signal });
      if (!res.ok) throw new Error(`Couldn't load places (${res.status})`);
      return ((await res.json()) as { places: PlaceSummary[] }).places;
    },
  });

  const places = useMemo(() => {
    const list = (query.data ?? []).map((p) => ({ p, d: origin ? distanceM(origin, p) : null }));
    return list.sort((a, b) => (a.d ?? 0) - (b.d ?? 0) || a.p.name.localeCompare(b.p.name));
  }, [query.data, origin]);

  const toggle = (slug: string) =>
    setPicked((cur) => (cur.includes(slug) ? cur.filter((s) => s !== slug) : cur.length < MAX_COMPARE ? [...cur, slug] : cur));
  const available = new Set(places.map((x) => x.p.slug));
  const selected = picked.filter((s) => available.has(s));

  return (
    <div className="space-y-6">
      {tray.length > 0 && (
        <section className="space-y-3 rounded-xl border bg-card p-4" aria-labelledby="tray-title">
          <h2 id="tray-title" className="font-semibold">
            Your picks ({tray.length})
          </h2>
          <ul className="list-disc space-y-0.5 ps-5 text-sm">
            {tray.map((e) => (
              <li key={e.kind === "size" ? e.id : e.slug}>{e.label}</li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button asChild className="h-11" disabled={tray.length < 2}>
              <Link href={trayHref(tray)} aria-disabled={tray.length < 2} className={cn(tray.length < 2 && "pointer-events-none opacity-50")}>
                <Columns3 aria-hidden />
                Compare these
              </Link>
            </Button>
            <Button variant="outline" className="h-11" onClick={clearTray}>
              Clear picks
            </Button>
          </div>
          {tray.length < 2 && <p className="text-xs text-muted-foreground">Pick at least two. Use “Compare” on a place or menu item.</p>}
        </section>
      )}

      <section className="space-y-4" aria-labelledby="builder-title">
        <div>
          <h2 id="builder-title" className="font-semibold">
            Compare one drink across places
          </h2>
          <p className="text-sm text-muted-foreground">Choose a drink, then 2 to {MAX_COMPARE} places.</p>
        </div>
        <label className="block space-y-2">
          <span className="text-sm font-medium">Drink</span>
          <select
            className={nativeSelect}
            value={drink}
            onChange={(e) => {
              setDrink(e.target.value);
            }}
          >
            {drinks.map((d) => (
              <option key={d.slug} value={d.slug}>
                {d.name}
              </option>
            ))}
          </select>
        </label>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">
            Places that serve it {selected.length > 0 && <span className="text-muted-foreground">({selected.length}/{MAX_COMPARE} picked)</span>}
          </legend>
          {query.isPending ? (
            <div className="space-y-2" aria-hidden>
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="h-14 animate-pulse rounded-lg bg-muted" />
              ))}
            </div>
          ) : query.isError ? (
            <p role="alert" className="text-sm text-destructive">
              {query.error.message}
            </p>
          ) : places.length === 0 ? (
            <p className="text-sm text-muted-foreground">No place has a price for this drink yet.</p>
          ) : (
            <ul className="divide-y rounded-xl border">
              {places.map(({ p, d }) => {
                const on = selected.includes(p.slug);
                const disabled = !on && selected.length >= MAX_COMPARE;
                return (
                  <li key={p.id}>
                    <label className={cn("flex min-h-14 cursor-pointer items-center gap-3 px-3 py-2", disabled && "cursor-not-allowed opacity-50")}>
                      <input type="checkbox" className="size-5 accent-primary" checked={on} disabled={disabled} onChange={() => toggle(p.slug)} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {p.name}
                          {p.branchName && <span className="font-normal text-muted-foreground"> · {p.branchName}</span>}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {[p.areaName, d !== null ? formatDistance(d) : null].filter(Boolean).join(" · ")}
                        </span>
                        {p.isSample && <SampleBadge className="mt-1 px-1.5 text-[10px]" />}
                      </span>
                      <span className="text-sm font-semibold tabular-nums">{p.cheapest ? `from ${formatPkr(p.cheapest.pricePkr)}` : ""}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </fieldset>
        <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20">
          <Button
            className="h-12 w-full text-base shadow-lg"
            disabled={selected.length < 2}
            onClick={() => router.push(compareHref({ places: selected, drink }))}
          >
            <Columns3 aria-hidden />
            {selected.length < 2 ? "Pick at least 2 places" : `Compare ${selected.length} places`}
          </Button>
        </div>
      </section>
    </div>
  );
}
