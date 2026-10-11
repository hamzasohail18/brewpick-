import { PlaceCardSkeleton } from "./place-card";

export default function Loading() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-4" aria-busy="true" aria-label="Loading places">
      <div className="mb-4 h-8 w-32 animate-pulse rounded bg-muted" />
      <div className="mb-4 h-11 animate-pulse rounded-md bg-muted" />
      <div className="space-y-3">
        {Array.from({ length: 4 }, (_, i) => (
          <PlaceCardSkeleton key={i} />
        ))}
      </div>
    </main>
  );
}
