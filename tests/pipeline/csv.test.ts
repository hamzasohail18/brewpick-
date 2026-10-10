import { beforeAll, describe, expect, test } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { pgliteDb, type Db } from "@/lib/db/core";
import { parseCsv, toCsv } from "@/lib/pipeline/csv";
import { importCsv } from "@/lib/pipeline/csv-import";
import { comparisonRows, fromEditableFields, summarize, toEditableFields } from "@/lib/pipeline/review-format";
import { freshDb } from "../db/harness";

describe("csv", () => {
  test("parses quotes, embedded commas/newlines, CRLF and a BOM", () => {
    const text = '﻿name,notes\r\n"Cafe, ""One""","line 1\nline 2"\r\nPlain,\r\n\r\n';
    expect(parseCsv(text)).toEqual([
      { name: 'Cafe, "One"', notes: "line 1\nline 2" },
      { name: "Plain", notes: "" },
    ]);
  });

  test("round-trips through toCsv", () => {
    const rows = [{ a: 'x,"y"', b: 2, c: null, d: ["p", "q"] }];
    expect(parseCsv(toCsv(rows))).toEqual([{ a: 'x,"y"', b: "2", c: "", d: "p;q" }]);
  });
});

describe("csv import", () => {
  let pg: PGlite;
  let db: Db;
  let sourceId: string;

  beforeAll(async () => {
    pg = await freshDb();
    db = pgliteDb(pg);
    sourceId = (await pg.query<{ id: string }>("select id from sources where slug = 'manual-admin'")).rows[0].id;
    await pg.exec(
      "insert into places (slug, name, type, lat, lng, status) values ('sample-cafe', 'Sample Cafe', 'specialty_cafe', 31.52, 74.35, 'published')",
    );
  });

  test("prices: normalizes, stages valid rows and reports unreadable lines", async () => {
    const csv = [
      "place_slug,item,size,volume,price,tax_inclusive,source_url",
      "sample-cafe,Caffè Latte,Regular,12 oz,\"Rs. 1,050/-\",yes,https://example.com/menu",
      "sample-cafe,Iced Spanish Latte,L,,Rs 950,,https://example.com/menu",
      "nowhere,Latte,Regular,,700,,https://example.com/menu",
      "sample-cafe,Mocha,Regular,,ask staff,,https://example.com/menu",
      "sample-cafe,Americano,Regular,,99999,,https://example.com/menu",
    ].join("\n");
    const r = await importCsv(db, { type: "prices", csv, sourceId, today: "2026-10-12" });
    expect(r).toMatchObject({ staged: 2, rejected: 1 });
    expect(r.lineErrors).toEqual([
      { line: 4, message: 'Unknown place_slug "nowhere"' },
      { line: 5, message: 'Can\'t read price "ask staff"' },
    ]);
    const rows = (await pg.query<{ proposed: Record<string, unknown>; flags: string[] }>(
      "select proposed, flags from staging_records where status = 'pending_review' order by (proposed->>'price_pkr')::int",
    )).rows;
    expect(rows[0].proposed).toMatchObject({
      item: { display_name: "Iced Spanish Latte", drink_type_slug: "iced-spanish-latte" },
      size: { size_label: "Large", volume_ml: 470, volume_is_assumed: true },
      price_pkr: 950,
    });
    expect(rows[0].flags).toContain("volume_assumed");
    expect(rows[1].proposed).toMatchObject({
      item: { drink_type_slug: "latte" },
      size: { volume_ml: 355, volume_is_assumed: false },
      price_pkr: 1050,
      tax_inclusive: true,
    });
  });

  test("missing required columns are reported up front", async () => {
    const r = await importCsv(db, { type: "places", csv: "name,lat\nX,31.5", sourceId });
    expect(r.lineErrors[0].message).toMatch(/Missing column\(s\): type, lng/);
  });
});

describe("review formatting", () => {
  const record = {
    kind: "item_price",
    place_id: "00000000-0000-4000-8000-000000000001",
    item: { display_name: "Latte", drink_type_slug: "latte", temperature: "hot", has_milk: true },
    size: { size_label: "Regular", volume_ml: 350, volume_is_assumed: false },
    channel: "dine_in",
    price_pkr: 750,
    tax_inclusive: null,
    source_url: "https://example.com/menu",
    proof_image_url: null,
    confidence: "verified",
    captured_at: "2026-10-12T10:00:00+05:00",
  };

  test("summaries", () => {
    expect(summarize(record, null, { price_pkr: { from: 600, to: 750 } })).toBe("Latte · Regular · Rs. 750 (was Rs. 600)");
  });

  test("editable fields round-trip with type coercion; identity fields are locked", () => {
    const fields = toEditableFields(record);
    expect(fields.find((f) => f.path === "place_id")?.locked).toBe(true);
    expect(fields.find((f) => f.path === "item.has_milk")).toMatchObject({ type: "boolean", value: "yes" });
    const edited = fromEditableFields(record, {
      price_pkr: "800",
      "item.display_name": "Cafe Latte",
      tax_inclusive: "no",
      "size.volume_ml": "",
      place_id: "11111111-1111-4111-8111-111111111111",
    });
    expect(edited).toMatchObject({ price_pkr: 800, tax_inclusive: false, item: { display_name: "Cafe Latte" }, size: { volume_ml: null } });
    expect(edited.place_id).toBe(record.place_id);
  });

  test("comparison rows mark changed fields", () => {
    const rows = comparisonRows("item_price", record, { price_pkr: 600, tax_inclusive: true, volume_ml: 350 }, { price_pkr: { from: 600, to: 750 } });
    expect(rows[0]).toEqual({ field: "Price (PKR)", live: "600", proposed: "750", changed: true });
  });
});
