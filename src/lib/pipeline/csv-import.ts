// CSV import (Section 9): turns a spreadsheet into normalized records and stages them, so imported
// data goes through the same validation, diff and review as collected data.

import type { Db } from "@/lib/db/core";
import { parseCsv } from "./csv";
import { matchDrinkType, parsePkr, parseSize } from "./normalize";
import { stageRecords, type StageSummary } from "./stage";

export const CSV_TYPES = {
  prices: {
    label: "Menu prices",
    columns: ["place_slug", "item", "size", "volume", "price", "channel", "tax_inclusive", "temperature", "has_milk", "source_url", "proof_image_url", "confidence"],
    required: ["place_slug", "item", "price"],
  },
  places: {
    label: "Places",
    columns: ["name", "branch", "type", "area", "address", "lat", "lng", "phone", "website", "instagram", "halal", "wifi", "family_seating", "drive_thru", "osm_id", "source_url", "confidence"],
    required: ["name", "type", "lat", "lng"],
  },
} as const;
export type CsvType = keyof typeof CSV_TYPES;

export interface CsvImportResult extends StageSummary {
  /** Problems found before staging (unknown place, unparseable price...), by 1-based CSV line. */
  lineErrors: { line: number; message: string }[];
}

const bool = (v: string | undefined): boolean | null => {
  const s = (v ?? "").trim().toLowerCase();
  if (["y", "yes", "true", "1"].includes(s)) return true;
  if (["n", "no", "false", "0"].includes(s)) return false;
  return null;
};
const orNull = (v: string | undefined) => (v && v.trim() ? v.trim() : null);
const CONFIDENCE = new Set(["verified", "community_reported", "estimated"]);

export async function importCsv(
  db: Db,
  opts: { type: CsvType; csv: string; sourceId: string; capturedAt?: string; today?: string },
): Promise<CsvImportResult> {
  const rows = parseCsv(opts.csv);
  const lineErrors: CsvImportResult["lineErrors"] = [];
  const capturedAt = opts.capturedAt ?? new Date().toISOString();
  const spec = CSV_TYPES[opts.type];

  const missingCols = spec.required.filter((c) => rows.length && !(c in rows[0]));
  if (missingCols.length) {
    return { staged: 0, rejected: 0, reconfirmed: 0, superseded: 0, removals: 0, lineErrors: [{ line: 1, message: `Missing column(s): ${missingCols.join(", ")}` }] };
  }

  const records: unknown[] = [];

  if (opts.type === "prices") {
    const places = new Map(
      (await db.query<{ id: string; slug: string }>("select id, slug from places")).map((p) => [p.slug, p.id]),
    );
    const drinkTypes = await db.query<{ slug: string; aliases: string[] }>("select slug, aliases from drink_types");
    rows.forEach((row, i) => {
      const line = i + 2;
      const placeId = places.get(row.place_slug);
      if (!placeId) return lineErrors.push({ line, message: `Unknown place_slug "${row.place_slug}"` });
      const pkr = parsePkr(row.price);
      if (pkr === null) return lineErrors.push({ line, message: `Can't read price "${row.price}"` });
      const channel = orNull(row.channel) ?? "dine_in";
      const confidence = orNull(row.confidence) ?? "community_reported";
      if (!CONFIDENCE.has(confidence)) return lineErrors.push({ line, message: `Unknown confidence "${confidence}"` });
      const drink = matchDrinkType(row.item, drinkTypes);
      records.push({
        kind: "item_price",
        place_id: placeId,
        item: {
          display_name: row.item,
          drink_type_slug: drink?.slug ?? null,
          temperature: orNull(row.temperature),
          has_milk: bool(row.has_milk),
        },
        size: parseSize(row.size, row.volume),
        channel,
        price_pkr: pkr,
        tax_inclusive: bool(row.tax_inclusive),
        source_url: orNull(row.source_url),
        proof_image_url: orNull(row.proof_image_url),
        confidence,
        captured_at: capturedAt,
      });
    });
  } else {
    const areas = new Map((await db.query<{ id: number; name: string }>("select id, name from areas")).map((a) => [a.name.toLowerCase(), a.id]));
    rows.forEach((row, i) => {
      const line = i + 2;
      const lat = Number(row.lat);
      const lng = Number(row.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return lineErrors.push({ line, message: "lat/lng must be numbers" });
      const area = orNull(row.area);
      if (area && !areas.has(area.toLowerCase())) return lineErrors.push({ line, message: `Unknown area "${area}"` });
      records.push({
        kind: "place",
        name: row.name,
        branch_name: orNull(row.branch),
        type: row.type,
        area_id: area ? areas.get(area.toLowerCase()) : null,
        address: orNull(row.address),
        lat,
        lng,
        phone: orNull(row.phone),
        website_url: orNull(row.website),
        instagram_handle: orNull(row.instagram)?.replace(/^@/, "") ?? null,
        osm_id: orNull(row.osm_id),
        halal_certified: bool(row.halal),
        has_wifi: bool(row.wifi),
        has_family_seating: bool(row.family_seating),
        has_drive_thru: bool(row.drive_thru),
        source_url: orNull(row.source_url),
        confidence: orNull(row.confidence) ?? "community_reported",
        captured_at: capturedAt,
      });
    });
  }

  const summary = records.length
    ? await stageRecords(db, { sourceId: opts.sourceId, records, today: opts.today })
    : { staged: 0, rejected: 0, reconfirmed: 0, superseded: 0, removals: 0 };
  return { ...summary, lineErrors };
}
