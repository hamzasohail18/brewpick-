import { beforeAll, describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import { parseBankOffers, parseDate, parseDays, type Merchant } from "@collectors/bank-offers/parse";
import { bankPaymentMethod, collectBankOffers } from "@collectors/bank-offers";
import { googleHours, mapGooglePlaces, searchBody } from "@collectors/google-places/map";
import { collectGooglePlaces } from "@collectors/google-places";
import { expireDeals, isDue, runScheduler, sendAlert } from "@collectors/lib/scheduler";
import { runCollector } from "@collectors/lib/runner";
import { memorySnapshotStore } from "@collectors/lib/snapshots";
import { pgliteDb, type Db } from "@/lib/db/core";
import { freshDb } from "../db/harness";

const fixture = (p: string) => readFileSync(new URL(`../fixtures/${p}`, import.meta.url), "utf8");
const TODAY = "2026-10-11";
const MERCHANTS: Merchant[] = [
  { kind: "brand", id: "b1", name: "Fixture Brew Co" },
  { kind: "place", id: "p1", name: "Fixture Beanery" },
  { kind: "place", id: "p2", name: "Cup" }, // too short to match safely
];

describe("bank offer parsing", () => {
  const { offers } = parseBankOffers(fixture("bank/offers.html"), MERCHANTS, TODAY);

  test("keeps only offers naming a cafe in the directory", () => {
    expect(offers.map((o) => o.merchant.name)).toEqual(["Fixture Brew Co", "Fixture Beanery", "Fixture Beanery", "Fixture Brew Co"]);
  });

  test("reads discount, cap, minimum spend, dates and days as stated", () => {
    expect(offers[0]).toMatchObject({
      percent: 20,
      capPkr: 1500,
      minSpendPkr: 1000,
      validFrom: "2026-10-01",
      validTo: "2026-12-31",
      days: [1, 2],
      missing: null,
    });
    expect(offers[1]).toMatchObject({ percent: null, flatPkr: 300, validFrom: null, validTo: "2026-11-15", days: [0, 6], missing: null });
  });

  test("never invents an end date; ended offers are not staged", () => {
    expect(offers[2]).toMatchObject({ percent: 15, validTo: null, missing: "no end date stated" });
    expect(offers[3].missing).toBe("already ended (2026-01-01)");
  });

  test("date and day formats", () => {
    expect(parseDate("31st December, 2026")).toBe("2026-12-31");
    expect(parseDate("Dec 5 2026")).toBe("2026-12-05");
    expect(parseDate("05/11/2026")).toBe("2026-11-05"); // day first
    expect(parseDate("31/02/2026")).toBeNull();
    expect(parseDays("Mon - Thu only")).toEqual([1, 2, 3, 4]);
    expect(parseDays("valid on weekdays")).toEqual([1, 2, 3, 4, 5]);
    expect(parseDays("every month, sat night special")).toBeNull(); // "month" and bare "sat" aren't days
  });

  test("bank payment method from the source name", () => {
    const methods = [
      { name: "HBL", kind: "bank_card" },
      { name: "Bank Alfalah", kind: "bank_card" },
      { name: "Foodpanda", kind: "delivery_app" },
    ];
    expect(bankPaymentMethod("Bank Alfalah offers", methods)).toBe("Bank Alfalah");
    expect(bankPaymentMethod("HBL offers", methods)).toBe("HBL");
    expect(bankPaymentMethod("Some other bank", methods)).toBeNull();
  });
});

describe("Google Places mapping", () => {
  const json = JSON.parse(fixture("google/search.json"));
  const { records, skipped } = mapGooglePlaces(json.places, [{ id: 1, name: "Gulberg", centroid_lat: 31.512, centroid_lng: 74.346 }], "2026-10-11T10:00:00+05:00");

  test("maps fields and skips closed places", () => {
    expect(skipped).toEqual([{ id: "ChIJfixtureCCC", reason: "permanently closed" }]);
    expect(records[0]).toMatchObject({
      name: "Fixture Beanery",
      google_place_id: "ChIJfixtureAAA",
      area_id: 1,
      website_url: "https://fixture-beanery.example.com/",
      source_url: "https://maps.google.com/?cid=1",
      has_wifi: null,
    });
    expect(records[1]).toMatchObject({ type: "bakery_cafe", area_id: null });
  });

  test("opening periods, after-midnight closing and 24/7", () => {
    const week = records[0].hours!;
    expect(week.find((d) => d.day_of_week === 1)).toEqual({ day_of_week: 1, opens: "09:00", closes: "23:00", is_closed: false });
    expect(week.find((d) => d.day_of_week === 5)).toMatchObject({ opens: "14:00", closes: "01:00" });
    expect(week.find((d) => d.day_of_week === 6)).toMatchObject({ opens: "10:00", closes: "23:59" });
    expect(week.find((d) => d.day_of_week === 2)).toMatchObject({ is_closed: true });
    expect(records[1].hours!.every((d) => d.opens === "00:00" && d.closes === "23:59")).toBe(true);
    expect(googleHours(undefined)).toBeNull();
  });

  test("searches stay inside the Lahore box", () => {
    expect(searchBody("cafe in Lahore", "tok")).toMatchObject({ pageToken: "tok", locationRestriction: { rectangle: { low: { latitude: 31.2 } } } });
  });
});

describe("collectors against the database", () => {
  let pg: PGlite;
  let db: Db;
  const quiet = { log: () => {}, contactEmail: "ops@brewpick.pk", snapshots: memorySnapshotStore() };

  beforeAll(async () => {
    pg = await freshDb();
    db = pgliteDb(pg);
    await pg.exec(`
      insert into brands (slug, name) values ('fixture-brew-co', 'Fixture Brew Co');
      insert into places (slug, name, type, lat, lng, status, phone, has_wifi)
        values ('fixture-beanery', 'Fixture Beanery', 'specialty_cafe', 31.5122, 74.3461, 'published', '042 1111111', true);
      update sources set automation = 'allowed', automation_notes = 'Reviewed (test)', robots_checked_at = now(),
                         base_url = 'https://offers.fixturebank.example.com/dining', rate_limit_seconds = 1
       where slug = 'bank-offers-alfalah';
      update sources set automation = 'allowed_with_conditions', automation_notes = 'Reviewed (test)', robots_checked_at = now(),
                         max_cache_days = 30
       where slug = 'google-places-api';
    `);
  });

  test("bank offers become bank_card deals for that bank, waiting for review", async () => {
    const fetchImpl = (async (url: string) =>
      new Response(url.endsWith("robots.txt") ? "" : fixture("bank/offers.html"), { headers: { "content-type": "text/html" } })) as typeof fetch;
    const out = await runCollector({ db, slug: "bank-offers-alfalah", collect: collectBankOffers, fetchDeps: { fetchImpl, sleep: async () => {} }, ...quiet });
    expect(out).toMatchObject({ status: "partial", found: 4, staged: 2 });
    const deals = (await pg.query<{ proposed: Record<string, unknown> }>("select proposed from staging_records where target_table = 'deals' order by proposed->>'title'")).rows.map((r) => r.proposed);
    expect(deals[0]).toMatchObject({
      title: "20% off at Fixture Brew Co with Bank Alfalah cards",
      deal_type: "bank_card",
      brand_id: expect.any(String),
      place_id: null,
      payment_methods: ["Bank Alfalah"],
      max_discount_pkr: 1500,
      valid_from: "2026-10-01",
      source_url: "https://offers.fixturebank.example.com/dining",
    });
    expect(deals[1]).toMatchObject({ discount: "flat_pkr", discount_value: 300, place_id: expect.any(String), conditions: [expect.stringMatching(/Start date not stated/)] });
    expect((await pg.query("select 1 from deals")).rows).toHaveLength(0); // nothing live without review
  });

  test("Google: needs a key, sends it as a header, and merges with the live place instead of blanking fields", async () => {
    const run = (fetchImpl: typeof fetch) =>
      runCollector({ db, slug: "google-places-api", collect: collectGooglePlaces, fetchDeps: { fetchImpl, sleep: async () => {} }, ...quiet });
    delete process.env.GOOGLE_PLACES_API_KEY;
    await expect(run(fetch)).rejects.toThrow(/GOOGLE_PLACES_API_KEY/);

    process.env.GOOGLE_PLACES_API_KEY = "test-key";
    const calls: { url: string; key: string | null; mask: string | null }[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const h = new Headers(init?.headers);
      calls.push({ url, key: h.get("x-goog-api-key"), mask: h.get("x-goog-fieldmask") });
      return new Response(fixture("google/search.json"), { headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    try {
      const out = await run(fetchImpl);
      expect(out).toMatchObject({ found: 3, staged: 2 });
    } finally {
      delete process.env.GOOGLE_PLACES_API_KEY;
    }
    expect(calls[0]).toMatchObject({ url: "https://places.googleapis.com/v1/places:searchText", key: "test-key" });
    expect(calls[0].url).not.toContain("test-key");
    expect(calls.some((c) => c.url.endsWith("robots.txt"))).toBe(false);

    const update = (
      await pg.query<{ action: string; proposed: Record<string, unknown>; diff: Record<string, unknown> }>(
        "select action, proposed, diff from staging_records where target_table = 'places' and proposed->>'google_place_id' = 'ChIJfixtureAAA'",
      )
    ).rows[0];
    expect(update.action).toBe("update");
    expect(update.proposed).toMatchObject({ has_wifi: true, google_place_id: "ChIJfixtureAAA" });
    expect(Object.keys(update.diff)).not.toContain("has_wifi");
  });
});

describe("scheduler", () => {
  const now = new Date("2026-10-11T03:00:00Z");
  const day = 86_400_000;

  test("isDue: never run, next check reached, or weekly for popular places", () => {
    const popular = new Set(["hot"]);
    expect(isDue({ place_id: null, last_checked_at: null, next_check_at: null }, now, popular)).toBe(true);
    expect(isDue({ place_id: null, last_checked_at: new Date(+now - day), next_check_at: new Date(+now - 1) }, now, popular)).toBe(true);
    expect(isDue({ place_id: null, last_checked_at: new Date(+now - day), next_check_at: new Date(+now + day) }, now, popular)).toBe(false);
    const eightDaysAgo = { last_checked_at: new Date(+now - 8 * day), next_check_at: new Date(+now + 6 * day) };
    expect(isDue({ place_id: "hot", ...eightDaysAgo }, now, popular)).toBe(true);
    expect(isDue({ place_id: "cold", ...eightDaysAgo }, now, popular)).toBe(false);
  });

  let pg: PGlite;
  let db: Db;
  beforeAll(async () => {
    pg = await freshDb();
    db = pgliteDb(pg);
    const src = (await pg.query<{ id: string }>("select id from sources where slug = 'manual-admin'")).rows[0].id;
    const place = (
      await pg.query<{ id: string }>("insert into places (slug, name, type, lat, lng) values ('p', 'P', 'specialty_cafe', 31.5, 74.3) returning id")
    ).rows[0].id;
    await pg.query(
      `insert into deals (place_id, title, deal_type, discount, discount_value, valid_from, valid_to, status, source_id, source_url)
       values ($2, 'Ended', 'happy_hour', 'percent', 10, '2026-09-01', '2026-10-10', 'published', $1, 'https://x.example.com'),
              ($2, 'Ends today', 'happy_hour', 'percent', 10, '2026-09-01', '2026-10-11', 'published', $1, 'https://x.example.com')`,
      [src, place],
    );
    await pg.exec(`
      update sources set automation = 'allowed_with_conditions', automation_notes = 'Reviewed (test)', robots_checked_at = now()
       where slug = 'osm-overpass-lahore';
      update sources set automation = 'allowed', automation_notes = 'Reviewed (test)', robots_checked_at = now(),
                         last_checked_at = now(), next_check_at = now() + interval '1 day'
       where slug = 'bank-offers-hbl';
      insert into source_runs (source_id, status) select id, 'queued' from sources where slug = 'bank-offers-hbl';
      -- Queued while allowed, then set back to "needs review" before the scheduler got to it.
      update sources set automation = 'allowed', automation_notes = 'Reviewed (test)', robots_checked_at = now() where slug = 'bank-offers-ubl';
      insert into source_runs (source_id, status) select id, 'queued' from sources where slug = 'bank-offers-ubl';
      update sources set automation = 'unknown_review_required' where slug = 'bank-offers-ubl';
    `);
  });

  test("expires ended deals (Karachi date) with an audit row", async () => {
    expect(await expireDeals(db, "2026-10-11")).toBe(1);
    const rows = (await pg.query<{ title: string; status: string }>("select title, status from deals order by title")).rows;
    expect(rows).toEqual([
      { title: "Ended", status: "archived" },
      { title: "Ends today", status: "published" },
    ]);
    expect((await pg.query("select 1 from audit_log where action = 'expire'")).rows).toHaveLength(1);
  });

  test("runs queued and due sources, fails blocked queued runs, and skips sources awaiting review quietly", async () => {
    const ran: string[] = [];
    const report = await runScheduler({
      db,
      now: new Date(),
      contactEmail: "ops@brewpick.pk",
      log: () => {},
      collectorFor: (s) =>
        ["osm-overpass-lahore", "bank-offers-hbl", "bank-offers-ubl", "bank-offers-meezan"].includes(s.slug)
          ? async (ctx) => {
              ran.push(ctx.source.slug);
              if (ctx.source.slug === "osm-overpass-lahore") throw new Error("Overpass timed out");
              return { found: 1, staged: 0 };
            }
          : null,
    });
    expect(ran.sort()).toEqual(["bank-offers-hbl", "osm-overpass-lahore"]); // hbl from the queue (not due), osm due (never run)
    expect(report.failures).toEqual([
      expect.stringMatching(/^bank-offers-ubl: queued run not started: .*unknown_review_required/),
      "osm-overpass-lahore: Overpass timed out",
    ]);
    expect(report.skippedBlocked).toBeGreaterThanOrEqual(1); // meezan: still waiting for review, not an alert
    const runs = (await pg.query<{ slug: string; status: string }>("select s.slug, r.status from source_runs r join sources s on s.id = r.source_id order by s.slug")).rows;
    expect(runs).toEqual([
      { slug: "bank-offers-hbl", status: "succeeded" },
      { slug: "bank-offers-ubl", status: "failed" },
      { slug: "osm-overpass-lahore", status: "failed" },
    ]);
  });

  test("failure alerts go to the webhook as one message", async () => {
    let body = "";
    await sendAlert("https://hooks.example.com/x", { dealsArchived: 0, ran: [], skippedBlocked: 0, failures: ["a: boom"] }, (async (_u: string, init?: RequestInit) => {
      body = String(init?.body);
      return new Response("ok");
    }) as typeof fetch);
    expect(JSON.parse(body).text).toBe("BrewPick collectors: 1 failure(s)\n• a: boom");
  });
});
