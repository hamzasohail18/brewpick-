import { beforeAll, describe, expect, test } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { ANON, pgliteDb, withActor, type Db } from "@/lib/db/core";
import { dealStatus, effectivePrice, lahoreNow } from "@/lib/deals/engine";
import { loadDeals } from "@/lib/deals/repo";
import { searchPlaces } from "@/lib/explore/repo";
import { DEALS } from "../../scripts/sample-data/data";
import { freshDb } from "../db/harness";

let pg: PGlite;
let db: Db;
const asAnon = <T>(fn: (tx: Db) => Promise<T>) => withActor(db, ANON, fn);

beforeAll(async () => {
  pg = await freshDb({ sample: true });
  db = pgliteDb(pg);
});

describe("loadDeals", () => {
  test("all live deals, brand-wide ones listing every branch", async () => {
    const deals = await asAnon((tx) => loadDeals(tx));
    expect(deals).toHaveLength(DEALS.length);
    const hbl = deals.find((d) => d.title === "15% off with HBL cards")!;
    expect(hbl).toMatchObject({ isBrandWide: true, brandName: "Brew Bazaar", placeId: null, paymentMethods: ["HBL"] });
    expect(hbl.places.map((p) => p.branchName).sort()).toEqual(["DHA Phase 5", "Gulberg", "Johar Town"]);
    // sorted by end date: the deal ending tomorrow comes first
    expect(deals[0].title).toBe("30% off with Standard Chartered");
  });

  test("card names line up with card ids", async () => {
    await pg.exec(`insert into deal_payment_methods (deal_id, payment_method_id)
                   select d.id, pm.id from deals d, payment_methods pm where d.title = '20% off with Bank Alfalah cards' and pm.name = 'Allied Bank'`);
    const d = (await asAnon((tx) => loadDeals(tx))).find((x) => x.title === "20% off with Bank Alfalah cards")!;
    const names = new Map((await db.query<{ id: number; name: string }>("select id, name from payment_methods")).map((r) => [r.id, r.name]));
    expect(d.paymentMethods).toEqual(["Allied Bank", "Bank Alfalah"]);
    expect(d.paymentMethodIds.map((id) => names.get(id))).toEqual(d.paymentMethods);
  });

  test("scoped to places: own deals plus brand-wide; upcoming and unpublished left out", async () => {
    const [johar] = await db.query<{ id: string }>("select id from places where slug = 'brew-bazaar-johar-town'");
    await pg.exec(`update deals set valid_from = current_date + 2 where title = 'Rs. 200 off on Foodpanda'`);
    const deals = await asAnon((tx) => loadDeals(tx, { placeIds: [johar.id] }));
    expect(deals.map((d) => d.title)).toEqual(["15% off with HBL cards"]);
    expect(await asAnon((tx) => loadDeals(tx, { placeIds: [] }))).toEqual([]);
  });

  test("Explore results carry each place's deal rules, so cards change the price on the phone", async () => {
    const places = await asAnon((tx) => searchPlaces(tx, { drink: "latte" }));
    const gulberg = places.find((p) => p.slug === "brew-bazaar-gulberg")!;
    expect(gulberg.deals.map((d) => d.title)).toEqual(["15% off with HBL cards"]);
    const [hbl] = await db.query<{ id: number }>("select id from payment_methods where name = 'HBL'");
    const cup = { pricePkr: gulberg.cheapest!.pricePkr, menuItemId: gulberg.cheapest!.menuItemId, placeId: gulberg.id, brandId: gulberg.brandId, channel: gulberg.cheapest!.channel };
    expect(effectivePrice(cup, gulberg.deals, []).discountPkr).toBe(0);
    expect(effectivePrice(cup, gulberg.deals, [hbl.id]).effectivePricePkr).toBe(cup.pricePkr - Math.min(250, Math.round(cup.pricePkr * 0.15)));
    expect(dealStatus(gulberg.deals[0], [hbl.id], lahoreNow())).toMatchObject({ usable: true, onNow: true, today: true });
    expect(dealStatus(gulberg.deals[0], [], lahoreNow()).usable).toBe(false);
  });
});
