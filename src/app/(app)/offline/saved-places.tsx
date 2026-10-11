"use client";

import Link from "next/link";
import { useFavorites, useRecent } from "@/lib/profile/client";

export function SavedPlaces() {
  const recent = useRecent();
  const favorites = useFavorites();
  const seen = new Set<string>();
  const places = [...recent, ...favorites].filter((p) => !seen.has(p.placeId) && seen.add(p.placeId));

  if (places.length === 0) {
    return <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">Places you open will be kept here for offline use.</p>;
  }
  return (
    <section aria-labelledby="saved" className="space-y-3">
      <h2 id="saved" className="text-lg font-semibold">
        Recently opened and favourites
      </h2>
      <ul className="divide-y rounded-xl border bg-card">
        {places.map((p) => (
          <li key={p.placeId}>
            {/* A plain link: a full page load lets the service worker serve the saved copy. */}
            <a href={`/places/${p.slug}`} className="flex min-h-14 flex-col justify-center px-4 py-2 hover:bg-accent">
              <span className="font-medium">{p.name}</span>
              <span className="text-xs text-muted-foreground">{p.branchName ?? p.areaName ?? ""}</span>
            </a>
          </li>
        ))}
      </ul>
      <p className="text-sm">
        <Link href="/" className="underline underline-offset-4">
          Try the home screen again
        </Link>
      </p>
    </section>
  );
}
