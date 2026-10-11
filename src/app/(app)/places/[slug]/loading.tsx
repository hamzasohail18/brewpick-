export default function Loading() {
  return (
    <main className="mx-auto max-w-2xl space-y-4 px-4 py-6" aria-busy="true" aria-label="Loading place">
      <div className="h-8 w-2/3 animate-pulse rounded bg-muted" />
      <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
      <div className="flex gap-2">
        <div className="h-11 w-32 animate-pulse rounded-md bg-muted" />
        <div className="h-11 w-24 animate-pulse rounded-md bg-muted" />
      </div>
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="h-40 animate-pulse rounded-xl bg-muted" />
      ))}
    </main>
  );
}
