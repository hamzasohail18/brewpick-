// OpenStreetMap -> PlaceRecord. Pure mapping, so it's tested against fixture JSON without the network.

import type { PlaceRecord } from "@/lib/pipeline/records";
import { LAHORE_BBOX } from "@/lib/pipeline/validate";
import { parseOpeningHours } from "./opening-hours";

/** Cafés, coffee shops and coffee kiosks inside Lahore's bounding box. `out center` gives ways/relations a point. */
export function buildOverpassQuery(bbox = LAHORE_BBOX): string {
  const b = `${bbox.minLat},${bbox.minLng},${bbox.maxLat},${bbox.maxLng}`;
  return `[out:json][timeout:90];
(
  nwr["amenity"="cafe"](${b});
  nwr["shop"="coffee"](${b});
  nwr["amenity"~"^(fast_food|restaurant)$"]["cuisine"~"coffee"](${b});
);
out center tags;`;
}

export interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

export interface Area {
  id: number;
  name: string;
  centroid_lat: number | null;
  centroid_lng: number | null;
}

const yes = (v?: string) => (v === undefined ? null : ["yes", "only", "wlan", "free", "customers", "wifi"].includes(v.toLowerCase()) ? true : v.toLowerCase() === "no" ? false : null);

function placeType(t: Record<string, string>): PlaceRecord["type"] {
  if (t.drive_through === "yes") return "kiosk_drive_thru";
  if (t.brand || t["brand:wikidata"]) return "chain";
  if (t.shop === "bakery" || /bakery|cake|pastry/.test(t.cuisine ?? "")) return "bakery_cafe";
  if (/kiosk/.test(t.shop ?? "") || t.building === "kiosk") return "kiosk_drive_thru";
  // OSM doesn't distinguish specialty coffee; reviewers can change it.
  return "specialty_cafe";
}

function address(t: Record<string, string>): string | null {
  if (t["addr:full"]) return t["addr:full"];
  const street = [t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" ");
  const parts = [street, t["addr:suburb"] ?? t["addr:neighbourhood"], t["addr:city"]].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

function website(t: Record<string, string>): string | null {
  const w = t.website ?? t["contact:website"];
  if (!w) return null;
  const url = /^https?:\/\//i.test(w) ? w : `https://${w}`;
  try {
    return new URL(url).toString();
  } catch {
    return null;
  }
}

function instagram(t: Record<string, string>): string | null {
  const v = t["contact:instagram"] ?? t.instagram;
  if (!v) return null;
  const m = v.match(/instagram\.com\/([A-Za-z0-9._]+)/i);
  return (m ? m[1] : v.replace(/^@/, "")).trim() || null;
}

const LOCATION_WORDS = /\b(mall|branch|phase \d+|block [a-z0-9]+|sector [a-z0-9]+|plaza|market|road|boulevard)\b/i;

/**
 * "Tim Hortons - Bahria Town" -> name "Tim Hortons", branch "Bahria Town". Only splits when the
 * suffix is clearly a location (known area, "... Mall", "Phase 5") or the prefix is the OSM brand;
 * "Drip - Coffee Brewery & Bakery" is a tagline and stays whole.
 */
export function splitBranch(name: string, brand: string | undefined, areaNames: string[]): { name: string; branch: string | null } {
  const m = name.match(/^(.+?)\s+[-–|]\s+(.+)$/);
  if (!m) return { name, branch: null };
  const [, head, tail] = m;
  const isArea = areaNames.some((a) => tail.toLowerCase().includes(a.toLowerCase()));
  const isBrand = brand !== undefined && head.trim().toLowerCase() === brand.trim().toLowerCase();
  return isArea || isBrand || LOCATION_WORDS.test(tail) ? { name: head.trim(), branch: tail.trim() } : { name, branch: null };
}

/** Nearest area centroid within maxKm, else null (equirectangular distance is fine at city scale). */
export function nearestArea(lat: number, lng: number, areas: Area[], maxKm = 4): number | null {
  let best: { id: number; km: number } | null = null;
  for (const a of areas) {
    if (a.centroid_lat === null || a.centroid_lng === null) continue;
    const x = (Number(a.centroid_lng) - lng) * Math.cos((lat * Math.PI) / 180) * 111.32;
    const y = (Number(a.centroid_lat) - lat) * 110.57;
    const km = Math.hypot(x, y);
    if (km <= maxKm && (!best || km < best.km)) best = { id: a.id, km };
  }
  return best?.id ?? null;
}

export interface MapResult {
  records: PlaceRecord[];
  skipped: { osmId: string; reason: string }[];
}

export function mapOverpass(elements: OverpassElement[], areas: Area[], capturedAt: string): MapResult {
  const records: PlaceRecord[] = [];
  const skipped: MapResult["skipped"] = [];
  const b = LAHORE_BBOX;

  for (const el of elements) {
    const osmId = `${el.type}/${el.id}`;
    const t = el.tags ?? {};
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    const name = t["name:en"] ?? t.name;
    if (!name) {
      skipped.push({ osmId, reason: "no name" });
      continue;
    }
    if (lat === undefined || lng === undefined) {
      skipped.push({ osmId, reason: "no coordinates" });
      continue;
    }
    if (lat < b.minLat || lat > b.maxLat || lng < b.minLng || lng > b.maxLng) {
      skipped.push({ osmId, reason: "outside Lahore" });
      continue;
    }
    if (t.disused === "yes" || t["disused:amenity"] || t.abandoned === "yes") {
      skipped.push({ osmId, reason: "marked disused" });
      continue;
    }
    const split = t.branch ? { name: name.trim(), branch: t.branch.trim() } : splitBranch(name.trim(), t.brand, areas.map((a) => a.name));
    records.push({
      kind: "place",
      name: split.name,
      branch_name: split.branch,
      type: placeType(t),
      area_id: nearestArea(lat, lng, areas),
      address: address(t),
      lat: Number(lat.toFixed(6)),
      lng: Number(lng.toFixed(6)),
      phone: t.phone ?? t["contact:phone"] ?? null,
      website_url: website(t),
      instagram_handle: instagram(t),
      osm_id: osmId,
      google_place_id: null,
      halal_certified: yes(t["diet:halal"]),
      has_wifi: yes(t.internet_access),
      has_family_seating: null, // no OSM tag for this
      has_drive_thru: yes(t.drive_through),
      hours: parseOpeningHours(t.opening_hours),
      source_url: `https://www.openstreetmap.org/${osmId}`,
      proof_image_url: null,
      confidence: "community_reported",
      captured_at: capturedAt,
    });
  }
  return { records, skipped };
}
