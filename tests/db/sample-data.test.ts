import { beforeAll, describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import { buildSampleSql } from "../../scripts/sample-data/generate";
import { DEALS, PLACES } from "../../scripts/sample-data/data";
import { caloriesPlausible } from "@/lib/pipeline/validate";
import { asRole, freshDb } from "./harness";

let db: PGlite;
const count = async (sql: string) => (await db.query<{ n: number }>(`select count(*)::int as n from (${sql}) x`)).rows[0].n;

beforeAll(async () => {
  db = await freshDb({ sample: true });
});

describe("sample data seed", () => {
  test("the committed seed matches the generator (regenerate with npm run sample:generate)", () => {
    const file = readFileSync(new URL("../../supabase/seeds/03_sample_data.sql", import.meta.url), "utf8");
    expect(file).toBe(buildSampleSql());
  });

  test("12–15 fictional places across at least 8 areas, all flagged and published", async () => {
    expect(PLACES.length).toBeGreaterThanOrEqual(12);
    expect(PLACES.length).toBeLessThanOrEqual(15);
    expect(await count("select 1 from places where is_sample and status = 'published'")).toBe(PLACES.length);
    expect(await count("select distinct area_id from places where area_id is not null")).toBeGreaterThanOrEqual(8);
    expect(await count("select 1 from places where not is_sample")).toBe(0);
    expect(await count("select 1 from menu_items where not is_sample")).toBe(0);
    expect(await count("select 1 from deals where not is_sample")).toBe(0);
  });

  test("every price, nutrition, bean and deal row has a source; estimates state their assumptions", async () => {
    expect(await count("select 1 from item_prices where source_id is null")).toBe(0);
    expect(await count("select 1 from nutrition_info where source_id is null or (confidence = 'estimated' and assumptions is null)")).toBe(0);
    expect(await count("select 1 from bean_info where source_id is null")).toBe(0);
    expect(await count("select 1 from deals where source_id is null")).toBe(0);
    expect(await count("select 1 from deals")).toBe(DEALS.length);
  });

  test("sample nutrition passes the validator's plausibility check", async () => {
    const rows = (
      await db.query<{ calories_kcal: number; volume_ml: number; has_milk: boolean }>(
        "select n.calories_kcal, s.volume_ml, mi.has_milk from nutrition_info n join item_sizes s on s.id = n.item_size_id join menu_items mi on mi.id = s.menu_item_id",
      )
    ).rows;
    expect(rows.length).toBeGreaterThan(150);
    for (const r of rows) expect(caloriesPlausible(r.calories_kcal, r.volume_ml, r.has_milk)).toEqual({ ok: true });
  });

  test("the current-menu view, freshness decay and effective price all work on sample data", async () => {
    expect(await count("select 1 from v_current_menu where place_is_sample")).toBe(await count("select 1 from item_prices"));
    // Valencia Velvet's prices were "verified" 52 days ago as community_reported -> shown as estimated.
    const stale = await db.query<{ price_confidence: string }>("select distinct price_confidence from v_current_menu where place_slug = 'valencia-velvet-coffee'");
    expect(stale.rows).toEqual([{ price_confidence: "estimated" }]);

    const r = await db.query<{ base_price_pkr: number; discount_pkr: number; deal_title: string }>(
      `select d.* from item_sizes s join menu_items mi on mi.id = s.menu_item_id join places p on p.id = mi.place_id,
              lateral effective_price_detail(s.id, array[(select id from payment_methods where name = 'Bank Alfalah')],
                                             date_trunc('week', now() at time zone 'Asia/Karachi')::date + time '10:00' at time zone 'Asia/Karachi') d
        where p.slug = 'saffron-steam-coffee' and mi.display_name = 'Cafe Latte' and s.size_label = 'Regular'`,
    );
    const { base_price_pkr, discount_pkr, deal_title } = r.rows[0];
    expect(deal_title).toBe("20% off with Bank Alfalah cards");
    expect(discount_pkr).toBe(Math.min(Math.round(base_price_pkr * 0.2), 300));
  });

  test("anon users can read sample places (they're published)", async () => {
    const n = await asRole(db, "anon", {}, async (tx) => (await tx.query("select 1 from places")).rows.length);
    expect(n).toBe(PLACES.length);
  });

  test("purge removes every sample row and leaves reference data alone", async () => {
    const before = await count("select 1 from drink_types");
    const r = await db.query<{ result: Record<string, number> }>("select purge_sample_data() as result");
    expect(r.rows[0].result).toMatchObject({ places: PLACES.length, deals: DEALS.length, brands: 1 });
    for (const t of ["places", "menu_items", "item_sizes", "item_prices", "nutrition_info", "bean_info", "deals", "brands", "place_hours"]) {
      expect(await count(`select 1 from ${t}`)).toBe(0);
    }
    expect(await count("select 1 from sources where slug = 'sample-data'")).toBe(0);
    expect(await count("select 1 from drink_types")).toBe(before);
  });
});
