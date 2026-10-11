import { beforeAll, describe, expect, test } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { ANON, pgliteDb, withActor, type Db } from "@/lib/db/core";
import { BUDGET_HEADROOM, loadCandidates } from "@/lib/scoring/candidates";
import { pickForMe } from "@/lib/scoring/engine";
import { freshDb } from "../db/harness";

let pg: PGlite;
let db: Db;
const asAnon = <T>(fn: (tx: Db) => Promise<T>) => withActor(db, ANON, fn);

beforeAll(async () => {
  pg = await freshDb({ sample: true });
  db = pgliteDb(pg);
});

describe("loadCandidates", () => {
  test("style and loose budget filters; one row per size; beans and source flags", async () => {
    const { candidates, deals } = await asAnon((tx) => loadCandidates(tx, { style: "iced-black", budgetMax: 500 }));
    expect(candidates.length).toBeGreaterThan(0);
    for (const c of candidates) {
      expect(c.temperature).toBe("iced");
      expect(c.hasMilk).toBe(false);
      expect(c.pricePkr).toBeLessThanOrEqual(500 * BUDGET_HEADROOM);
      expect(c).toMatchObject({ priceSourced: true, nutritionSourced: true, placeSourced: true, isSample: true });
    }
    expect(new Set(candidates.map((c) => c.sizeId)).size).toBe(candidates.length);
    expect(candidates.every((c) => c.drinkType === "cold-brew")).toBe(true);
    const jasmine = candidates.find((c) => c.placeSlug === "jasmine-beans")!;
    expect(jasmine.beans).toEqual({ kind: "single_origin", roast: "light", arabicaPct: 100, origin: "Kenya", sourced: true });
    expect(jasmine.hours).toHaveLength(7);
    expect(deals.every((d) => candidates.some((c) => c.placeId === d.placeId || (d.placeId === null && c.brandId === d.brandId)))).toBe(true);
  });

  test("a price without a source is flagged so the engine refuses to rank it", async () => {
    await pg.exec(`update item_prices set source_id = null where id in (
      select pr.id from item_prices pr join item_sizes s on s.id = pr.item_size_id join menu_items mi on mi.id = s.menu_item_id
       join places p on p.id = mi.place_id where p.slug = 'bahria-bean-kiosk')`);
    const { candidates } = await asAnon((tx) => loadCandidates(tx, { style: "any", budgetMax: null }));
    const bahria = candidates.filter((c) => c.placeSlug === "bahria-bean-kiosk");
    expect(bahria.length).toBeGreaterThan(0);
    expect(bahria.every((c) => !c.priceSourced)).toBe(true);
    const r = pickForMe(candidates, { budgetMax: null, goal: "cheapest", style: "any", maxKm: null }, { cards: [], deals: [], origin: null, now: new Date("2026-10-14T11:00:00+05:00") });
    expect(r.excluded.unsourced).toBe(bahria.length);
    expect(r.picks.map((p) => p.candidate.placeSlug)).not.toContain("bahria-bean-kiosk");
  });

  test("end to end on the sample data: strongest iced black drink is a large cold brew", async () => {
    const { candidates, deals } = await asAnon((tx) => loadCandidates(tx, { style: "iced-black", budgetMax: null }));
    const r = pickForMe(candidates, { budgetMax: null, goal: "strongest", style: "iced-black", maxKm: null }, { cards: [], deals, origin: null, now: new Date("2026-10-14T13:00:00+05:00") });
    expect(r.picks).toHaveLength(3);
    expect(r.picks[0].candidate).toMatchObject({ drinkType: "cold-brew", size: "Large", caffeineMg: 255 });
    expect(r.picks[0].reason).toMatch(/^255 mg caffeine \(estimated\), Rs [\d,]+$/);
    expect(r.picks[0].caveats).toEqual(expect.arrayContaining(["Calories and caffeine are estimated from the recipe", "Sample data (fictional)"]));
  });
});
