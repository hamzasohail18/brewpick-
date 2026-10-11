// Sources rarely know everything about a place (Google has no Wi-Fi flag; a cafe's website has
// hours but no coordinates). The diff engine compares every field, so a partial record would read as
// "clear the phone number". These helpers fill the gaps from the live row so a review shows only what
// the source actually says.

import type { Db } from "@/lib/db/core";
import { findCurrent } from "@/lib/pipeline/match";
import type { HoursEntry, PlaceRecord } from "@/lib/pipeline/records";

const FILLABLE = [
  "branch_name",
  "address",
  "phone",
  "website_url",
  "instagram_handle",
  "halal_certified",
  "has_wifi",
  "has_family_seating",
  "has_drive_thru",
  "osm_id",
  "google_place_id",
] as const;

/** Inverse of hoursKeys(): "1:08:00-22:00" / "0:closed" back to entries. */
export function hoursFromKeys(keys: string[]): HoursEntry[] {
  return keys.map((k) => {
    const [day, rest] = [k.slice(0, k.indexOf(":")), k.slice(k.indexOf(":") + 1)];
    if (rest === "closed") return { day_of_week: Number(day), opens: null, closes: null, is_closed: true };
    const [opens, closes] = rest.split("-");
    return { day_of_week: Number(day), opens, closes, is_closed: false };
  });
}

/** Keep the live value wherever the source has nothing to say. New places pass through unchanged. */
export async function fillFromLive(tx: Db, r: PlaceRecord): Promise<PlaceRecord> {
  const m = await findCurrent(tx, r);
  if (!m.current) return r;
  const live = m.current as Record<string, unknown>;
  const out: Record<string, unknown> = { ...r };
  for (const f of FILLABLE) if (out[f] == null && live[f] != null) out[f] = live[f];
  if (r.hours == null && Array.isArray(live.hours)) out.hours = hoursFromKeys(live.hours as string[]);
  return out as PlaceRecord;
}

/** The live place as a PlaceRecord, for sources tied to one place that only update some fields. */
export async function livePlaceRecord(
  tx: Db,
  placeId: string,
  provenance: Pick<PlaceRecord, "source_url" | "proof_image_url" | "confidence" | "captured_at">,
): Promise<PlaceRecord | null> {
  const [p] = await tx.query<Record<string, unknown>>(
    `select name, branch_name, type, area_id, address, lat, lng, phone, website_url, instagram_handle, osm_id, google_place_id,
            halal_certified, has_wifi, has_family_seating, has_drive_thru
       from places where id = $1`,
    [placeId],
  );
  if (!p) return null;
  const hours = await tx.query<HoursEntry>(
    `select day_of_week, to_char(opens_at, 'HH24:MI') as opens, to_char(closes_at, 'HH24:MI') as closes, is_closed
       from place_hours where place_id = $1 order by day_of_week`,
    [placeId],
  );
  return {
    kind: "place",
    ...(p as Omit<PlaceRecord, "kind" | "lat" | "lng" | "hours">),
    lat: Number(p.lat),
    lng: Number(p.lng),
    hours: hours.length ? hours : null,
    ...provenance,
  } as PlaceRecord;
}
