// Google Places API (New) Text Search response -> PlaceRecords. Pure.
// Field names follow https://developers.google.com/maps/documentation/places/web-service/text-search

import type { HoursEntry, PlaceRecord } from "@/lib/pipeline/records";
import { LAHORE_BBOX } from "@/lib/pipeline/validate";
import { nearestArea, type Area } from "../osm/overpass";

export interface GooglePlace {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  nationalPhoneNumber?: string;
  websiteUri?: string;
  googleMapsUri?: string;
  types?: string[];
  primaryType?: string;
  businessStatus?: "OPERATIONAL" | "CLOSED_TEMPORARILY" | "CLOSED_PERMANENTLY";
  regularOpeningHours?: { periods?: GooglePeriod[] };
}

interface GooglePoint {
  day: number; // 0 = Sunday
  hour: number;
  minute: number;
}
interface GooglePeriod {
  open: GooglePoint;
  close?: GooglePoint;
}

/** Only fields we store; Google bills by field mask, so ask for nothing else. */
export const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.nationalPhoneNumber",
  "places.websiteUri",
  "places.googleMapsUri",
  "places.types",
  "places.primaryType",
  "places.businessStatus",
  "places.regularOpeningHours",
  "nextPageToken",
].join(",");

export const SEARCHES = ["coffee shop in Lahore", "cafe in Lahore"];

export function searchBody(textQuery: string, pageToken?: string) {
  return {
    textQuery,
    pageSize: 20,
    ...(pageToken ? { pageToken } : {}),
    locationRestriction: {
      rectangle: {
        low: { latitude: LAHORE_BBOX.minLat, longitude: LAHORE_BBOX.minLng },
        high: { latitude: LAHORE_BBOX.maxLat, longitude: LAHORE_BBOX.maxLng },
      },
    },
  };
}

const hhmm = (p: GooglePoint) => `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;

/** One range per day (first open to last close), like the OSM parser. A single open-only period = 24/7. */
export function googleHours(periods: GooglePeriod[] | undefined): HoursEntry[] | null {
  if (!periods?.length) return null;
  if (periods.length === 1 && !periods[0].close) {
    return [0, 1, 2, 3, 4, 5, 6].map((d) => ({ day_of_week: d, opens: "00:00", closes: "23:59", is_closed: false }));
  }
  const days = new Map<number, { opens: string; closes: string }>();
  for (const p of periods) {
    if (!p.close) return null;
    const cur = days.get(p.open.day);
    const opens = hhmm(p.open);
    const closes = hhmm(p.close) === "00:00" && p.close.day !== p.open.day ? "23:59" : hhmm(p.close);
    days.set(p.open.day, cur ? { opens: cur.opens < opens ? cur.opens : opens, closes } : { opens, closes });
  }
  return [0, 1, 2, 3, 4, 5, 6].map((d) => {
    const h = days.get(d);
    return h ? { day_of_week: d, ...h, is_closed: false } : { day_of_week: d, opens: null, closes: null, is_closed: true };
  });
}

function placeType(p: GooglePlace): PlaceRecord["type"] {
  const types = new Set([p.primaryType, ...(p.types ?? [])]);
  if (types.has("bakery")) return "bakery_cafe";
  return "specialty_cafe";
}

const safeUrl = (u: string | undefined) => (u && /^https?:\/\//i.test(u) ? u : null);

export function mapGooglePlaces(places: GooglePlace[], areas: Area[], capturedAt: string) {
  const records: PlaceRecord[] = [];
  const skipped: { id: string; reason: string }[] = [];
  for (const p of places) {
    const name = p.displayName?.text?.trim();
    if (!name || !p.location) {
      skipped.push({ id: p.id, reason: "no name or location" });
      continue;
    }
    if (p.businessStatus === "CLOSED_PERMANENTLY") {
      skipped.push({ id: p.id, reason: "permanently closed" });
      continue;
    }
    const { latitude: lat, longitude: lng } = p.location;
    records.push({
      kind: "place",
      name,
      branch_name: null,
      type: placeType(p),
      area_id: nearestArea(lat, lng, areas),
      address: p.formattedAddress ?? null,
      lat,
      lng,
      phone: p.nationalPhoneNumber ?? null,
      website_url: safeUrl(p.websiteUri),
      instagram_handle: null,
      osm_id: null,
      google_place_id: p.id,
      halal_certified: null,
      has_wifi: null,
      has_family_seating: null,
      has_drive_thru: null,
      hours: googleHours(p.regularOpeningHours?.periods),
      // Google's documented place-ID link, if the response left the Maps URL out.
      source_url: safeUrl(p.googleMapsUri) ?? `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(p.id)}`,
      proof_image_url: null,
      confidence: "community_reported",
      captured_at: capturedAt,
    });
  }
  return { records, skipped };
}
