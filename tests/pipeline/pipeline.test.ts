import { beforeAll, describe, expect, test } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { pgliteDb, type Db } from "@/lib/db/core";
import { approveStaged, PublishError, rejectStaged, type Reviewer } from "@/lib/pipeline/publish";
import { stageRecords } from "@/lib/pipeline/stage";
import { freshDb } from "../db/harness";

// Fictional test fixtures only.
const PLACE = "00000000-0000-4000-8000-00000000c0fe";
const ADMIN: Reviewer = { id: "00000000-0000-4000-8000-00000000ad01", kind: "admin" };
const NOW = "2026-10-12T10:00:00+05:00";

let pg: PGlite;
let db: Db;
let sourceId: string;

const price = (name: string, size: string, pkr: number, extra: Record<string, unknown> = {}) => ({
  kind: "item_price",
  place_id: PLACE,
  item: { display_name: name, drink_type_slug: "latte", temperature: "hot", has_milk: true },
  size: { size_label: size, volume_ml: 350, volume_is_assumed: false },
  channel: "dine_in",
  price_pkr: pkr,
  tax_inclusive: true,
  source_url: "https://cafe.example.com/menu",
  proof_image_url: null,
  confidence: "verified",
  captured_at: NOW,
  ...extra,
});

async function stage(records: unknown[], extra = {}) {
  return stageRecords(db, { sourceId, records, today: "2026-10-12", ...extra });
}
async function pending(matchLike = "%") {
  return pg.query<{ id: string; action: string; flags: string[]; diff: Record<string, unknown>; messages: string[] }>(
    "select id, action, flags, diff, messages from staging_records where status = 'pending_review' and match_key like $1 order by created_at",
    [matchLike],
  ).then((r) => r.rows);
}
const approve = (id: string, edited?: unknown) => db.transaction((tx) => approveStaged(tx, ADMIN, id, edited));
async function currentPrice(name: string, size = "Regular") {
  const r = await pg.query<{ id: string; price_pkr: number; last_verified_at: Date | null; source_id: string }>(
    `select pr.id, pr.price_pkr, pr.last_verified_at, pr.source_id from item_prices pr
       join item_sizes s on s.id = pr.item_size_id join menu_items mi on mi.id = s.menu_item_id
      where mi.place_id = $1 and mi.display_name = $2 and s.size_label = $3 and pr.is_current`,
    [PLACE, name, size],
  );
  return r.rows[0];
}

beforeAll(async () => {
  pg = await freshDb();
  db = pgliteDb(pg);
  sourceId = (await pg.query<{ id: string }>("select id from sources where slug = 'manual-admin'")).rows[0].id;
  await pg.query(
    "insert into places (id, slug, name, type, lat, lng, status) values ($1, 'test-cafe', 'Test Cafe', 'specialty_cafe', 31.52, 74.35, 'published')",
    [PLACE],
  );
});

describe("staging", () => {
  test("new items land in the queue, invalid ones are kept as rejected", async () => {
    const s = await stage([price("Latte", "Regular", 750), price("Broken", "Regular", 99999), { kind: "nonsense" }]);
    expect(s).toMatchObject({ staged: 1, rejected: 2 });
    const [row] = await pending();
    expect(row).toMatchObject({ action: "create", flags: ["new_item"] });
    const rejected = await pg.query<{ messages: string[] }>("select messages from staging_records where status = 'rejected'");
    expect(rejected.rows.flatMap((r) => r.messages).join("\n")).toMatch(/outside Rs. 50–5000/);
  });

  test("a newer proposal supersedes one still pending", async () => {
    const s = await stage([price("Latte", "Regular", 760)]);
    expect(s.superseded).toBe(1);
    const rows = await pending();
    expect(rows).toHaveLength(1);
  });
});

describe("publishing (acceptance: approving a price change)", () => {
  test("approving a new item creates item, size and current price with provenance", async () => {
    const [row] = await pending();
    await approve(row.id);
    const p = await currentPrice("Latte");
    expect(p).toMatchObject({ price_pkr: 760, source_id: sourceId });
    expect(p.last_verified_at).not.toBeNull();
  });

  test("approving a change supersedes the old price, writes audit_log and sets last_verified_at", async () => {
    const before = await currentPrice("Latte");
    await stage([price("Latte", "Regular", 900)]);
    const [row] = await pending();
    expect(row.flags).toContain("price_change_over_15pct");
    expect(row.diff).toEqual({ price_pkr: { from: 760, to: 900 } });

    await approve(row.id);

    const old = (await pg.query<{ is_current: boolean; superseded_at: Date | null }>("select is_current, superseded_at from item_prices where id = $1", [before.id])).rows[0];
    expect(old.is_current).toBe(false);
    expect(old.superseded_at).not.toBeNull();
    const now = await currentPrice("Latte");
    expect(now.price_pkr).toBe(900);
    expect(now.last_verified_at).not.toBeNull();
    const log = await pg.query<{ actor_kind: string; old_values: { price_pkr: number } }>(
      "select actor_kind, old_values from audit_log where table_name = 'item_prices' and record_id = $1",
      [now.id],
    );
    expect(log.rows[0]).toMatchObject({ actor_kind: "admin", old_values: { price_pkr: 760 } });
    const staged = await pg.query<{ status: string; reviewed_by: string }>("select status, reviewed_by from staging_records where id = $1", [row.id]);
    expect(staged.rows[0]).toEqual({ status: "published", reviewed_by: ADMIN.id });
  });

  test("an exact re-confirmation is auto-approved and only bumps last_verified_at", async () => {
    await pg.query("update item_prices set last_verified_at = now() - interval '20 days' where is_current");
    const s = await stage([price("Latte", "Regular", 900)]);
    expect(s).toMatchObject({ reconfirmed: 1, staged: 0 });
    const p = await currentPrice("Latte");
    expect(Date.now() - p.last_verified_at!.getTime()).toBeLessThan(60_000);
    expect(await pending()).toHaveLength(0);
  });

  test("reviewer edits are re-validated before publishing", async () => {
    await stage([price("Flat White", "Regular", 820)]);
    const [row] = await pending();
    await expect(approve(row.id, { ...price("Flat White", "Regular", 820), price_pkr: 99999 })).rejects.toThrow(PublishError);
    await approve(row.id, price("Flat White", "Regular", 800));
    expect((await currentPrice("Flat White")).price_pkr).toBe(800);
    const note = await pg.query<{ review_note: string }>("select review_note from staging_records where id = $1", [row.id]);
    expect(note.rows[0].review_note).toMatch(/Edited/);
  });

  test("rejecting needs a reason and leaves live data untouched", async () => {
    await stage([price("Latte", "Regular", 1000)]);
    const [row] = await pending();
    await expect(db.transaction((tx) => rejectStaged(tx, ADMIN, row.id, " "))).rejects.toThrow(/why/);
    await db.transaction((tx) => rejectStaged(tx, ADMIN, row.id, "Photo shows Rs. 900"));
    expect((await currentPrice("Latte")).price_pkr).toBe(900);
    await expect(approve(row.id)).rejects.toThrow(/Already rejected/);
  });
});

describe("removals and other record kinds", () => {
  test("a complete menu without an item stages its removal; approving archives it", async () => {
    const s = await stage([price("Latte", "Regular", 900)], { completeMenus: [{ place_id: PLACE, channel: "dine_in" }] });
    expect(s.removals).toBe(1);
    const [row] = await pending();
    expect(row).toMatchObject({ action: "delete", flags: ["removed_item"] });
    await approve(row.id);
    const item = await pg.query<{ status: string }>("select status from menu_items where display_name = 'Flat White'");
    expect(item.rows[0].status).toBe("archived");
    expect(await currentPrice("Flat White")).toBeUndefined();
  });

  test("nutrition attaches to an existing size; estimates keep their assumptions", async () => {
    await stage([
      {
        kind: "nutrition",
        place_id: PLACE,
        item_display_name: "Latte",
        size_label: "Regular",
        volume_ml: 350,
        has_milk: true,
        calories_kcal: 190,
        caffeine_mg: 130,
        assumptions: "2 shots, 300 ml whole milk, no sugar",
        source_url: "https://cafe.example.com/menu",
        confidence: "estimated",
        captured_at: NOW,
      },
    ]);
    const [row] = await pending();
    await approve(row.id);
    const n = await pg.query<{ calories_kcal: number; assumptions: string }>("select calories_kcal, assumptions from nutrition_info");
    expect(n.rows[0]).toEqual({ calories_kcal: 190, assumptions: "2 shots, 300 ml whole milk, no sugar" });
  });

  test("deals publish with their card requirements and feed effective_price", async () => {
    await stage([
      {
        kind: "deal",
        place_id: PLACE,
        title: "20% off with Bank Alfalah",
        deal_type: "bank_card",
        discount: "percent",
        discount_value: 20,
        max_discount_pkr: 150,
        valid_from: "2026-10-01",
        valid_to: "2026-12-31",
        payment_methods: ["Bank Alfalah"],
        source_url: "https://bank.example.com/offers",
        confidence: "community_reported",
        captured_at: NOW,
      },
    ]);
    const [row] = await pending();
    await approve(row.id);
    const size = (await pg.query<{ id: string }>("select s.id from item_sizes s join menu_items mi on mi.id = s.menu_item_id where mi.display_name = 'Latte'")).rows[0].id;
    const alfalah = (await pg.query<{ id: number }>("select id from payment_methods where name = 'Bank Alfalah'")).rows[0].id;
    const eff = await pg.query<{ p: number }>("select effective_price($1::uuid, $2::int[], $3::timestamptz) p", [size, [alfalah], NOW]);
    expect(eff.rows[0].p).toBe(750); // 900 - min(20% = 180, cap 150)
  });

  test("unknown payment methods block publishing with a clear reason", async () => {
    await stage([
      {
        kind: "deal",
        place_id: PLACE,
        title: "Mystery card deal",
        deal_type: "bank_card",
        discount: "flat_pkr",
        discount_value: 100,
        valid_from: "2026-10-01",
        valid_to: "2026-12-31",
        payment_methods: ["Imaginary Bank"],
        source_url: "https://bank.example.com/offers",
        confidence: "community_reported",
        captured_at: NOW,
      },
    ]);
    const [row] = await pending();
    await expect(approve(row.id)).rejects.toThrow(/Unknown payment method/);
  });

  test("new places are matched by OSM id on the next import", async () => {
    const place = {
      kind: "place",
      name: "Sample Roastery",
      type: "specialty_cafe",
      lat: 31.47,
      lng: 74.41,
      osm_id: "node/123",
      source_url: "https://www.openstreetmap.org/node/123",
      confidence: "community_reported",
      captured_at: NOW,
    };
    await stage([place]);
    const [row] = await pending("place:%");
    await approve(row.id);
    const again = await stage([place]);
    expect(again.reconfirmed).toBe(1);
    const moved = await stage([{ ...place, lat: 31.48 }]);
    expect(moved.staged).toBe(1);
    const [upd] = await pending("place:%");
    expect(upd.action).toBe("update");
    expect(Object.keys(upd.diff)).toEqual(["lat"]);
  });
});
