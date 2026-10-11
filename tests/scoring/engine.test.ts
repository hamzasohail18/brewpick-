import { describe, expect, test } from "vitest";
import { beanScore, FACTORS, pickForMe, shrunkRating, WEIGHTS, type Answers, type Candidate, type Context, GOALS } from "@/lib/scoring/engine";
import type { DealRule } from "@/lib/deals/engine";

const OPEN_ALL_DAY = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ day_of_week: d, opens_at: "00:00", closes_at: "23:59", is_closed: false }));
const NOW = new Date("2026-10-14T10:00:00+05:00"); // Wednesday morning in Lahore
const HERE = { lat: 31.5, lng: 74.35, kind: "gps" as const };

let n = 0;
function cand(over: Partial<Candidate> = {}): Candidate {
  n++;
  return {
    sizeId: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    menuItemId: `item-${n}`,
    placeId: `place-${n}`,
    brandId: null,
    placeSlug: `place-${n}`,
    placeName: `Place ${n}`,
    branchName: null,
    areaName: "Gulberg",
    lat: 31.5,
    lng: 74.35,
    isSample: false,
    rating: 4.2,
    ratingCount: 100,
    placeSourced: true,
    hours: OPEN_ALL_DAY,
    drinkName: "Latte",
    drinkType: "latte",
    size: "Regular",
    volumeMl: 350,
    temperature: "hot",
    hasMilk: true,
    channel: "dine_in",
    pricePkr: 700,
    priceConfidence: "verified",
    priceVerifiedAt: "2026-10-10T00:00:00Z",
    priceSourced: true,
    kcal: 180,
    sugarG: 14,
    caffeineMg: 126,
    nutritionConfidence: "estimated",
    nutritionSourced: true,
    beans: { kind: "blend", roast: "medium", arabicaPct: 80, origin: "Brazil", sourced: true },
    ...over,
  };
}
const ctx = (over: Partial<Context> = {}): Context => ({ cards: [], deals: [], origin: HERE, now: NOW, ...over });
const ans = (over: Partial<Answers> = {}): Answers => ({ budgetMax: null, goal: "cheapest", style: "any", maxKm: null, ...over });
const east = (km: number) => ({ lat: HERE.lat, lng: HERE.lng + km / 95 }); // ~95 km per degree of longitude at Lahore

describe("weights", () => {
  test("every goal's weights sum to 1 and cover all eight factors", () => {
    for (const g of GOALS) {
      expect(Object.keys(WEIGHTS[g]).sort()).toEqual([...FACTORS].sort());
      expect(Object.values(WEIGHTS[g]).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    }
  });
});

describe("pickForMe", () => {
  test("cheapest goal: lowest price after deals wins; one top pick + two alternates, from different places", () => {
    const cs = [cand({ pricePkr: 900 }), cand({ pricePkr: 500 }), cand({ pricePkr: 700 }), cand({ pricePkr: 800 })];
    const r = pickForMe(cs, ans(), ctx());
    expect(r.picks.map((p) => p.candidate.pricePkr)).toEqual([500, 700, 800]);
    expect(new Set(r.picks.map((p) => p.candidate.placeId)).size).toBe(3);
    expect(r.picks[0].reason).toMatch(/^Rs 500, Rs 200 less than the next pick, 1 min walk away$/);
    expect(r.picks[1].reason).toBe("Rs 200 more");
  });

  test("the best drink per place is used, so a second cheap drink at the same place doesn't take an alternate slot", () => {
    const a1 = cand({ pricePkr: 400 });
    const a2 = cand({ pricePkr: 450, placeId: a1.placeId, placeSlug: a1.placeSlug });
    const b = cand({ pricePkr: 600 });
    const r = pickForMe([a1, a2, b], ans(), ctx());
    expect(r.picks.map((p) => p.candidate.sizeId)).toEqual([a1.sizeId, b.sizeId]);
  });

  test("goals change the winner", () => {
    const cheapSweet = cand({ pricePkr: 500, kcal: 400, caffeineMg: 63 });
    const leanStrong = cand({ pricePkr: 900, kcal: 15, caffeineMg: 255, beans: { kind: "single_origin", roast: "light", arabicaPct: 100, origin: "Ethiopia", sourced: true } });
    const mid = cand({ pricePkr: 700, kcal: 180, caffeineMg: 126 });
    const all = [cheapSweet, leanStrong, mid];
    expect(pickForMe(all, ans({ goal: "cheapest" }), ctx()).picks[0].candidate).toBe(cheapSweet);
    expect(pickForMe(all, ans({ goal: "healthiest" }), ctx()).picks[0].candidate).toBe(leanStrong);
    expect(pickForMe(all, ans({ goal: "strongest" }), ctx()).picks[0].candidate).toBe(leanStrong);
    expect(pickForMe(all, ans({ goal: "beans" }), ctx()).picks[0].candidate).toBe(leanStrong);
    const h = pickForMe(all, ans({ goal: "healthiest" }), ctx()).picks[0];
    expect(h.reason).toMatch(/^15 kcal \(estimated\), 14 g sugar, Rs 900, 1 min walk away$/);
  });

  test("best deal goal uses the user's cards: the deal only counts once they have the card", () => {
    const a = cand({ pricePkr: 800 });
    const b = cand({ pricePkr: 700 });
    const hbl: DealRule = {
      id: "d1", title: "15% off with HBL cards", placeId: a.placeId, brandId: null, discount: "percent", discountValue: 15, maxDiscountPkr: 250,
      minSpendPkr: null, validFrom: "2026-10-01", validTo: "2026-12-31", daysOfWeek: null, startTime: null, endTime: null,
      appliesToAllItems: true, itemIds: [], paymentMethodIds: [7], conditions: [],
    };
    const without = pickForMe([a, b], ans({ goal: "deal" }), ctx({ deals: [hbl] }));
    expect(without.picks[0].candidate).toBe(b);
    const withCard = pickForMe([a, b], ans({ goal: "deal" }), ctx({ deals: [hbl], cards: [7] }));
    expect(withCard.picks[0].candidate).toBe(a);
    expect(withCard.picks[0].effective).toEqual({ pricePkr: 680, discountPkr: 120, dealTitle: "15% off with HBL cards" });
    expect(withCard.picks[0].reason).toBe("Rs 120 cheaper with 15% off with HBL cards, 1 min walk away");
    // Budget is checked against the price after deals.
    const budget = pickForMe([a], ans({ budgetMax: 700 }), ctx({ deals: [hbl], cards: [7] }));
    expect(budget.picks).toHaveLength(1);
    expect(pickForMe([a], ans({ budgetMax: 700 }), ctx({ deals: [hbl] })).excluded.budget).toBe(1);
  });

  test("missing data is down-weighted and labelled, never scored as zero", () => {
    const known = cand({ pricePkr: 700, kcal: 300 });
    const unknown = cand({ pricePkr: 700, kcal: null, sugarG: null, caffeineMg: null });
    const best = cand({ pricePkr: 700, kcal: 100 });
    const r = pickForMe([known, unknown, best], ans({ goal: "healthiest" }), ctx());
    const u = r.picks.find((p) => p.candidate === unknown)!;
    const k = r.picks.find((p) => p.candidate === known)!;
    expect(u.factors.find((f) => f.factor === "calories")).toMatchObject({ missing: true, raw: null, contribution: 0 });
    expect(u.missingWeight).toBeCloseTo(0.45, 5);
    expect(u.caveats).toContain("No calories data: scored lower");
    // Worst-known calories (scaled 0) vs unknown: unknown is not treated as the worst possible value…
    expect(u.score).toBeGreaterThan(k.score);
    // …but it can't beat a drink known to be lighter.
    expect(r.picks[0].candidate).toBe(best);
  });

  test("factors nobody has data for are dropped and the weights rescaled (e.g. no location)", () => {
    const r = pickForMe([cand({ pricePkr: 500 }), cand({ pricePkr: 600 })], ans(), ctx({ origin: null }));
    expect(r.unusedFactors).toEqual(["distance"]);
    expect(r.picks[0].factors.reduce((s, f) => s + f.weight, 0)).toBeCloseTo(1, 10);
    expect(r.picks[0].missingWeight).toBe(0);
    expect(r.picks[0].reason).toBe("Rs 500, Rs 100 less than the next pick");
  });

  test("hard filters: style, distance, closed now; unknown milk is not guessed", () => {
    const icedBlack = cand({ temperature: "iced", hasMilk: false, drinkName: "Cold Brew" });
    const hotMilk = cand();
    const unknownMilk = cand({ hasMilk: null });
    const far = cand({ ...east(8) });
    const closed = cand({ hours: OPEN_ALL_DAY.map((h) => ({ ...h, opens_at: "18:00", closes_at: "23:00" })) });
    const r = pickForMe([icedBlack, hotMilk, unknownMilk, far, closed], ans({ style: "hot-milk", maxKm: 3 }), ctx());
    expect(r.picks.map((p) => p.candidate)).toEqual([hotMilk]);
    expect(r.excluded).toMatchObject({ style: 2, distance: 1, closed: 1 });
    expect(pickForMe([icedBlack, hotMilk], ans({ style: "iced-black" }), ctx()).picks[0].candidate).toBe(icedBlack);
  });

  test("no location: the distance limit is not applied, and the user is told", () => {
    const r = pickForMe([cand({ ...east(8) })], ans({ maxKm: 1 }), ctx({ origin: null }));
    expect(r.picks).toHaveLength(1);
    expect(r.notes).toContain("We don't know where you are, so the distance limit wasn't applied.");
  });

  test("never ranks on data that lacks a source", () => {
    const unsourcedPrice = cand({ pricePkr: 100, priceSourced: false });
    const unsourcedNutrition = cand({ kcal: 5, nutritionSourced: false });
    const ok = cand({ kcal: 200 });
    const r = pickForMe([unsourcedPrice, unsourcedNutrition, ok], ans({ goal: "healthiest" }), ctx());
    expect(r.excluded.unsourced).toBe(1);
    expect(r.picks.map((p) => p.candidate)).not.toContain(unsourcedPrice);
    const p = r.picks.find((x) => x.candidate === unsourcedNutrition)!;
    expect(p.factors.find((f) => f.factor === "calories")!.missing).toBe(true);
    expect(r.picks[0].candidate).toBe(ok);
  });

  test("alternates explain the trade-off against the top pick", () => {
    const top = cand({ pricePkr: 500, kcal: 200 });
    const alt = cand({ pricePkr: 560, kcal: 120, ...east(2) });
    const r = pickForMe([top, alt], ans(), ctx());
    expect(r.picks[1].reason).toBe("Rs 60 more, 80 fewer kcal, 2.0 km further");
  });

  test("deterministic and empty-safe", () => {
    const cs = [cand(), cand(), cand()];
    expect(pickForMe(cs, ans(), ctx()).picks.map((p) => p.candidate.sizeId)).toEqual(pickForMe([...cs].reverse(), ans(), ctx()).picks.map((p) => p.candidate.sizeId));
    const empty = pickForMe([], ans(), ctx());
    expect(empty.picks).toEqual([]);
    expect(empty.notes[0]).toMatch(/^Nothing matched/);
  });
});

describe("helpers", () => {
  test("bean score and rating shrinkage", () => {
    expect(beanScore({ kind: "single_origin", roast: "light", arabicaPct: 100, origin: "Ethiopia", sourced: true })).toBe(1);
    expect(beanScore({ kind: "blend", roast: "dark", arabicaPct: 70, origin: null, sourced: true })).toBe(0.54);
    expect(beanScore({ kind: "blend", roast: null, arabicaPct: 100, origin: "Brazil", sourced: false })).toBeNull();
    expect(beanScore(null)).toBeNull();
    expect(shrunkRating(5, 2)).toBeCloseTo(4.09, 2); // 2 five-star votes barely move it
    expect(shrunkRating(4.6, 300)).toBeCloseTo(4.56, 2);
    expect(shrunkRating(null, 0)).toBeNull();
  });
});

describe("quiz state", async () => {
  const { complete, currentStep, parseQuiz, quizHref } = await import("@/lib/scoring/quiz");
  test("one answer per step; four answers make a result", () => {
    expect(currentStep(parseQuiz({}))).toBe("budget");
    expect(currentStep(parseQuiz({ b: "800" }))).toBe("goal");
    expect(currentStep(parseQuiz({ b: "any", g: "healthiest" }))).toBe("style");
    expect(currentStep(parseQuiz({ b: "any", g: "healthiest", s: "iced-black" }))).toBe("distance");
    const full = parseQuiz(new URLSearchParams("b=800&g=deal&s=hot-milk&d=any"));
    expect(complete(full)).toEqual({ budgetMax: 800, goal: "deal", style: "hot-milk", maxKm: null });
    expect(quizHref(full)).toBe("/pick?b=800&g=deal&s=hot-milk&d=any");
    expect(parseQuiz({ b: "lots", g: "tastiest", s: "warm", d: "-1" })).toEqual({});
  });
});
