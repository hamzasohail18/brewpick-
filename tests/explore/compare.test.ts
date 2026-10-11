import { beforeAll, describe, expect, test } from "vitest";
import { ANON, pgliteDb, withActor, type Db } from "@/lib/db/core";
import { bestIndices } from "@/lib/compare/best";
import { compareHref, parseCompare } from "@/lib/compare/params";
import { defaultDrink, getComparison, shareText } from "@/lib/compare/repo";
import { DRINKS, PLACES } from "../../scripts/sample-data/data";
import { samplePrice } from "../../scripts/sample-data/generate";
import { freshDb } from "../db/harness";

const UUID_A = "11111111-1111-4111-8111-111111111111";

describe("compare params", () => {
  test("drops junk, dedupes and caps at 4 columns", () => {
    const sel = parseCompare(new URLSearchParams(`items=${UUID_A},nope,${UUID_A.toUpperCase()}&places=a-cafe,b,c,d,e,BAD!&drink=latte`));
    expect(sel).toEqual({ items: [UUID_A], places: ["a-cafe", "b", "c"], drink: "latte" });
    expect(parseCompare({ places: ["x", "y"], drink: "<script>" })).toEqual({ items: [], places: ["x", "y"], drink: null });
  });

  test("builds a readable share link", () => {
    expect(compareHref({ places: ["a", "b"], drink: "latte" })).toBe("/compare?places=a,b&drink=latte");
    expect(compareHref({ items: [UUID_A], drink: "latte" })).toBe(`/compare?items=${UUID_A}`);
    expect(compareHref({})).toBe("/compare");
  });
});

describe("bestIndices", () => {
  test("lowest/highest wins, ties share it, missing never wins", () => {
    expect([...bestIndices([700, 650, null, 650], "lower")]).toEqual([1, 3]);
    expect([...bestIndices([120, null, 190], "higher")]).toEqual([2]);
    expect(bestIndices([500, 500], "lower").size).toBe(0); // all equal: nothing stands out
    expect(bestIndices([500, null], "lower").size).toBe(0); // nothing to compare against
  });
});

describe("getComparison", () => {
  let db: Db;
  const asAnon = <T>(fn: (tx: Db) => Promise<T>) => withActor(db, ANON, fn);

  beforeAll(async () => {
    db = pgliteDb(await freshDb({ sample: true }));
  });

  test("same drink across three places: regular size, prices, nutrition, beans, sources", async () => {
    const places = ["saffron-steam-coffee", "mall-road-mugs", "quick-cuppa-drive-thru"];
    const res = await asAnon((tx) => getComparison(tx, { items: [], places, drink: "latte" }));
    expect(res.drink).toEqual({ slug: "latte", name: "Latte" });
    expect(res.columns.map((c) => c.place.slug)).toEqual(places);
    const latte = DRINKS.find((d) => d.slug === "latte")!;
    for (const c of res.columns) {
      const p = PLACES.find((x) => x.slug === c.place.slug)!;
      expect(c.drink).toMatchObject({ drinkType: "latte", size: "Regular", volumeMl: 350, channel: "dine_in", priceSourceName: "Sample data (fictional)" });
      expect(c.drink!.pricePkr).toBe(samplePrice(p, latte, latte.sizes[0]));
      expect(c.drink!.kcal).toBeGreaterThan(100);
      expect(c.drink!.nutritionConfidence).toBe("estimated");
      expect(c.drink!.pricePer100ml).toBeCloseTo(c.drink!.pricePkr / 3.5, 0);
      expect(c.place.isSample).toBe(true);
    }
    expect(res.columns[0].beans).toMatchObject({ roast: "light", origin: "Ethiopia" });
    expect(res.columns[1].beans).toBeNull();
    expect(shareText(res)).toMatch(/^Latte compared on BrewPick Lahore\n• Saffron Steam Coffee: Cafe Latte Regular, Rs [\d,]+/);
    expect(shareText(res)).toContain("fictional sample data");
  });

  test("a place that doesn't serve the drink still gets a column, marked as missing", async () => {
    const res = await asAnon((tx) => getComparison(tx, { items: [], places: ["mall-road-mugs", "bahria-bean-kiosk"], drink: "cappuccino" }));
    expect(res.columns.map((c) => [c.place.slug, c.drink?.drinkType ?? null])).toEqual([
      ["mall-road-mugs", "cappuccino"],
      ["bahria-bean-kiosk", null],
    ]);
  });

  test("effective price applies a deal open to everyone, and card deals only with that card", async () => {
    // Lantern Lane's student deal has no card requirement (10% off); Ravi's Meezan deal needs the card.
    const open = await asAnon((tx) => getComparison(tx, { items: [], places: ["lantern-lane-espresso"], drink: "latte" }));
    const d = open.columns[0].drink!;
    expect(d.dealTitle).toBe("Student 10% off");
    expect(d.effectivePricePkr).toBe(d.pricePkr - Math.round(d.pricePkr * 0.1));

    const large = await asAnon((tx) => getComparison(tx, { items: [], places: ["ravi-roast-house"], drink: "mocha" }));
    expect(large.columns[0].drink!.effectivePricePkr).toBe(large.columns[0].drink!.pricePkr);
    const [meezan] = await db.query<{ id: number }>("select id from payment_methods where name = 'Meezan Bank'");
    const withCard = await asAnon((tx) => getComparison(tx, { items: [], places: ["ravi-roast-house"], drink: "mocha" }, [meezan.id]));
    expect(withCard.columns[0].drink!.discountPkr).toBe(150);
  });

  test("specific sizes by id, in the order given, mixed with places", async () => {
    const sizes = await db.query<{ id: string; slug: string }>(
      `select s.id, p.slug from item_sizes s join menu_items mi on mi.id = s.menu_item_id join places p on p.id = mi.place_id
        join drink_types dt on dt.id = mi.drink_type_id where dt.slug = 'cold-brew' and s.size_label = 'Large' order by p.slug limit 2`,
    );
    const res = await asAnon((tx) => getComparison(tx, { items: [sizes[1].id, sizes[0].id], places: ["kite-and-cup"], drink: "espresso" }));
    expect(res.columns.map((c) => c.drink?.drinkType)).toEqual(["cold-brew", "cold-brew", "espresso"]);
    expect(res.columns[0].place.slug).toBe(sizes[1].slug);
    expect(res.columns[0].drink!.size).toBe("Large");
  });

  test("hidden from the public: draft places and unknown ids are skipped", async () => {
    await db.query("update places set status = 'draft' where slug = 'crumb-and-crema'");
    const res = await asAnon((tx) => getComparison(tx, { items: [UUID_A], places: ["crumb-and-crema", "kite-and-cup"], drink: "latte" }));
    expect(res.columns.map((c) => c.place.slug)).toEqual(["kite-and-cup"]);
  });

  test("default drink: the one most of the places serve, latte first on ties", async () => {
    expect(await asAnon((tx) => defaultDrink(tx, ["saffron-steam-coffee", "kite-and-cup"]))).toBe("latte");
    expect(await asAnon((tx) => defaultDrink(tx, ["quick-cuppa-drive-thru", "bahria-bean-kiosk"]))).toBe("latte");
  });
});
