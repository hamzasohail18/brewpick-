// Geotag check for Menu Capture: is the volunteer actually at the place?

export const DEFAULT_MAX_DISTANCE_M = 200;

/** Great-circle distance in metres. */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

export type GeotagStatus = "ok" | "far" | "missing";

export interface Geotag {
  status: GeotagStatus;
  distanceM: number | null;
  accuracyM: number | null;
}

/**
 * Indoors, phone GPS is often off by tens of metres, so the reported accuracy (capped at 100 m)
 * counts in the volunteer's favour. No location at all is allowed but flagged for the reviewer.
 */
export function checkGeotag(
  place: { lat: number; lng: number },
  loc: { lat: number; lng: number; accuracy_m: number } | null,
  maxM = DEFAULT_MAX_DISTANCE_M,
): Geotag {
  if (!loc) return { status: "missing", distanceM: null, accuracyM: null };
  const d = distanceM(place, loc);
  const slack = Math.min(Math.max(loc.accuracy_m, 0), 100);
  return { status: d - slack <= maxM ? "ok" : "far", distanceM: d, accuracyM: Math.round(loc.accuracy_m) };
}

export function formatDistance(m: number): string {
  return m < 1000 ? `${m} m` : `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`;
}
