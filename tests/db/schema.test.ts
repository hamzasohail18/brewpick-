import { beforeAll, describe, expect, test } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asRole, freshDb } from "./harness";

// Fixture ids (fictional test data, not seed data).
const PLACE = "00000000-0000-0000-0000-0000000000a1";
const DRAFT_PLACE = "00000000-0000-0000-0000-0000000000a2";
const BRAND = "00000000-0000-0000-0000-0000000000b1";
const ITEM = "00000000-0000-0000-0000-0000000000c1";
const OTHER_ITEM = "00000000-0000-0000-0000-0000000000c2";
const SIZE = "00000000-0000-0000-0000-0000000000d1";
const USER = "00000000-0000-0000-0000-0000000000e1";
const OTHER_USER = "00000000-0000-0000-0000-0000000000e2";

// Asia/Karachi is UTC+5 with no DST. 2026-10-12 is a Monday.
const MON_10AM = "2026-10-12T10:00:00+05:00";
const MON_4PM = "2026-10-12T16:00:00+05:00";
const MON_1AM = "2026-10-12T01:00:00+05:00";
const SUN_10AM = "2026-10-11T10:00:00+05:00";

let db: PGlite;
let alfalah: number;
let hbl: number;

async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
  return (await db.query<T>(sql, params)).rows[0];
}

async function addDeal(fields: Record<string, unknown>, cards: number[] = [], conditions: string[] = []) {
  const base = {
    place_id: PLACE,
    title: "Test deal",
    deal_type: "other",
    discount: "percent",
    discount_value: 10,
    valid_from: "2026-10-01",
    valid_to: "2026-10-31",
    status: "published",
    source_url: "https://example.test/deal",
  };
  const row = { ...base, ...fields };
  const cols = Object.keys(row);
  const { id } = await one<{ id: string }>(
    `insert into deals (${cols.join(",")}) values (${cols.map((_, i) => `$${i + 1}`).join(",")}) returning id`,
    Object.values(row),
  );
  for (const c of cards) await db.query("insert into deal_payment_methods values ($1, $2)", [id, c]);
  for (const k of conditions) await db.query("insert into deal_conditions (deal_id, condition_key) values ($1, $2)", [id, k]);
  return id;
}

async function price(cards: number[], at: string, channel = "dine_in") {
  const r = await one<{ p: number }>("select effective_price($1::uuid, $2::int[], $3::timestamptz, $4::price_channel) as p", [
    SIZE,
    cards,
    at,
    channel,
  ]);
  return r.p;
}

beforeAll(async () => {
  db = await freshDb();
  alfalah = (await one<{ id: number }>("select id from payment_methods where name = 'Bank Alfalah'")).id;
  hbl = (await one<{ id: number }>("select id from payment_methods where name = 'HBL'")).id;

  await db.exec(`
    insert into brands (id, slug, name) values ('${BRAND}', 'test-brand', 'Test Brand');
    insert into places (id, slug, name, type, lat, lng, status, brand_id) values
      ('${PLACE}', 'test-cafe', 'Test Cafe', 'chain', 31.5, 74.3, 'published', '${BRAND}'),
      ('${DRAFT_PLACE}', 'draft-cafe', 'Draft Cafe', 'chain', 31.5, 74.3, 'draft', null);
    insert into menu_items (id, place_id, display_name, status) values
      ('${ITEM}', '${PLACE}', 'Latte', 'published'),
      ('${OTHER_ITEM}', '${PLACE}', 'Mocha', 'published');
    insert into item_sizes (id, menu_item_id, size_label, volume_ml) values ('${SIZE}', '${ITEM}', 'Regular', 350);
    insert into item_prices (item_size_id, price_pkr, confidence, captured_at, last_verified_at) values
      ('${SIZE}', 800, 'verified', now() - interval '45 days', now() - interval '45 days');
    insert into item_prices (item_size_id, channel, price_pkr) values ('${SIZE}', 'takeaway', 800);
    insert into nutrition_info (item_size_id, calories_kcal, caffeine_mg, assumptions) values
      ('${SIZE}', 190, 130, '2 shots, 300 ml whole milk, no sugar');
    insert into user_profiles (id) values ('${USER}'), ('${OTHER_USER}');
  `);
});

describe("migrations and seeds", () => {
  test("reference and registry seeds load", async () => {
    const counts = await one<Record<string, number>>(`
      select (select count(*)::int from areas) areas, (select count(*)::int from drink_types) drinks,
             (select count(*)::int from milk_types) milks, (select count(*)::int from sources) sources,
             (select count(*)::int from payment_methods) cards`);
    expect(counts).toMatchObject({ areas: 14, drinks: 16, milks: 6, sources: 17, cards: 17 });
  });

  test("third-party sources start as unknown_review_required with the intended status noted", async () => {
    const rows = (
      await db.query<{ slug: string; automation: string; automation_notes: string }>(
        "select slug, automation, automation_notes from sources where kind in ('open_data_api','official_api','reference_dataset','bank_offer_page')",
      )
    ).rows;
    expect(rows.length).toBe(10);
    for (const r of rows) {
      expect(r.automation).toBe("unknown_review_required");
      expect(r.automation_notes).toMatch(/^INTENDED: /);
    }
  });

  test("seeds are idempotent", async () => {
    const { readFileSync } = await import("node:fs");
    const seed = readFileSync(new URL("../../supabase/seeds/02_sources.sql", import.meta.url), "utf8");
    await db.exec(seed);
    expect((await one<{ n: number }>("select count(*)::int n from sources")).n).toBe(17);
  });
});

describe("integrity constraints", () => {
  test("a source cannot be opened to automation without a recorded review", async () => {
    await expect(db.query("update sources set automation = 'allowed' where slug = 'bank-offers-hbl'")).rejects.toThrow(
      /sources_reviewed_before_automation/,
    );
    await db.transaction(async (tx) => {
      await tx.query(
        "update sources set automation = 'allowed', robots_checked_at = now() where slug = 'bank-offers-hbl'",
      );
      await tx.rollback();
    });
  });

  test("estimated nutrition requires assumptions", async () => {
    await expect(
      db.query("insert into nutrition_info (item_size_id, milk_type_id, calories_kcal) values ($1, 2, 100)", [SIZE]),
    ).rejects.toThrow(/check/);
  });

  test("only one current price per size and channel", async () => {
    await expect(db.query("insert into item_prices (item_size_id, price_pkr) values ($1, 900)", [SIZE])).rejects.toThrow(
      /item_prices_one_current/,
    );
  });

  test("a published deal needs a source URL or proof image", async () => {
    await expect(addDeal({ source_url: null })).rejects.toThrow(/check/);
  });
});

describe("effective_price", () => {
  beforeAll(async () => {
    // 20% up to Rs. 100, Alfalah only, weekdays.
    await addDeal({ title: "Alfalah 20%", deal_type: "bank_card", discount_value: 20, max_discount_pkr: 100, days_of_week: [1, 2, 3, 4, 5] }, [alfalah]);
    // Happy hour Rs. 150 off 3-6pm, open to everyone.
    await addDeal({ title: "Happy hour", deal_type: "happy_hour", discount: "flat_pkr", discount_value: 150, start_time: "15:00", end_time: "18:00" });
    // Late-night 30% (23:00-02:00), HBL only, dine-in only.
    await addDeal({ title: "HBL late night", discount_value: 30, start_time: "23:00", end_time: "02:00" }, [hbl], ["dine_in_only"]);
    // Things that must never apply:
    await addDeal({ title: "Expired", discount_value: 90, valid_from: "2026-09-01", valid_to: "2026-09-30" });
    await addDeal({ title: "Min spend", discount_value: 90, min_spend_pkr: 2000 });
    await addDeal({ title: "Draft", discount_value: 90, status: "pending_review" });
    const scoped = await addDeal({ title: "Mocha only", discount_value: 90, applies_to_all_items: false });
    await db.query("insert into deal_items values ($1, $2)", [scoped, OTHER_ITEM]);
  });

  test("no saved cards, outside happy hour: base price", async () => {
    expect(await price([], MON_10AM)).toBe(800);
  });

  test("bank card deal applies with its cap", async () => {
    expect(await price([alfalah], MON_10AM)).toBe(700); // 20% = 160, capped at 100
  });

  test("bank card deal respects weekdays", async () => {
    expect(await price([alfalah], SUN_10AM)).toBe(800);
  });

  test("best deal wins when several apply", async () => {
    expect(await price([alfalah], MON_4PM)).toBe(650); // happy hour 150 beats card 100
  });

  test("time window that crosses midnight", async () => {
    expect(await price([hbl], MON_1AM)).toBe(560);
    expect(await price([], MON_1AM)).toBe(800);
  });

  test("channel conditions are enforced", async () => {
    expect(await price([hbl], MON_1AM, "takeaway")).toBe(800);
  });

  test("brand-wide deals apply to branches", async () => {
    await db.transaction(async (tx) => {
      await tx.query(
        `insert into deals (brand_id, title, deal_type, discount, discount_value, valid_from, valid_to, status, source_url)
         values ($1, 'Brand fixed price', 'combo', 'fixed_price', 500, '2026-10-01', '2026-10-31', 'published', 'https://example.test')`,
        [BRAND],
      );
      const r = await tx.query<{ p: number }>("select effective_price($1::uuid, '{}'::int[], $2::timestamptz) p", [SIZE, MON_10AM]);
      expect(r.rows[0].p).toBe(500);
      await tx.rollback();
    });
  });

  test("user variant reads saved cards", async () => {
    await db.query("insert into user_payment_methods values ($1, $2)", [USER, alfalah]);
    const r = await one<{ p: number }>("select effective_price($1::uuid, $2::uuid, $3::timestamptz) p", [SIZE, USER, MON_10AM]);
    expect(r.p).toBe(700);
  });

  test("detail returns which deal was used", async () => {
    const r = await one<{ deal_title: string; discount_pkr: number; base_price_pkr: number }>(
      "select * from effective_price_detail($1::uuid, $2::int[], $3::timestamptz)",
      [SIZE, [alfalah], MON_4PM],
    );
    expect(r).toMatchObject({ deal_title: "Happy hour", discount_pkr: 150, base_price_pkr: 800 });
  });
});

describe("views", () => {
  test("v_current_menu derives metrics and decays stale confidence", async () => {
    const r = await one<Record<string, unknown>>(
      "select * from v_current_menu where item_size_id = $1 and channel = 'dine_in'",
      [SIZE],
    );
    expect(Number(r.price_per_100ml)).toBeCloseTo(228.6, 1);
    expect(r.calories_kcal).toBe(190);
    expect(r.price_confidence).toBe("community_reported"); // verified, but 45 days old
    expect(r.nutrition_confidence).toBe("estimated");
    expect(r.row_confidence).toBe("estimated");
  });

  test("freshness buckets", async () => {
    const r = await one<Record<string, string>>(`
      select freshness_bucket(now()) a, freshness_bucket(now() - interval '3 days') b,
             freshness_bucket(now() - interval '20 days') c, freshness_bucket(now() - interval '40 days') d`);
    expect(r).toEqual({ a: "today", b: "this_week", c: "this_month", d: "over_30_days" });
  });
});

describe("row level security", () => {
  const user = { sub: USER, role: "authenticated" };
  const admin = { sub: OTHER_USER, role: "authenticated", app_metadata: { role: "admin" } };

  test("anon sees published places only", async () => {
    const slugs = await asRole(db, "anon", {}, async (tx) => (await tx.query<{ slug: string }>("select slug from places")).rows);
    expect(slugs.map((r) => r.slug)).toEqual(["test-cafe"]);
  });

  test("anon cannot read the source registry but can read attributions", async () => {
    const [sources, attributions] = await asRole(db, "anon", {}, async (tx) => [
      (await tx.query("select * from sources")).rows.length,
      (await tx.query<{ attribution_text: string }>("select * from v_attributions")).rows.map((r) => r.attribution_text),
    ]);
    expect(sources).toBe(0);
    expect(attributions).toContain("© OpenStreetMap contributors");
  });

  test("expired and unpublished deals are hidden from the public", async () => {
    const titles = await asRole(db, "anon", {}, async (tx) => (await tx.query<{ title: string }>("select title from deals")).rows);
    const t = titles.map((r) => r.title);
    expect(t).toContain("Happy hour");
    expect(t).not.toContain("Expired");
    expect(t).not.toContain("Draft");
  });

  test("users manage only their own saved cards and favorites", async () => {
    await asRole(db, "authenticated", user, async (tx) => {
      await tx.query("insert into favorites (user_id, place_id) values ($1, $2)", [USER, PLACE]);
      const mine = await tx.query("select * from user_payment_methods");
      expect(mine.rows.length).toBe(1);
    });
    await expect(
      asRole(db, "authenticated", user, (tx) =>
        tx.query("insert into favorites (user_id, place_id) values ($1, $2)", [OTHER_USER, PLACE]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  test("regular users cannot write catalogue data; admins can", async () => {
    const insert = "insert into places (slug, name, type, lat, lng) values ('x', 'X', 'chain', 31.5, 74.3)";
    await expect(asRole(db, "authenticated", user, (tx) => tx.query(insert))).rejects.toThrow(/row-level security/);
    await asRole(db, "authenticated", admin, (tx) => tx.query(insert));
  });

  test("submissions land as pending_review", async () => {
    await expect(
      asRole(db, "authenticated", user, (tx) =>
        tx.query(
          "insert into submissions (user_id, type, payload, status) values ($1, 'other', '{}', 'published')",
          [USER],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  test("deal votes update tallies", async () => {
    const dealId = (await one<{ id: string }>("select id from deals where title = 'Happy hour'")).id;
    await asRole(db, "authenticated", user, async (tx) => {
      await tx.query("insert into deal_votes (deal_id, user_id, is_accurate) values ($1, $2, true)", [dealId, USER]);
    });
    // asRole rolls back; do it for real as superuser to check the trigger.
    await db.query("insert into deal_votes (deal_id, user_id, is_accurate) values ($1, $2, false)", [dealId, OTHER_USER]);
    const r = await one<{ upvotes: number; downvotes: number }>("select upvotes, downvotes from deals where id = $1", [dealId]);
    expect(r).toEqual({ upvotes: 0, downvotes: 1 });
  });
});
