import { beforeAll, describe, expect, test } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { pgliteDb, type Db } from "@/lib/db/core";
import { dealDiscountPkr, effectivePrice, lahoreNow, type Channel } from "@/lib/deals/engine";
import { loadDeals, toRule } from "@/lib/deals/repo";
import { freshDb } from "../db/harness";

let pg: PGlite;
let db: Db;

beforeAll(async () => {
  pg = await freshDb({ sample: true });
  db = pgliteDb(pg);
  // Extra deals for the edge cases the sample seed doesn't cover.
  await pg.exec(`
    insert into deals (id, place_id, title, deal_type, discount, discount_value, valid_from, valid_to, status, source_url)
    select '00000000-0000-4000-8000-000000000001', id, 'Fixed price latte', 'combo', 'fixed_price', 499, current_date - 1, current_date + 30, 'published', 'https://example.test/a'
      from places where slug = 'mall-road-mugs';
    insert into deals (id, place_id, title, deal_type, discount, discount_value, valid_from, valid_to, status, source_url)
    select '00000000-0000-4000-8000-000000000002', id, '12.5% rounding test', 'other', 'percent', 12.5, current_date - 1, current_date + 30, 'published', 'https://example.test/b'
      from places where slug = 'crumb-and-crema';
    insert into deals (id, place_id, title, deal_type, discount, discount_value, valid_from, valid_to, status, source_url)
    select '00000000-0000-4000-8000-000000000003', id, 'Free cookie', 'combo', 'free_item', null, current_date - 1, current_date + 30, 'published', 'https://example.test/c'
      from places where slug = 'bahria-bean-kiosk';
    -- Two deals with the same discount: the lower id must win in both engines.
    insert into deals (id, place_id, title, deal_type, discount, discount_value, valid_from, valid_to, status, source_url)
    select v.id::uuid, p.id, v.title, 'other', 'flat_pkr', 100, current_date - 1, current_date + 30, 'published', 'https://example.test/d'
      from places p, (values ('00000000-0000-4000-8000-0000000000ff', 'Tie B'), ('00000000-0000-4000-8000-0000000000aa', 'Tie A')) v(id, title)
     where p.slug = 'bahria-bean-kiosk';
    -- Takeaway prices so channel conditions get exercised.
    insert into item_prices (item_size_id, channel, price_pkr, tax_inclusive, is_current, source_id, confidence)
    select s.id, 'takeaway', p.price_pkr - 30, true, true, p.source_id, p.confidence
      from item_sizes s join item_prices p on p.item_size_id = s.id and p.is_current
      join menu_items mi on mi.id = s.menu_item_id join places pl on pl.id = mi.place_id
     where pl.slug in ('kite-and-cup', 'brew-bazaar-johar-town');
  `);
});

describe("effective price: TypeScript mirror == SQL effective_price_detail", () => {
  test("every sample drink × card sets × times across a week", async () => {
    const deals = (await loadDeals(db)).map(toRule);
    const cups = await db.query<{ item_size_id: string; menu_item_id: string; place_id: string; brand_id: string | null; price_pkr: number; channel: Channel }>(
      "select item_size_id, menu_item_id, place_id, brand_id, price_pkr, channel from v_current_menu",
    );
    const pm = new Map((await db.query<{ id: number; name: string }>("select id, name from payment_methods")).map((r) => [r.name, r.id]));
    const cardSets = [[], ["HBL"], ["Meezan Bank", "UBL"], ["Bank Alfalah", "Standard Chartered", "JazzCash"], [...pm.keys()]].map((names) =>
      names.map((n) => pm.get(n)!),
    );

    const times: Date[] = [];
    const start = new Date(`${lahoreNow().date}T00:00:00+05:00`).getTime();
    for (let day = 0; day < 7; day++) {
      for (const hm of ["02:00", "10:00", "15:00", "16:30", "17:59:59", "18:00", "22:00", "23:30"]) {
        const [h, m, s] = hm.split(":").map(Number);
        times.push(new Date(start + day * 86_400_000 + (h * 3600 + m * 60 + (s ?? 0)) * 1000));
      }
    }

    let compared = 0;
    let discounted = 0;
    const seenDeals = new Set<string>();
    for (const at of times) {
      for (const cards of cardSets) {
        const sql = await db.query<{ item_size_id: string; channel: Channel; effective_price_pkr: number; discount_pkr: number; deal_id: string | null }>(
          `select m.item_size_id, m.channel, e.effective_price_pkr, e.discount_pkr, e.deal_id
             from v_current_menu m cross join lateral effective_price_detail(m.item_size_id, $1::int[], $2::timestamptz, m.channel) e`,
          [cards, at.toISOString()],
        );
        const bySize = new Map(sql.map((r) => [`${r.item_size_id}:${r.channel}`, r]));
        for (const c of cups) {
          const ts = effectivePrice(
            { pricePkr: c.price_pkr, menuItemId: c.menu_item_id, placeId: c.place_id, brandId: c.brand_id, channel: c.channel },
            deals,
            cards,
            at,
          );
          const s = bySize.get(`${c.item_size_id}:${c.channel}`)!;
          const ctx = `${c.item_size_id} ${c.channel} @${at.toISOString()} cards=${cards.join(",")}`;
          expect({ eff: ts.effectivePricePkr, off: ts.discountPkr, deal: ts.deal?.id ?? null }, ctx).toEqual({
            eff: s.effective_price_pkr,
            off: s.discount_pkr,
            deal: s.deal_id,
          });
          compared++;
          if (s.discount_pkr > 0) {
            discounted++;
            seenDeals.add(s.deal_id!);
          }
        }
      }
    }
    // Make sure the comparison actually exercised the interesting deals.
    expect(compared).toBeGreaterThan(10_000);
    expect(discounted).toBeGreaterThan(1000);
    const titles = new Set(deals.filter((d) => seenDeals.has(d.id)).map((d) => d.title));
    for (const t of ["Happy hour: 25% off, 3–6 pm weekdays", "Late-night 10% off with UBL", "15% off with HBL cards", "Fixed price latte", "12.5% rounding test", "Tie A"]) {
      expect(titles, t).toContain(t);
    }
    expect(titles).not.toContain("Tie B");
    expect(titles).not.toContain("Free cookie");
  }, 240_000);
});

describe("dealDiscountPkr", () => {
  const d = (discount: "percent" | "flat_pkr" | "bogo" | "fixed_price" | "free_item", discountValue: number | null, maxDiscountPkr: number | null = null) => ({ discount, discountValue, maxDiscountPkr });
  test("kinds, caps and rounding", () => {
    expect(dealDiscountPkr(d("percent", 20, 300), 840)).toBe(168);
    expect(dealDiscountPkr(d("percent", 30, 100), 840)).toBe(100);
    expect(dealDiscountPkr(d("percent", 12.5), 830)).toBe(104); // 103.75 -> 104
    expect(dealDiscountPkr(d("percent", 15), 830)).toBe(125); // 124.5 -> 125 (half away from zero)
    expect(dealDiscountPkr(d("flat_pkr", 900), 840)).toBe(840); // never below zero
    expect(dealDiscountPkr(d("fixed_price", 499), 840)).toBe(341);
    expect(dealDiscountPkr(d("fixed_price", 999), 840)).toBe(0);
    expect(dealDiscountPkr(d("bogo", null), 935)).toBe(467);
    expect(dealDiscountPkr(d("free_item", null), 840)).toBe(0);
  });
});
