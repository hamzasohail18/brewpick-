// "Pick for me" decision engine (Section 3E). Pure and deterministic: candidates + answers + context in,
// ranked picks with a full breakdown out. Runs on the phone so location and saved cards stay there.
//
// Scoring, in plain words:
//  1. Hard filters: drink style, budget (price after deals), distance limit, open now, and only prices
//     that have a source (Section 9: never rank on data that lacks a source).
//  2. Eight factors, each scaled 0..1 across the remaining candidates (best = 1, worst = 0).
//  3. Weighted sum with weights set by the goal.
//  4. Missing data is never a zero: the factor is left out of the sum and the total is reduced in
//     proportion to the weight that was missing, and the breakdown says so.
//  5. Best drink per place, then the top three places (so the alternates are real alternatives).

import { effectivePrice, lahoreNow, type Channel, type DealRule } from "@/lib/deals/engine";
import { openStatus, type HoursRow } from "@/lib/explore/hours";
import { distanceM, travelEstimate, type TravelEstimate } from "@/lib/explore/travel";
import type { ConfidenceLevel } from "@/lib/domain/sources";

// ---------- inputs ----------

export const GOALS = ["cheapest", "healthiest", "strongest", "beans", "deal"] as const;
export type Goal = (typeof GOALS)[number];

export const STYLES = ["hot-milk", "hot-black", "iced-milk", "iced-black", "any"] as const;
export type Style = (typeof STYLES)[number];

export interface Answers {
  /** Most the user wants to pay after deals; null = no limit. */
  budgetMax: number | null;
  goal: Goal;
  style: Style;
  /** Distance limit in km; null = anywhere. */
  maxKm: number | null;
}

export interface Candidate {
  sizeId: string;
  menuItemId: string;
  placeId: string;
  brandId: string | null;
  placeSlug: string;
  placeName: string;
  branchName: string | null;
  areaName: string | null;
  lat: number;
  lng: number;
  isSample: boolean;
  rating: number | null;
  ratingCount: number;
  /** Place details (incl. rating) came from a registered source. */
  placeSourced: boolean;
  hours: HoursRow[];
  drinkName: string;
  drinkType: string | null;
  size: string;
  volumeMl: number | null;
  temperature: "hot" | "iced" | "both";
  hasMilk: boolean | null;
  channel: Channel;
  pricePkr: number;
  priceConfidence: ConfidenceLevel;
  priceVerifiedAt: string;
  priceSourced: boolean;
  kcal: number | null;
  sugarG: number | null;
  caffeineMg: number | null;
  nutritionConfidence: ConfidenceLevel | null;
  nutritionSourced: boolean;
  beans: { kind: "single_origin" | "blend" | null; roast: string | null; arabicaPct: number | null; origin: string | null; sourced: boolean } | null;
}

export interface Context {
  cards: readonly number[];
  deals: readonly DealRule[];
  origin: { lat: number; lng: number; kind: "gps" | "area"; name?: string } | null;
  now: Date;
}

// ---------- factors and weights ----------

export const FACTORS = ["effectivePrice", "price", "calories", "caffeine", "beans", "distance", "rating", "deal"] as const;
export type Factor = (typeof FACTORS)[number];

export const FACTOR_LABELS: Record<Factor, string> = {
  effectivePrice: "Price after deals",
  price: "Menu price",
  calories: "Calories",
  caffeine: "Caffeine",
  beans: "Bean quality",
  distance: "Distance",
  rating: "Rating",
  deal: "Deal value",
};

/** Higher factor value is better for these; lower is better for the rest. */
const HIGHER_IS_BETTER: Record<Factor, boolean> = {
  effectivePrice: false,
  price: false,
  calories: false,
  caffeine: true,
  beans: true,
  distance: false,
  rating: true,
  deal: true,
};

/** Weights per goal; each row sums to 1. Shown to users in the "why this pick" breakdown. */
export const WEIGHTS: Record<Goal, Record<Factor, number>> = {
  cheapest: { effectivePrice: 0.45, price: 0.1, deal: 0.1, distance: 0.15, rating: 0.1, calories: 0.05, caffeine: 0, beans: 0.05 },
  healthiest: { calories: 0.45, effectivePrice: 0.15, price: 0.05, distance: 0.15, rating: 0.1, deal: 0.05, caffeine: 0, beans: 0.05 },
  strongest: { caffeine: 0.45, effectivePrice: 0.15, price: 0, distance: 0.15, rating: 0.1, beans: 0.1, deal: 0.05, calories: 0 },
  beans: { beans: 0.45, rating: 0.15, effectivePrice: 0.15, price: 0, distance: 0.15, caffeine: 0.05, deal: 0.05, calories: 0 },
  deal: { deal: 0.45, effectivePrice: 0.25, price: 0, distance: 0.15, rating: 0.1, calories: 0.05, caffeine: 0, beans: 0 },
};

/** Share of a missing factor's weight taken off the total (0.5 = half). */
export const MISSING_PENALTY = 0.5;

/** Ratings with few votes are pulled towards this average (simple Bayesian shrinkage). */
const RATING_PRIOR = { mean: 4.0, weight: 20 };

/**
 * Bean quality, 0..1, from what's known (heuristic, documented in the README):
 * Arabica share (60%), single origin vs blend (30%), origin stated (10%).
 */
export function beanScore(b: Candidate["beans"]): number | null {
  if (!b || !b.sourced || (b.arabicaPct === null && b.kind === null)) return null;
  const arabica = (b.arabicaPct ?? 50) / 100;
  const kind = b.kind === "single_origin" ? 1 : b.kind === "blend" ? 0.4 : 0.5;
  return Math.round((0.6 * arabica + 0.3 * kind + 0.1 * (b.origin ? 1 : 0)) * 1000) / 1000;
}

export function shrunkRating(rating: number | null, count: number): number | null {
  if (rating === null) return null;
  return (rating * count + RATING_PRIOR.mean * RATING_PRIOR.weight) / (count + RATING_PRIOR.weight);
}

// ---------- outputs ----------

export interface FactorScore {
  factor: Factor;
  weight: number;
  /** Raw value in natural units (Rs, kcal, mg, m, stars, 0..1 bean score). null = unknown. */
  raw: number | null;
  /** 0..1 within this set of candidates; null when unknown. */
  scaled: number | null;
  /** weight × scaled, on the 0..1 total scale before the missing-data reduction. */
  contribution: number;
  missing: boolean;
  estimated: boolean;
  /** Every candidate had the same value, so this factor didn't separate them. */
  tied: boolean;
}

export interface Pick {
  candidate: Candidate;
  score: number; // 0..100
  factors: FactorScore[];
  /** Total weight of factors with no data for this drink (0..1). */
  missingWeight: number;
  effective: { pricePkr: number; discountPkr: number; dealTitle: string | null };
  distanceM: number | null;
  travel: TravelEstimate | null;
  open: "open" | "unknown";
  reason: string;
  /** Data gaps worth saying out loud ("No calorie data: scored lower"). */
  caveats: string[];
}

export interface PickResult {
  picks: Pick[];
  considered: number;
  excluded: { style: number; budget: number; distance: number; closed: number; unsourced: number };
  notes: string[];
  /** Factors dropped for everyone (e.g. distance without a location), so the weights were rescaled. */
  unusedFactors: Factor[];
}

// ---------- the engine ----------

function matchesStyle(c: Candidate, style: Style): boolean {
  if (style === "any") return true;
  const [temp, milk] = style.split("-") as ["hot" | "iced", "milk" | "black"];
  if (c.temperature !== temp && c.temperature !== "both") return false;
  if (c.hasMilk === null) return false; // unknown: don't guess
  return milk === "milk" ? c.hasMilk : !c.hasMilk;
}

export function pickForMe(candidates: readonly Candidate[], answers: Answers, ctx: Context): PickResult {
  const excluded = { style: 0, budget: 0, distance: 0, closed: 0, unsourced: 0 };
  const notes: string[] = [];
  const now = lahoreNow(ctx.now);

  type Row = { c: Candidate; eff: ReturnType<typeof effectivePrice>; dist: number | null; open: "open" | "unknown" };
  const rows: Row[] = [];
  for (const c of candidates) {
    if (!c.priceSourced) {
      excluded.unsourced++;
      continue;
    }
    if (!matchesStyle(c, answers.style)) {
      excluded.style++;
      continue;
    }
    const eff = effectivePrice(
      { pricePkr: c.pricePkr, menuItemId: c.menuItemId, placeId: c.placeId, brandId: c.brandId, channel: c.channel },
      ctx.deals,
      ctx.cards,
      now,
    );
    if (answers.budgetMax !== null && eff.effectivePricePkr > answers.budgetMax) {
      excluded.budget++;
      continue;
    }
    const dist = ctx.origin ? distanceM(ctx.origin, c) : null;
    if (answers.maxKm !== null && dist !== null && dist > answers.maxKm * 1000) {
      excluded.distance++;
      continue;
    }
    const status = openStatus(c.hours, ctx.now);
    if (status.state === "closed") {
      excluded.closed++;
      continue;
    }
    rows.push({ c, eff, dist, open: status.state === "open" ? "open" : "unknown" });
  }
  if (answers.maxKm !== null && !ctx.origin) notes.push("We don't know where you are, so the distance limit wasn't applied.");

  // Raw factor values (null = unknown for this drink).
  const raw = (r: Row): Record<Factor, number | null> => ({
    effectivePrice: r.eff.effectivePricePkr,
    price: r.c.pricePkr,
    calories: r.c.nutritionSourced ? r.c.kcal : null,
    caffeine: r.c.nutritionSourced ? r.c.caffeineMg : null,
    beans: beanScore(r.c.beans),
    distance: r.dist,
    rating: r.c.placeSourced ? shrunkRating(r.c.rating, r.c.ratingCount) : null,
    deal: r.eff.discountPkr,
  });
  const values = rows.map(raw);

  // Scale each factor 0..1 across this candidate set; drop factors nobody has data for.
  const weights = WEIGHTS[answers.goal];
  const unusedFactors = FACTORS.filter((f) => weights[f] > 0 && values.every((v) => v[f] === null));
  const range = Object.fromEntries(
    FACTORS.map((f) => {
      const known = values.map((v) => v[f]).filter((x): x is number => x !== null);
      return [f, known.length ? [Math.min(...known), Math.max(...known)] : null];
    }),
  ) as Record<Factor, [number, number] | null>;
  const activeWeight = FACTORS.reduce((s, f) => s + (unusedFactors.includes(f) ? 0 : weights[f]), 0);

  const scored = rows.map((r, i) => {
    const v = values[i];
    let total = 0;
    let knownWeight = 0;
    let missingWeight = 0;
    const factors: FactorScore[] = [];
    for (const f of FACTORS) {
      const w = unusedFactors.includes(f) ? 0 : weights[f] / activeWeight; // rescaled so weights sum to 1
      if (w === 0) continue;
      const x = v[f];
      const rg = range[f];
      if (x === null || !rg) {
        missingWeight += w;
        factors.push({ factor: f, weight: w, raw: null, scaled: null, contribution: 0, missing: true, estimated: false, tied: false });
        continue;
      }
      // Everyone equal: the factor can't separate them, so it scores full marks for all.
      const s = rg[1] === rg[0] ? 1 : HIGHER_IS_BETTER[f] ? (x - rg[0]) / (rg[1] - rg[0]) : (rg[1] - x) / (rg[1] - rg[0]);
      total += w * s;
      knownWeight += w;
      const estimated = (f === "calories" || f === "caffeine") && r.c.nutritionConfidence === "estimated";
      factors.push({ factor: f, weight: w, raw: x, scaled: s, contribution: w * s, missing: false, estimated, tied: rg[1] === rg[0] });
    }
    // Known factors are averaged by their weight, then the missing share costs MISSING_PENALTY of itself.
    const base = knownWeight > 0 ? total / knownWeight : 0;
    const score = base * (1 - MISSING_PENALTY * missingWeight);
    return { r, factors, missingWeight, score };
  });

  // Best drink per place, then the top three places. Ties: price after deals, then name (deterministic).
  const bestPerPlace = new Map<string, (typeof scored)[number]>();
  for (const s of scored) {
    const cur = bestPerPlace.get(s.r.c.placeId);
    if (!cur || better(s, cur)) bestPerPlace.set(s.r.c.placeId, s);
  }
  const top = [...bestPerPlace.values()].sort((a, b) => (better(a, b) ? -1 : 1)).slice(0, 3);

  const picks: Pick[] = top.map((s) => {
    const caveats = s.factors
      .filter((f) => f.missing && f.weight >= 0.1)
      .map((f) => `No ${FACTOR_LABELS[f.factor].toLowerCase()} data: scored lower`);
    if (s.factors.some((f) => f.estimated && f.weight >= 0.1)) caveats.push("Calories and caffeine are estimated from the recipe");
    if (s.r.c.priceConfidence === "estimated") caveats.push("Price not confirmed in the last 30 days");
    if (s.r.open === "unknown") caveats.push("Opening hours not known");
    if (s.r.c.isSample) caveats.push("Sample data (fictional)");
    const pick: Pick = {
      candidate: s.r.c,
      score: Math.round(s.score * 1000) / 10,
      factors: s.factors,
      missingWeight: s.missingWeight,
      effective: { pricePkr: s.r.eff.effectivePricePkr, discountPkr: s.r.eff.discountPkr, dealTitle: s.r.eff.deal?.title ?? null },
      distanceM: s.r.dist,
      travel: s.r.dist !== null && ctx.origin?.kind === "gps" ? travelEstimate(s.r.dist) : null,
      open: s.r.open,
      reason: "",
      caveats,
    };
    return pick;
  });
  picks.forEach((p, i) => (p.reason = i === 0 ? leadReason(p, answers.goal, picks, ctx) : altReason(p, picks[0], answers.goal)));

  if (rows.length === 0) notes.push("Nothing matched. Try a bigger budget, a wider distance, or any drink style.");
  return { picks, considered: rows.length, excluded, notes, unusedFactors };

  function better(a: { score: number; r: Row }, b: { score: number; r: Row }) {
    if (a.score !== b.score) return a.score > b.score;
    if (a.r.eff.effectivePricePkr !== b.r.eff.effectivePricePkr) return a.r.eff.effectivePricePkr < b.r.eff.effectivePricePkr;
    return a.r.c.sizeId < b.r.c.sizeId;
  }
}

// ---------- reasons ----------

const pkrFmt = new Intl.NumberFormat("en-PK");
const rs = (n: number) => `Rs ${pkrFmt.format(n)}`;

function where(p: Pick, ctx: Context): string | null {
  if (p.travel) return `${p.travel.minutes} min ${p.travel.mode === "walk" ? "walk" : "drive"} away`;
  if (p.distanceM !== null) return `${p.distanceM < 1000 ? `${p.distanceM} m` : `${(p.distanceM / 1000).toFixed(1)} km`} from ${ctx.origin?.name ?? "you"}`;
  return null;
}

/** One line for the top pick, led by what the goal cares about. */
function leadReason(p: Pick, goal: Goal, all: Pick[], ctx: Context): string {
  const c = p.candidate;
  const parts: string[] = [];
  const others = all.slice(1);
  switch (goal) {
    case "cheapest":
      parts.push(
        p.effective.discountPkr > 0
          ? `${rs(p.effective.pricePkr)} after ${p.effective.dealTitle}`
          : `${rs(p.effective.pricePkr)}${others.length ? `, ${rs(Math.min(...others.map((o) => o.effective.pricePkr)) - p.effective.pricePkr)} less than the next pick` : ""}`,
      );
      break;
    case "deal":
      parts.push(p.effective.discountPkr > 0 ? `${rs(p.effective.discountPkr)} cheaper with ${p.effective.dealTitle}` : `No deal applies; best price is ${rs(p.effective.pricePkr)}`);
      break;
    case "healthiest":
      parts.push(c.kcal !== null && c.nutritionSourced ? `${c.kcal} kcal${c.nutritionConfidence === "estimated" ? " (estimated)" : ""}, ${c.sugarG ?? "?"} g sugar` : "Calories not known");
      break;
    case "strongest":
      parts.push(c.caffeineMg !== null && c.nutritionSourced ? `${c.caffeineMg} mg caffeine${c.nutritionConfidence === "estimated" ? " (estimated)" : ""}` : "Caffeine not known");
      break;
    case "beans": {
      const b = c.beans;
      parts.push(
        b && b.sourced
          ? [b.kind === "single_origin" ? `Single-origin${b.origin ? ` ${b.origin}` : ""}` : `${b.origin ?? "House"} blend`, b.roast ? `${b.roast.replace("_", "-")} roast` : null, b.arabicaPct !== null ? `${b.arabicaPct}% Arabica` : null]
              .filter(Boolean)
              .join(", ")
          : "Bean details not known",
      );
      break;
    }
  }
  if (goal !== "cheapest" && goal !== "deal") parts.push(rs(p.effective.pricePkr));
  const w = where(p, ctx);
  if (w) parts.push(w);
  return parts.join(", ");
}

/** One line for an alternate: the trade-off against the top pick. */
function altReason(p: Pick, top: Pick, goal: Goal): string {
  const diffs: string[] = [];
  const dp = p.effective.pricePkr - top.effective.pricePkr;
  if (dp !== 0) diffs.push(dp < 0 ? `${rs(-dp)} cheaper` : `${rs(dp)} more`);
  const k1 = p.candidate.nutritionSourced ? p.candidate.kcal : null;
  const k0 = top.candidate.nutritionSourced ? top.candidate.kcal : null;
  if ((goal === "healthiest" || goal === "cheapest") && k1 !== null && k0 !== null && k1 !== k0) diffs.push(k1 < k0 ? `${k0 - k1} fewer kcal` : `${k1 - k0} more kcal`);
  const c1 = p.candidate.nutritionSourced ? p.candidate.caffeineMg : null;
  const c0 = top.candidate.nutritionSourced ? top.candidate.caffeineMg : null;
  if (goal === "strongest" && c1 !== null && c0 !== null && c1 !== c0) diffs.push(c1 > c0 ? `${c1 - c0} mg more caffeine` : `${c0 - c1} mg less caffeine`);
  if (p.distanceM !== null && top.distanceM !== null && Math.abs(p.distanceM - top.distanceM) >= 300) {
    const d = (Math.abs(p.distanceM - top.distanceM) / 1000).toFixed(1);
    diffs.push(p.distanceM < top.distanceM ? `${d} km closer` : `${d} km further`);
  }
  if (p.effective.discountPkr > 0) diffs.push(`with ${p.effective.dealTitle}`);
  return diffs.length ? diffs.join(", ") : "Close second on every measure";
}
