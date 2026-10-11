// "Highlight the best value in each row" (Section 3D). Missing values never win, ties all win,
// and a row where every column has the same value highlights nothing.

export type Better = "lower" | "higher";

export function bestIndices(values: (number | null | undefined)[], better: Better): Set<number> {
  const known = values.map((v, i) => [v, i] as const).filter((x): x is readonly [number, number] => typeof x[0] === "number" && Number.isFinite(x[0]));
  if (known.length < 2) return new Set();
  const target = better === "lower" ? Math.min(...known.map(([v]) => v)) : Math.max(...known.map(([v]) => v));
  const winners = known.filter(([v]) => v === target).map(([, i]) => i);
  return winners.length === known.length ? new Set() : new Set(winners);
}
