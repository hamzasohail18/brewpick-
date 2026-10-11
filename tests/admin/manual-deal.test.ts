import { beforeAll, describe, expect, test } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { ManualDealForm, manualDealFields, stageManualDeal } from "@/lib/admin/manual-deal";
import { pgliteDb, type Db } from "@/lib/db/core";
import { freshDb } from "../db/harness";

const form = (over: Record<string, string | string[]> = {}) => {
  const fd = new FormData();
  const base: Record<string, string | string[]> = {
    source: "bank-offers-hbl",
    applies_to: "place:00000000-0000-4000-8000-000000000001",
    title: "20% off with HBL cards",
    deal_type: "bank_card",
    discount: "percent",
    discount_value: "20",
    max_discount_pkr: "1,500".replace(",", ""),
    min_spend_pkr: "",
    valid_from: "2026-10-01",
    valid_to: "2026-12-31",
    days: ["1", "2"],
    start_time: "",
    end_time: "",
    payment_methods: ["HBL"],
    terms: "",
    source_url: "https://www.hbl.com/offers",
    ...over,
  };
  for (const [k, v] of Object.entries(base)) for (const x of Array.isArray(v) ? v : [v]) fd.append(k, x);
  return ManualDealForm.safeParse(manualDealFields(fd));
};

describe("manual deal form", () => {
  test("parses a complete bank offer", () => {
    const r = form();
    expect(r.success).toBe(true);
    expect(r.data).toMatchObject({ discount_value: 20, max_discount_pkr: 1500, min_spend_pkr: null, days: [1, 2], payment_methods: ["HBL"] });
  });

  test("explains what's missing or inconsistent", () => {
    const issues = (r: ReturnType<typeof form>) => Object.fromEntries((r.error?.issues ?? []).map((i) => [String(i.path[0]), i.message]));
    expect(issues(form({ discount_value: "" }))).toMatchObject({ discount_value: "How much off?" });
    expect(issues(form({ valid_to: "2026-09-01" }))).toMatchObject({ valid_to: "Ends before it starts" });
    expect(issues(form({ payment_methods: [] }))).toMatchObject({ payment_methods: "Which bank's cards?" });
    expect(issues(form({ start_time: "17:00" }))).toMatchObject({ end_time: "Give both times or neither" });
    expect(issues(form({ valid_to: "" }))).toMatchObject({ valid_to: expect.stringMatching(/End date is required/) });
  });
});

describe("staging a manual deal", () => {
  let pg: PGlite;
  let db: Db;
  let placeId: string;
  beforeAll(async () => {
    pg = await freshDb();
    db = pgliteDb(pg);
    placeId = (await pg.query<{ id: string }>("insert into places (slug, name, type, lat, lng, status) values ('x', 'X', 'specialty_cafe', 31.5, 74.3, 'published') returning id")).rows[0].id;
  });

  test("bank sources need the offer page; it works even though bank automation is unreviewed", async () => {
    const d = form({ applies_to: `place:${placeId}` }).data!;
    expect(await stageManualDeal(db, "00000000-0000-4000-8000-0000000000aa", { ...d, source_url: null }, null)).toEqual({
      error: "Bank offers need the offer page's address as the source URL.",
    });
    expect(await stageManualDeal(db, "00000000-0000-4000-8000-0000000000aa", d, null)).toEqual({ staged: 1, reconfirmed: 0 });
    const [row] = (await pg.query<{ status: string; proposed: Record<string, unknown> }>("select status, proposed from staging_records")).rows;
    expect(row.status).toBe("pending_review");
    expect(row.proposed).toMatchObject({ place_id: placeId, payment_methods: ["HBL"], days_of_week: [1, 2], source_url: "https://www.hbl.com/offers" });
  });

  test("collector-only and sample-data sources can't be used for hand entry", async () => {
    for (const source of ["osm-overpass-lahore", "sample-data"]) {
      const d = form({ applies_to: `place:${placeId}`, source }).data!;
      expect(await stageManualDeal(db, "00000000-0000-4000-8000-0000000000aa", d, null)).toEqual({ error: "Choose a source you can enter deals from." });
    }
  });
});
