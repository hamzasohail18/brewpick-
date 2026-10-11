// Turns a Menu Capture submission into staged price records (field-capture source, verified after
// review). Idempotent on the client-generated capture id.

import type { Db } from "@/lib/db/core";
import { matchDrinkType, parsePkr, parseSize } from "@/lib/pipeline/normalize";
import { stageRecords } from "@/lib/pipeline/stage";
import { checkGeotag, formatDistance, type Geotag } from "./geo";
import type { CaptureSubmission } from "./schema";

export interface CaptureResult {
  id: string;
  duplicate: boolean;
  geotag: Geotag;
  staged: number;
  reconfirmed: number;
  rejected: number;
  removals: number;
  /** Rows the server couldn't read (bad price), by 1-based row number. */
  itemErrors: { row: number; message: string }[];
}

export class CaptureRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CaptureRejected";
  }
}

/** The stored result of a capture already received (an offline outbox may send the same one twice). */
export async function findCapture(db: Db, id: string): Promise<CaptureResult | null> {
  const [row] = await db.query<{
    geotag_status: Geotag["status"];
    distance_m: number | null;
    accuracy_m: number | null;
    items_staged: number;
    items_reconfirmed: number;
    items_rejected: number;
  }>("select * from field_captures where id = $1", [id]);
  if (!row) return null;
  return {
    id,
    duplicate: true,
    geotag: { status: row.geotag_status, distanceM: row.distance_m, accuracyM: row.accuracy_m },
    staged: row.items_staged,
    reconfirmed: row.items_reconfirmed,
    rejected: row.items_rejected,
    removals: 0,
    itemErrors: [],
  };
}

export async function processCapture(
  db: Db,
  opts: { userId: string; submission: CaptureSubmission; photoUrls: string[]; maxDistanceM?: number },
): Promise<CaptureResult> {
  const s = opts.submission;
  return db.transaction(async (tx) => {
    const existing = await findCapture(tx, s.id);
    if (existing) return existing;

    const [place] = await tx.query<{ id: string; name: string; lat: string; lng: string }>(
      "select id, name, lat, lng from places where id = $1 and status = 'published'",
      [s.place_id],
    );
    if (!place) throw new CaptureRejected("That place isn't in the directory (or isn't published).");

    const geotag = checkGeotag({ lat: Number(place.lat), lng: Number(place.lng) }, s.location, opts.maxDistanceM);
    if (geotag.status === "far") {
      throw new CaptureRejected(
        `You were ${formatDistance(geotag.distanceM!)} from ${place.name}. Captures have to be made in the shop.`,
      );
    }

    const [source] = await tx.query<{ id: string }>("select id from sources where slug = 'field-capture'");
    if (!source) throw new Error("The field-capture source is missing from the registry.");

    const drinkTypes = await tx.query<{ slug: string; aliases: string[] }>("select slug, aliases from drink_types");
    const itemErrors: CaptureResult["itemErrors"] = [];
    const records: unknown[] = [];
    s.items.forEach((item, i) => {
      const price = parsePkr(item.price);
      if (price === null) return itemErrors.push({ row: i + 1, message: `Can't read price "${item.price}"` });
      const drink = matchDrinkType(item.name, drinkTypes);
      records.push({
        kind: "item_price",
        place_id: place.id,
        item: {
          display_name: item.name,
          drink_type_slug: drink?.slug ?? null,
          temperature: item.temperature || null,
          has_milk: null,
        },
        size: parseSize(item.size, item.volume || null),
        channel: "dine_in",
        price_pkr: price,
        tax_inclusive: s.tax_inclusive === "" ? null : s.tax_inclusive === "yes",
        source_url: null,
        proof_image_url: opts.photoUrls[0],
        confidence: "verified",
        captured_at: s.captured_at,
      });
    });

    const extraMessages = [
      geotag.status === "missing"
        ? "No location from the phone: check the photo really is this shop's menu."
        : `Captured ${formatDistance(geotag.distanceM!)} from the shop (GPS accuracy ±${geotag.accuracyM} m).`,
      ...(opts.photoUrls.length > 1 ? [`${opts.photoUrls.length} photos: ${opts.photoUrls.join(" ")}`] : []),
      ...(s.notes ? [`Volunteer note: ${s.notes}`] : []),
    ];

    const summary = await stageRecords(tx, {
      sourceId: source.id,
      records,
      evidenceUrl: opts.photoUrls[0],
      completeMenus: s.full_menu && itemErrors.length === 0 ? [{ place_id: place.id, channel: "dine_in" }] : [],
      extraFlags: geotag.status === "missing" ? ["geotag_missing"] : [],
      extraMessages,
    });

    await tx.query(
      `insert into field_captures (id, user_id, place_id, captured_at, geotag_status, distance_m, accuracy_m, photo_urls,
                                   full_menu, notes, items_submitted, items_staged, items_reconfirmed, items_rejected)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        s.id, opts.userId, place.id, s.captured_at, geotag.status, geotag.distanceM, geotag.accuracyM, opts.photoUrls,
        s.full_menu, s.notes || null, s.items.length, summary.staged, summary.reconfirmed, summary.rejected + itemErrors.length,
      ],
    );

    return {
      id: s.id,
      duplicate: false,
      geotag,
      staged: summary.staged,
      reconfirmed: summary.reconfirmed,
      rejected: summary.rejected,
      removals: summary.removals,
      itemErrors,
    };
  });
}
