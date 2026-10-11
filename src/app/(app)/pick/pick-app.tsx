"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ChevronRight, Columns3, LocateFixed, Navigation, RotateCcw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfidenceBadge, SampleBadge } from "@/components/app/badges";
import { CardsButton } from "@/components/app/cards-sheet";
import { cn } from "@/lib/utils";
import { useCards } from "@/lib/deals/cards";
import type { DealRule } from "@/lib/deals/engine";
import { compareHref } from "@/lib/compare/params";
import { formatDistance } from "@/lib/capture/geo";
import { formatPkr } from "@/lib/explore/format";
import { locate, useNow, useOrigin } from "@/lib/explore/origin";
import { formatTravel } from "@/lib/explore/travel";
import { FACTOR_LABELS, pickForMe, type Candidate, type Factor, type FactorScore, type Pick } from "@/lib/scoring/engine";
import {
  BUDGETS,
  complete,
  currentStep,
  DISTANCES,
  GOAL_OPTIONS,
  parseQuiz,
  quizHref,
  STYLE_OPTIONS,
  type QuizState,
  type Step,
} from "@/lib/scoring/quiz";

const STEPS: Step[] = ["budget", "goal", "style", "distance"];
const QUESTIONS: Record<Exclude<Step, "result">, string> = {
  budget: "What's your budget?",
  goal: "What matters most?",
  style: "How do you like it?",
  distance: "How far will you go?",
};

export function PickApp() {
  const params = useSearchParams();
  const state = useMemo(() => parseQuiz(params), [params]);
  const step = currentStep(state);
  return step === "result" ? <Results state={state} /> : <Question state={state} step={step} />;
}

// ---------- quiz ----------

function Question({ state, step }: { state: QuizState; step: Exclude<Step, "result"> }) {
  const router = useRouter();
  const { origin } = useOrigin();
  const index = STEPS.indexOf(step);
  const prev: QuizState = { ...state };
  if (step === "goal") delete prev.budgetMax;
  if (step === "style") delete prev.goal;
  if (step === "distance") delete prev.style;

  const options: { label: string; hint?: string; next: QuizState }[] =
    step === "budget"
      ? BUDGETS.map((b) => ({ label: b.label, next: { ...state, budgetMax: b.value === "any" ? null : Number(b.value) } }))
      : step === "goal"
        ? GOAL_OPTIONS.map((g) => ({ label: g.label, hint: g.hint, next: { ...state, goal: g.value } }))
        : step === "style"
          ? STYLE_OPTIONS.map((s) => ({ label: s.label, next: { ...state, style: s.value } }))
          : DISTANCES.map((d) => ({ label: d.label, hint: d.hint, next: { ...state, maxKm: d.value === "any" ? null : Number(d.value) } }));

  return (
    <main className="mx-auto flex min-h-[calc(100dvh-3.5rem)] max-w-md flex-col px-4 py-4">
      <div className="flex items-center gap-2">
        {index > 0 ? (
          <Link href={quizHref(prev)} className="-ms-2 grid size-11 place-items-center rounded-md" aria-label="Previous question">
            <ArrowLeft aria-hidden className="size-5" />
          </Link>
        ) : (
          <Link href="/" className="-ms-2 grid size-11 place-items-center rounded-md" aria-label="Back to home">
            <ArrowLeft aria-hidden className="size-5" />
          </Link>
        )}
        <div className="flex flex-1 gap-1.5" role="progressbar" aria-valuemin={1} aria-valuemax={4} aria-valuenow={index + 1} aria-label={`Question ${index + 1} of 4`}>
          {STEPS.map((s, i) => (
            <span key={s} className={cn("h-1.5 flex-1 rounded-full", i <= index ? "bg-primary" : "bg-muted")} />
          ))}
        </div>
      </div>

      <h1 className="mt-8 text-2xl font-semibold">{QUESTIONS[step]}</h1>
      {step === "distance" && !origin && (
        <p className="mt-2 text-sm text-muted-foreground">We&apos;ll ask for your location. It stays on this phone.</p>
      )}
      {step === "goal" && (
        <div className="mt-3">
          <CardsButton />
        </div>
      )}

      {/* Answers sit low on the screen, within thumb reach. */}
      <ul className="mt-auto space-y-2 pt-8 pb-4">
        {options.map((o) => (
          <li key={o.label}>
            <button
              type="button"
              onClick={() => {
                // Ask for location as part of this tap, so the distance limit can be used without an extra step.
                if (step === "distance" && !origin && o.next.maxKm !== null) locate();
                router.push(quizHref(o.next), { scroll: false });
              }}
              className="flex min-h-16 w-full items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 text-start transition-colors hover:border-primary hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <span>
                <span className="block text-base font-semibold">{o.label}</span>
                {o.hint && <span className="block text-sm text-muted-foreground">{o.hint}</span>}
              </span>
              <ChevronRight aria-hidden className="size-5 text-muted-foreground" />
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}

// ---------- results ----------

function Results({ state }: { state: QuizState }) {
  const answers = complete(state)!;
  const cards = useCards();
  const now = useNow();
  const originState = useOrigin();
  const { origin } = originState;

  const query = useQuery({
    queryKey: ["pick", answers.style, answers.budgetMax],
    queryFn: async ({ signal }) => {
      const qs = new URLSearchParams({ s: answers.style, b: answers.budgetMax === null ? "any" : String(answers.budgetMax) });
      const res = await fetch(`/api/pick?${qs}`, { signal });
      if (!res.ok) throw new Error(`Couldn't load drinks (${res.status})`);
      return (await res.json()) as { candidates: Candidate[]; deals: DealRule[] };
    },
  });

  const result = useMemo(() => {
    if (!query.data || !now) return null;
    return pickForMe(query.data.candidates, answers, {
      cards,
      deals: query.data.deals,
      origin: origin ? { lat: origin.lat, lng: origin.lng, kind: origin.kind, name: origin.kind === "area" ? origin.name : undefined } : null,
      now,
    });
  }, [query.data, answers, cards, origin, now]);

  const summary = [
    BUDGETS.find((b) => (b.value === "any" ? answers.budgetMax === null : Number(b.value) === answers.budgetMax))?.label,
    GOAL_OPTIONS.find((g) => g.value === answers.goal)?.label,
    STYLE_OPTIONS.find((s) => s.value === answers.style)?.label,
    DISTANCES.find((d) => (d.value === "any" ? answers.maxKm === null : Number(d.value) === answers.maxKm))?.label,
  ];
  const edit: QuizState[] = [
    { ...state, budgetMax: undefined },
    { ...state, goal: undefined },
    { ...state, style: undefined },
    { ...state, maxKm: undefined },
  ];

  return (
    <main className="mx-auto max-w-md space-y-5 px-4 py-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Your pick</h1>
        <Button asChild variant="ghost" className="h-11">
          <Link href="/pick">
            <RotateCcw aria-hidden />
            Start over
          </Link>
        </Button>
      </div>

      <ul className="flex flex-wrap gap-1.5" aria-label="Your answers (tap to change)">
        {summary.map((s, i) => (
          <li key={i}>
            <Link href={quizHref(edit[i])} className="inline-flex min-h-9 items-center rounded-full border bg-card px-3 text-sm hover:bg-accent">
              {s}
            </Link>
          </li>
        ))}
        <li>
          <CardsButton compact className="min-h-9" />
        </li>
      </ul>

      {originState.status === "locating" && <p className="text-sm text-muted-foreground" role="status">Finding your location…</p>}
      {answers.maxKm !== null && !origin && originState.status !== "locating" && (
        <div className="space-y-2 rounded-xl border border-warning/50 bg-warning/10 p-3 text-sm">
          <p>
            {originState.status === "insecure"
              ? "Your browser only shares location over https, so the distance limit isn't used."
              : originState.status === "denied"
                ? "Location is off, so the distance limit isn't used."
                : "We don't know where you are yet, so the distance limit isn't used."}
          </p>
          {originState.status !== "insecure" && (
            <Button variant="outline" className="h-11" onClick={locate}>
              <LocateFixed aria-hidden />
              Use my location
            </Button>
          )}
        </div>
      )}

      {query.isError ? (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {query.error.message}
        </p>
      ) : !result ? (
        <div className="space-y-3" aria-busy="true" aria-label="Finding your pick">
          <div className="h-56 animate-pulse rounded-2xl bg-muted" />
          <div className="h-28 animate-pulse rounded-xl bg-muted" />
          <div className="h-28 animate-pulse rounded-xl bg-muted" />
        </div>
      ) : result.picks.length === 0 ? (
        <div className="rounded-xl border border-dashed p-6 text-center">
          <p className="font-medium">Nothing fits all of that right now.</p>
          <p className="mt-1 text-sm text-muted-foreground">{result.notes.join(" ")}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Left out: {result.excluded.budget} over budget, {result.excluded.distance} too far, {result.excluded.closed} closed now,{" "}
            {result.excluded.style} a different style.
          </p>
        </div>
      ) : (
        <>
          <PickCard pick={result.picks[0]} top />
          {result.picks.length > 1 && (
            <section aria-labelledby="alts" className="space-y-3">
              <h2 id="alts" className="text-sm font-semibold text-muted-foreground">
                Also good
              </h2>
              {result.picks.slice(1).map((p) => (
                <PickCard key={p.candidate.sizeId} pick={p} />
              ))}
            </section>
          )}
          {result.picks.length >= 2 && (
            <Button asChild variant="outline" className="h-11 w-full">
              <Link href={compareHref({ items: result.picks.map((p) => p.candidate.sizeId) })}>
                <Columns3 aria-hidden />
                Compare these side by side
              </Link>
            </Button>
          )}
          <p className="text-xs text-muted-foreground">
            Chosen from {result.considered} {result.considered === 1 ? "drink" : "drinks"} that fit your answers and are open now
            {result.excluded.unsourced > 0 && `; ${result.excluded.unsourced} without a price source were not ranked`}.
            {result.notes.length > 0 && ` ${result.notes.join(" ")}`}
          </p>
        </>
      )}
    </main>
  );
}

function PickCard({ pick, top = false }: { pick: Pick; top?: boolean }) {
  const c = pick.candidate;
  const place = c.branchName ? `${c.placeName} · ${c.branchName}` : c.placeName;
  const caveats = pick.caveats.filter((cv) => !cv.startsWith("Sample data")); // the badge already says so
  return (
    <article className={cn("space-y-3 rounded-2xl border bg-card p-4", top && "border-primary/50 shadow-md")}>
      {top && (
        <p className="inline-flex items-center gap-1 text-xs font-semibold tracking-wide text-primary uppercase">
          <Sparkles aria-hidden className="size-3.5" /> Top pick
        </p>
      )}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className={cn("font-semibold leading-snug", top ? "text-xl" : "text-base")}>
            {c.drinkName} <span className="font-normal text-muted-foreground">· {c.size}</span>
          </h3>
          <p className="text-sm">
            <Link href={`/places/${c.placeSlug}`} className="underline-offset-2 hover:underline">
              {place}
            </Link>
            {c.areaName && <span className="text-muted-foreground"> · {c.areaName}</span>}
          </p>
        </div>
        {c.isSample && <SampleBadge className="shrink-0" />}
      </div>

      <p className={cn("font-medium", top ? "text-base" : "text-sm")}>{pick.reason}</p>

      <dl className="grid grid-cols-3 gap-2 rounded-lg bg-muted/60 p-2.5 text-center">
        <div>
          <dt className="text-[11px] text-muted-foreground">You pay</dt>
          <dd className="font-semibold tabular-nums">{formatPkr(pick.effective.pricePkr)}</dd>
          {pick.effective.discountPkr > 0 && (
            <dd className="text-[11px] text-muted-foreground">
              <s>{formatPkr(c.pricePkr)}</s>
            </dd>
          )}
        </div>
        <div>
          <dt className="text-[11px] text-muted-foreground">Distance</dt>
          <dd className="font-semibold tabular-nums">{pick.distanceM !== null ? formatDistance(pick.distanceM) : "—"}</dd>
          {pick.travel && <dd className="text-[11px] text-muted-foreground">~{formatTravel(pick.travel)}</dd>}
        </div>
        <div>
          <dt className="text-[11px] text-muted-foreground">Calories</dt>
          <dd className="font-semibold tabular-nums">{c.kcal !== null && c.nutritionSourced ? `${c.kcal} kcal` : "—"}</dd>
          {c.nutritionConfidence === "estimated" && <dd className="text-[11px] text-muted-foreground">Estimated</dd>}
        </div>
      </dl>

      {caveats.length > 0 && (
        <ul className="flex flex-wrap gap-1.5 text-xs">
          {caveats.map((cv) => (
            <li key={cv} className="rounded-full border border-warning/50 bg-warning/10 px-2 py-0.5">
              {cv}
            </li>
          ))}
        </ul>
      )}

      <Breakdown pick={pick} />

      <div className="flex flex-wrap items-center gap-2">
        {top && (
          <Button asChild className="h-11">
            <a href={`https://www.google.com/maps/dir/?api=1&destination=${c.lat},${c.lng}`} target="_blank" rel="noopener noreferrer">
              <Navigation aria-hidden />
              Directions
            </a>
          </Button>
        )}
        <Button asChild variant="outline" className="h-11">
          <Link href={`/places/${c.placeSlug}`}>See menu</Link>
        </Button>
        <ConfidenceBadge level={c.priceConfidence} checkedAt={c.priceVerifiedAt} className="ms-auto" />
      </div>
    </article>
  );
}

const fmt = (f: Factor, raw: number | null): string => {
  if (raw === null) return "not known";
  switch (f) {
    case "effectivePrice":
    case "price":
      return formatPkr(raw);
    case "deal":
      return raw > 0 ? `${formatPkr(raw)} off` : "none";
    case "calories":
      return `${raw} kcal`;
    case "caffeine":
      return `${raw} mg`;
    case "distance":
      return formatDistance(raw);
    case "rating":
      return `${raw.toFixed(1)} ★`;
    case "beans":
      return `${Math.round(raw * 100)} / 100`;
  }
};

/** "Why this pick": every factor's value, how it ranked here, its weight and what it added. */
function Breakdown({ pick }: { pick: Pick }) {
  const rows = [...pick.factors].sort((a, b) => b.weight - a.weight);
  return (
    <details className="group text-sm">
      <summary className="inline-flex min-h-11 cursor-pointer items-center font-medium underline underline-offset-2">
        Why this pick? Score {pick.score.toFixed(0)}/100
      </summary>
      <div className="mt-2 space-y-2">
        <table className="w-full text-xs">
          <caption className="sr-only">Score breakdown</caption>
          <thead>
            <tr className="text-left text-muted-foreground">
              <th scope="col" className="pb-1 font-medium">Factor</th>
              <th scope="col" className="pb-1 font-medium">Value</th>
              <th scope="col" className="pb-1 font-medium">Here</th>
              <th scope="col" className="pb-1 text-end font-medium">Weight</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((f) => (
              <FactorRow key={f.factor} f={f} />
            ))}
          </tbody>
        </table>
        <p className="text-xs text-muted-foreground">
          &ldquo;Here&rdquo; ranks this drink against the others that fit your answers (full bar = best). Weights come from your goal.
          Ratings with few votes are pulled towards 4.0 so a handful of 5-star votes can&apos;t dominate.
          {pick.missingWeight > 0 &&
            ` Missing data isn't counted as zero: it's left out, and the score is reduced by ${Math.round(pick.missingWeight * 50)}% to reflect the gap.`}
        </p>
      </div>
    </details>
  );
}

function FactorRow({ f }: { f: FactorScore }) {
  return (
    <tr>
      <th scope="row" className="py-1.5 pe-2 text-start font-normal">
        {FACTOR_LABELS[f.factor]}
        {f.estimated && <span className="text-muted-foreground"> (est.)</span>}
      </th>
      <td className={cn("py-1.5 pe-2 tabular-nums", f.missing && "text-warning")}>{fmt(f.factor, f.raw)}</td>
      <td className="w-20 py-1.5 pe-2">
        {f.scaled === null ? (
          <span className="text-muted-foreground">scored lower</span>
        ) : f.tied ? (
          <span className="text-muted-foreground">same for all</span>
        ) : (
          <span className="block h-2 rounded-full bg-muted" role="img" aria-label={`${Math.round(f.scaled * 100)} out of 100`}>
            <span className="block h-2 rounded-full bg-primary" style={{ width: `${Math.max(4, f.scaled * 100)}%` }} />
          </span>
        )}
      </td>
      <td className="py-1.5 text-end tabular-nums">{Math.round(f.weight * 100)}%</td>
    </tr>
  );
}
