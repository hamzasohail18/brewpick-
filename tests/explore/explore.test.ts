import { beforeAll, describe, expect, test } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { ANON, pgliteDb, withActor, type Db } from "@/lib/db/core";
import { getPlaceDetail, searchPlaces } from "@/lib/explore/repo";
import { parseFilters } from "@/lib/explore/filters";
import { DEALS, DRINKS, PLACES } from "../../scripts/sample-data/data";
import { samplePrice } from "../../scripts/sample-data/generate";
import { freshDb } from "../db/harness";

let pg: PGlite;
let db: Db;
const asAnon = <T>(fn: (tx: Db) => Promise<T>) => withActor(db, ANON, fn);
const search = (q: Record<string, string>) => asAnon((tx) => searchPlaces(tx, parseFilters(q)));
const slugs = async (q: Record<string, string>) => (await search(q)).map((p) => p.slug).sort();
const expected = (pred: (p: (typeof PLACES)[number]) => boolean) => PLACES.filter(pred).map((p) => p.slug).sort();

beforeAll(async () => {
  pg = await freshDb({ sample: true });
  db = pgliteDb(pg);
});

describe("searchPlaces", () => {
  test("no filters: every published place, with hours, a cheapest drink and the sample flag", async () => {
    const all = await search({});
    expect(all).toHaveLength(PLACES.length);
    const saffron = all.find((p) => p.slug === "saffron-steam-coffee")!;
    expect(saffron).toMatchObject({ isSample: true, areaName: "Gulberg", hasMenu: true, wifi: true, sourceName: "Sample data (fictional)" });
    expect(saffron.hours).toHaveLength(7);
    expect(saffron.hours[1]).toEqual({ day_of_week: 1, opens_at: "09:00", closes_at: "01:00", is_closed: false });
    expect(saffron.cheapest).toMatchObject({ drinkType: "espresso", size: "Single", channel: "dine_in" });
    expect(saffron.cheapest!.pricePkr).toBe(samplePrice(PLACES[0], DRINKS[0], DRINKS[0].sizes[0]));
    expect(saffron.lightest!.kcal).toBeLessThanOrEqual(saffron.cheapest!.kcal!);
    expect(saffron.matchCount).toBeGreaterThan(10);
    expect(new Date(saffron.cheapest!.priceVerifiedAt).getTime()).toBeLessThan(Date.now());
  });

  test("drink filters: type, price ceiling", async () => {
    expect(await slugs({ drink: "frappe" })).toEqual(expected((p) => p.drinks.includes("frappe")));
    const under = (p: (typeof PLACES)[number], max: number) =>
      p.drinks.some((slug) => DRINKS.find((d) => d.slug === slug)!.sizes.some((s) => samplePrice(p, DRINKS.find((d) => d.slug === slug)!, s) <= max));
    expect(await slugs({ maxPrice: "400" })).toEqual(expected((p) => under(p, 400)));
    const latte = await search({ drink: "latte", maxPrice: "800" });
    for (const p of latte) expect(p.cheapest).toMatchObject({ drinkType: "latte" });
    for (const p of latte) expect(p.cheapest!.pricePkr).toBeLessThanOrEqual(800);
  });

  test("milk alternative, roast and dairy-free", async () => {
    expect(await slugs({ milk: "almond" })).toEqual(expected((p) => p.milkOptions.includes("almond")));
    expect(await slugs({ roast: "light" })).toEqual(expected((p) => p.beans?.roast === "light"));
    // Milky drinks with oat/almond qualify; a latte at a place with neither does not.
    const dairyFreeLatte = await slugs({ drink: "latte", dairyFree: "1" });
    expect(dairyFreeLatte).toEqual(expected((p) => p.drinks.includes("latte") && p.milkOptions.some((m) => m !== "lactose_free")));
  });

  test("avoiding dairy keeps only drinks served without milk", async () => {
    const res = await search({ avoid: "dairy" });
    for (const p of res) expect(["espresso", "americano", "cold-brew"]).toContain(p.cheapest!.drinkType);
    expect(await slugs({ avoid: "dairy", drink: "latte" })).toEqual([]);
  });

  test("calorie and sugar limits skip drinks without data instead of treating them as zero", async () => {
    await pg.exec(`update nutrition_info set calories_kcal = null, sugar_g = null
                    where item_size_id in (select s.id from item_sizes s join menu_items mi on mi.id = s.menu_item_id
                                            join places p on p.id = mi.place_id where p.slug = 'mall-road-mugs')`);
    // (Nothing later in this file reads Mall Road's nutrition.)
    expect(await slugs({ maxKcal: "2000" })).not.toContain("mall-road-mugs");
    expect(await slugs({ maxSugar: "100" })).not.toContain("mall-road-mugs");
    expect(await slugs({})).toContain("mall-road-mugs");
  });

  test("place filters: amenities, deals, type, search text", async () => {
    expect(await slugs({ halal: "1" })).toEqual(expected((p) => p.halal === true));
    expect(await slugs({ driveThru: "1" })).toEqual(expected((p) => p.type === "kiosk_drive_thru"));
    expect(await slugs({ type: "bakery_cafe" })).toEqual(expected((p) => p.type === "bakery_cafe"));
    expect(await slugs({ q: "bazaar" })).toEqual(expected((p) => p.brand === "brew-bazaar"));
    expect(await slugs({ q: "Johar" })).toEqual(expected((p) => p.area === "Johar Town"));
    expect(await slugs({ q: "100%_" })).toEqual([]); // LIKE wildcards are escaped

    const withDeals = expected((p) => DEALS.some((d) => d.place === p.slug || (d.brand && d.brand === p.brand)));
    expect(await slugs({ deals: "1" })).toEqual(withDeals);
    const johar = (await search({ q: "Johar" })).find((p) => p.slug === "brew-bazaar-johar-town");
    expect(johar?.dealCount).toBe(2); // brand-wide HBL + its own Foodpanda deal
  });

  test("the public never sees drafts, expired deals or deals that haven't started", async () => {
    await pg.exec(`insert into places (slug, name, type, lat, lng, status) values ('draft-cafe', 'Draft Cafe', 'chain', 31.5, 74.3, 'draft')`);
    await pg.exec(`update deals set valid_to = current_date - 1, valid_from = current_date - 30 where title like '30% off with Standard Chartered'`);
    await pg.exec(`update deals set valid_from = current_date + 3 where title = 'Student 10% off'`);
    expect(await slugs({})).not.toContain("draft-cafe");
    expect(await slugs({ deals: "1" })).not.toContain("jasmine-beans");
    expect(await slugs({ deals: "1" })).not.toContain("lantern-lane-espresso");
    expect(await asAnon((tx) => getPlaceDetail(tx, "draft-cafe"))).toBeNull();
    const jasmine = await asAnon((tx) => getPlaceDetail(tx, "jasmine-beans"));
    expect(jasmine!.deals).toEqual([]);
  });
});

describe("getPlaceDetail", () => {
  test("menu grouped by item and size, with sources, assumptions, milk options and allergens", async () => {
    const p = (await asAnon((tx) => getPlaceDetail(tx, "saffron-steam-coffee")))!;
    expect(p).toMatchObject({ name: "Saffron Steam Coffee", isSample: true, areaName: "Gulberg", hasMenu: true });
    expect(p.menu).toHaveLength(DRINKS.length);
    const latte = p.menu.find((m) => m.drinkType === "latte")!;
    expect(latte.sizes.map((s) => s.label)).toEqual(["Regular", "Large"]);
    const regular = latte.sizes[0];
    expect(regular.prices).toHaveLength(1);
    expect(regular.prices[0]).toMatchObject({ channel: "dine_in", taxInclusive: true, confidence: "verified", sourceName: "Sample data (fictional)" });
    expect(regular.prices[0].pricePer100ml).toBeCloseTo(regular.prices[0].pricePkr / 3.5, 0);
    expect(regular.nutrition).toMatchObject({ confidence: "estimated" });
    expect(regular.nutrition!.assumptions).toMatch(/^Sample estimate: 2 espresso shots, 290 ml full-fat milk/);
    expect(latte.milkOptions.map((o) => o.slug).sort()).toEqual(["almond", "lactose_free", "oat"]);
    expect(latte.milkOptions.find((o) => o.slug === "almond")!.extraKcal).toBeLessThan(0);
    expect(latte.allergens.map((a) => a.code)).toEqual(["dairy"]);
    expect(latte.ingredients).toContain("espresso");
    expect(p.menu.find((m) => m.drinkType === "espresso")!.allergens).toEqual([]);
    expect(p.beans).toEqual([expect.objectContaining({ kind: "single_origin", originCountry: "Ethiopia", roast: "light", arabicaPct: 100 })]);
  });

  test("active deals with cards, conditions, items and source; brand-wide deals included", async () => {
    const saffron = (await asAnon((tx) => getPlaceDetail(tx, "saffron-steam-coffee")))!;
    expect(saffron.deals).toEqual([
      expect.objectContaining({ title: "20% off with Bank Alfalah cards", paymentMethods: ["Bank Alfalah"], daysOfWeek: [1, 2, 3, 4], maxDiscountPkr: 300, isBrandWide: false, isSample: true }),
    ]);
    expect(saffron.deals[0].validTo).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(saffron.deals[0].sourceUrl).toBe("https://brewpick.example/sample-data");

    const johar = (await asAnon((tx) => getPlaceDetail(tx, "brew-bazaar-johar-town")))!;
    expect(johar.brandName).toBe("Brew Bazaar");
    expect(johar.deals.map((d) => [d.title, d.isBrandWide])).toEqual(
      expect.arrayContaining([["15% off with HBL cards", true], ["Rs. 200 off on Foodpanda", false]]),
    );
    expect(johar.deals.find((d) => d.title.includes("Foodpanda"))!.conditions).toEqual(["delivery_only"]);

    const canal = (await asAnon((tx) => getPlaceDetail(tx, "canal-side-coffee-co")))!;
    expect(canal.deals[0]).toMatchObject({ discount: "bogo", items: ["Cold Brew"], startTime: null });
    const quick = (await asAnon((tx) => getPlaceDetail(tx, "quick-cuppa-drive-thru")))!;
    expect(quick.deals[0]).toMatchObject({ startTime: "22:00", endTime: "03:00" });
  });

  test("unknown slug", async () => {
    expect(await asAnon((tx) => getPlaceDetail(tx, "nope"))).toBeNull();
  });
});
