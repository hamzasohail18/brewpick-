import { beforeAll, describe, expect, test } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { pgliteDb, type Db } from "@/lib/db/core";
import { checkGeotag, distanceM } from "@/lib/capture/geo";
import { CaptureRejected, processCapture } from "@/lib/capture/process";
import { CaptureSubmission } from "@/lib/capture/schema";
import { readUpload, stripJpegMetadata } from "@/lib/uploads";
import { freshDb } from "../db/harness";

describe("geotag", () => {
  const shop = { lat: 31.5151, lng: 74.3438 };

  test("distance", () => {
    expect(distanceM(shop, { lat: 31.5151, lng: 74.3438 })).toBe(0);
    expect(distanceM(shop, { lat: 31.5241, lng: 74.3438 })).toBeGreaterThan(995); // ~1 km north
    expect(distanceM(shop, { lat: 31.5241, lng: 74.3438 })).toBeLessThan(1005);
  });

  test("ok inside the radius, GPS accuracy counts in the volunteer's favour (up to 100 m), far beyond", () => {
    expect(checkGeotag(shop, { lat: 31.5161, lng: 74.3438, accuracy_m: 15 }).status).toBe("ok"); // ~111 m
    expect(checkGeotag(shop, { lat: 31.5176, lng: 74.3438, accuracy_m: 80 }).status).toBe("ok"); // ~278 m - 80 = 198 m
    expect(checkGeotag(shop, { lat: 31.5178, lng: 74.3438, accuracy_m: 10 }).status).toBe("far");
    expect(checkGeotag(shop, { lat: 31.5241, lng: 74.3438, accuracy_m: 5000 }).status).toBe("far"); // slack capped at 100 m
    expect(checkGeotag(shop, null)).toEqual({ status: "missing", distanceM: null, accuracyM: null });
  });
});

describe("photo handling", () => {
  // SOI, APP0 (JFIF), APP1 (EXIF with fake GPS), DQT, SOS + data, EOI
  const seg = (marker: number, payload: number[]) => [0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 0xff, ...payload];
  const exif = [...Buffer.from("Exif\0\0GPS 31.5151 74.3438")];
  const jpeg = Uint8Array.from([
    0xff, 0xd8,
    ...seg(0xe0, [...Buffer.from("JFIF\0"), 1, 1, 0, 0, 1, 0, 1, 0, 0]),
    ...seg(0xe1, exif),
    ...seg(0xdb, [0, ...Array(64).fill(1)]),
    ...seg(0xda, [1, 1, 0, 0, 0x3f, 0]),
    0x12, 0x34, 0x56,
    0xff, 0xd9,
  ]);

  test("EXIF (APP1) is removed and the rest kept byte for byte", () => {
    const out = stripJpegMetadata(jpeg);
    expect(Buffer.from(out).includes(Buffer.from("GPS"))).toBe(false);
    expect(out.length).toBe(jpeg.length - (exif.length + 4));
    expect([...out.slice(-5)]).toEqual([0x12, 0x34, 0x56, 0xff, 0xd9]);
  });

  test("non-JPEG input is refused", () => {
    expect(() => stripJpegMetadata(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 0]))).toThrow(/Not a JPEG/);
  });

  test("upload paths can't escape the upload folder", async () => {
    expect(await readUpload(["..", "..", "package.json"])).toBeNull();
    expect(await readUpload(["2026", "..%2F..", "x.jpg"])).toBeNull();
    expect(await readUpload(["2026", "10", "missing.jpg"])).toBeNull();
  });
});

describe("processing a capture (on sample data)", () => {
  let pg: PGlite;
  let db: Db;
  let place: { id: string; lat: number; lng: number };
  const USER = "00000000-0000-4000-8000-0000000000f1";
  const PHOTO = "http://localhost:3000/uploads/2026/10/test.jpg";
  let n = 0;
  const submission = (over: Partial<CaptureSubmission> = {}): CaptureSubmission =>
    CaptureSubmission.parse({
      id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
      place_id: place.id,
      captured_at: "2026-10-12T10:00:00+05:00",
      location: { lat: place.lat + 0.0003, lng: place.lng, accuracy_m: 20 },
      items: [{ name: "Cafe Latte", size: "Regular", price: "Rs. 2,000" }],
      ...over,
    });
  const run = (s: CaptureSubmission) => db.transaction((tx) => processCapture(tx, { userId: USER, submission: s, photoUrls: [PHOTO] }));

  beforeAll(async () => {
    pg = await freshDb({ sample: true });
    db = pgliteDb(pg);
    place = (await pg.query<{ id: string; lat: number; lng: number }>("select id, lat::float8 lat, lng::float8 lng from places where slug = 'kite-and-cup'")).rows[0];
  });

  test("a changed price goes to review as verified field capture with the photo as evidence", async () => {
    const r = await run(submission());
    expect(r).toMatchObject({ duplicate: false, staged: 1, geotag: { status: "ok" } });
    const row = (await pg.query<{ proposed: Record<string, unknown>; evidence_url: string; flags: string[]; messages: string[]; slug: string }>(
      `select r.proposed, r.evidence_url, r.flags, r.messages, s.slug from staging_records r join sources s on s.id = r.source_id
        where r.status = 'pending_review'`,
    )).rows[0];
    expect(row.slug).toBe("field-capture");
    expect(row.proposed).toMatchObject({ price_pkr: 2000, confidence: "verified", proof_image_url: PHOTO, item: { drink_type_slug: "latte" } });
    expect(row.evidence_url).toBe(PHOTO);
    expect(row.flags).toContain("price_change_over_15pct");
    expect(row.messages.join(" ")).toMatch(/Captured \d+ m from the shop/);
    const fc = (await pg.query<{ distance_m: number; geotag_status: string }>("select distance_m, geotag_status from field_captures")).rows[0];
    expect(fc.geotag_status).toBe("ok");
    expect(fc.distance_m).toBeGreaterThan(20);
    expect(Object.keys(fc)).not.toContain("lat"); // the volunteer's position isn't stored
  });

  test("unchanged prices are re-confirmed; an unreadable price is reported per row", async () => {
    const current = (await pg.query<{ price_pkr: number }>("select price_pkr from v_current_menu where place_id = $1 and display_name = 'Espresso' and size_label = 'Single'", [place.id])).rows[0];
    const r = await run(submission({ items: [{ name: "Espresso", size: "Single", volume: "", price: String(current.price_pkr), temperature: "" }, { name: "Mocha", size: "Regular", volume: "", price: "ask", temperature: "" }] }));
    expect(r).toMatchObject({ reconfirmed: 1, staged: 0, itemErrors: [{ row: 2, message: 'Can\'t read price "ask"' }] });
  });

  test("the same capture sent twice (offline retry) is stored once", async () => {
    const s = submission();
    await run(s);
    const again = await run(s);
    expect(again.duplicate).toBe(true);
    expect((await pg.query("select 1 from field_captures where id = $1", [s.id])).rows).toHaveLength(1);
  });

  test("far from the shop is refused; no location is allowed but flagged", async () => {
    await expect(run(submission({ location: { lat: place.lat + 0.05, lng: place.lng, accuracy_m: 10 } }))).rejects.toThrow(CaptureRejected);
    const r = await run(submission({ location: null, items: [{ name: "Flat White", size: "Regular", volume: "", price: "1500", temperature: "" }] }));
    expect(r.geotag.status).toBe("missing");
    const flags = (await pg.query<{ flags: string[] }>("select flags from staging_records where proposed->'item'->>'display_name' = 'Flat White' and status = 'pending_review'")).rows[0].flags;
    expect(flags).toContain("geotag_missing");
  });

  test("a full-menu capture proposes removal of drinks it doesn't list", async () => {
    const r = await run(submission({ full_menu: true, items: [{ name: "Cafe Latte", size: "Regular", volume: "", price: "2000", temperature: "" }] }));
    expect(r.removals).toBeGreaterThan(5);
  });

  test("unpublished or unknown places are refused", async () => {
    await expect(run(submission({ place_id: "00000000-0000-4000-8000-0000000fffff" }))).rejects.toThrow(/isn't in the directory/);
  });
});
