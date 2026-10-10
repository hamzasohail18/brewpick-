import { beforeAll, describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import { parseOpeningHours } from "@collectors/osm/opening-hours";
import { buildOverpassQuery, mapOverpass, nearestArea, type Area } from "@collectors/osm/overpass";
import { collectOsmPlaces } from "@collectors/osm";
import { runCollector } from "@collectors/lib/runner";
import { memorySnapshotStore } from "@collectors/lib/snapshots";
import { pgliteDb, type Db } from "@/lib/db/core";
import { freshDb } from "../db/harness";

const fixture = readFileSync(new URL("../fixtures/osm/overpass-lahore.json", import.meta.url), "utf8");
const NOW = "2026-10-12T10:00:00+05:00";
const AREAS: Area[] = [
  { id: 1, name: "Gulberg", centroid_lat: 31.512, centroid_lng: 74.346 },
  { id: 2, name: "Johar Town", centroid_lat: 31.4697, centroid_lng: 74.2728 },
  { id: 3, name: "Bahria Town", centroid_lat: 31.367, centroid_lng: 74.183 },
];

describe("opening_hours", () => {
  test("common patterns", () => {
    expect(parseOpeningHours("Mo-Su 09:00-23:00")).toHaveLength(7);
    const week = parseOpeningHours("Mo-Th 09:00-23:00; Fr 14:00-01:00; Sa,Su 10:00-24:00")!;
    expect(week.find((d) => d.day_of_week === 5)).toEqual({ day_of_week: 5, opens: "14:00", closes: "01:00", is_closed: false });
    expect(week.find((d) => d.day_of_week === 0)).toMatchObject({ opens: "10:00", closes: "00:00" });
  });

  test("off days, later rules override, split shifts, ranges that wrap", () => {
    const h = parseOpeningHours("Mo-Su 08:00-22:00; Tu off; We 12:00-15:00,18:00-23:00")!;
    expect(h.find((d) => d.day_of_week === 2)).toMatchObject({ is_closed: true });
    expect(h.find((d) => d.day_of_week === 3)).toMatchObject({ opens: "12:00", closes: "23:00" });
    expect(parseOpeningHours("Fr-Mo 18:00-02:00")!.map((d) => d.day_of_week)).toEqual([0, 1, 5, 6]);
    expect(parseOpeningHours("24/7")![0]).toEqual({ day_of_week: 0, opens: "00:00", closes: "23:59", is_closed: false });
  });

  test("anything unusual returns null instead of a guess", () => {
    expect(parseOpeningHours("PH off; Mo-Su 08:00-22:00")).toBeNull();
    expect(parseOpeningHours("sunrise-sunset")).toBeNull();
    expect(parseOpeningHours("Jan-Mar Mo 09:00-17:00")).toBeNull();
    expect(parseOpeningHours("")).toBeNull();
  });
});

describe("OSM mapping", () => {
  const { records, skipped } = mapOverpass(JSON.parse(fixture).elements, AREAS, NOW);

  test("keeps named cafés in Lahore and says why others were skipped", () => {
    expect(records.map((r) => r.osm_id)).toEqual(["node/1001", "way/2002", "node/3003"]);
    expect(skipped).toEqual([
      { osmId: "node/4004", reason: "no name" },
      { osmId: "node/5005", reason: "outside Lahore" },
      { osmId: "node/6006", reason: "marked disused" },
    ]);
  });

  test("maps tags to place fields", () => {
    const [lab, chain, drive] = records;
    expect(lab).toMatchObject({
      name: "Fixture Bean Lab",
      type: "specialty_cafe",
      area_id: 1,
      address: "12 Main Boulevard, Lahore",
      website_url: "https://fixture-bean-lab.example.com/",
      instagram_handle: "fixturebeanlab",
      has_wifi: true,
      halal_certified: true,
      source_url: "https://www.openstreetmap.org/node/1001",
      confidence: "community_reported",
    });
    expect(lab.hours).toHaveLength(7);
    expect(chain).toMatchObject({ type: "chain", branch_name: "Johar Town", area_id: 2, lat: 31.4701 });
    expect(drive).toMatchObject({ type: "kiosk_drive_thru", has_drive_thru: true, area_id: 3, hours: null });
  });

  test("nearest area respects the distance limit", () => {
    expect(nearestArea(31.6, 74.5, AREAS)).toBeNull();
  });

  test("query covers cafés and coffee shops in the Lahore box", () => {
    const q = buildOverpassQuery();
    expect(q).toContain('nwr["amenity"="cafe"](31.2,74,31.75,74.6)');
    expect(q).toContain("out center tags;");
  });
});

describe("OSM collector end to end", () => {
  let pg: PGlite;
  let db: Db;
  const snapshots = memorySnapshotStore();
  const requests: { url: string; method: string; ua: string | null }[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    requests.push({ url, method: init?.method ?? "GET", ua: new Headers(init?.headers).get("user-agent") });
    return new Response(fixture, { headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const run = () =>
    runCollector({
      db,
      slug: "osm-overpass-lahore",
      collect: collectOsmPlaces,
      contactEmail: "ops@brewpick.pk",
      fetchDeps: { fetchImpl, sleep: async () => {} },
      snapshots,
      log: () => {},
    });

  beforeAll(async () => {
    pg = await freshDb();
    db = pgliteDb(pg);
    // What an admin does after reading the Overpass usage policy and ODbL.
    await pg.exec(`update sources set automation = 'allowed_with_conditions', robots_checked_at = now()
                    where slug = 'osm-overpass-lahore'`);
  });

  test("first run stages new places for review, with a snapshot and no robots.txt fetch", async () => {
    const out = await run();
    expect(out).toMatchObject({ status: "succeeded", found: 6, staged: 3 });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ method: "POST", url: "https://overpass-api.de/api/interpreter", ua: "BrewPickLahore/0.1 (+mailto:ops@brewpick.pk)" });
    expect([...snapshots.saved.keys()][0]).toMatch(/overpass\.json$/);
    const runRow = (await pg.query<{ raw_snapshot_url: string; records_staged: number }>("select raw_snapshot_url, records_staged from source_runs")).rows[0];
    expect(runRow).toMatchObject({ records_staged: 3 });
    const places = await pg.query("select 1 from places");
    expect(places.rows).toHaveLength(0); // nothing goes live without review
  });

  test("approved places are re-confirmed, not re-queued, on the next run", async () => {
    const { approveStaged } = await import("@/lib/pipeline/publish");
    const pending = (await pg.query<{ id: string }>("select id from staging_records where status = 'pending_review'")).rows;
    for (const p of pending) await db.transaction((tx) => approveStaged(tx, { id: null, kind: "admin" }, p.id));
    const hours = await pg.query("select * from place_hours");
    expect(hours.rows.length).toBe(14); // two places with 7 days each; the drive-thru's hours were unparseable

    const out = await run();
    expect(out.staged).toBe(0);
    const reconfirmed = await pg.query("select 1 from staging_records where action = 'reconfirm' and status = 'published'");
    expect(reconfirmed.rows).toHaveLength(3);
  });
});
