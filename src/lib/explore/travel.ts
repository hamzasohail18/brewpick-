// Distance and a rough travel time. No routing service: straight-line distance with stated assumptions,
// so it works offline and the user's location never leaves the phone.

import { distanceM } from "@/lib/capture/geo";

export { distanceM };

/** Assumptions behind the estimate (shown in the UI next to the number). */
export const TRAVEL_ASSUMPTIONS = {
  roadFactor: 1.35, // city roads are ~35% longer than the straight line
  walkKmh: 4.5,
  driveKmh: 18, // average Lahore city traffic, door to door
  walkUpToM: 1200, // beyond this we assume you'd drive or take a ride
  driveOverheadMin: 3, // parking / pickup
} as const;

export const TRAVEL_ASSUMPTIONS_TEXT =
  `Estimated from straight-line distance × ${TRAVEL_ASSUMPTIONS.roadFactor} for roads; ` +
  `walking at ${TRAVEL_ASSUMPTIONS.walkKmh} km/h up to ${TRAVEL_ASSUMPTIONS.walkUpToM / 1000} km, otherwise driving at ` +
  `${TRAVEL_ASSUMPTIONS.driveKmh} km/h plus ${TRAVEL_ASSUMPTIONS.driveOverheadMin} min. Real traffic varies.`;

export interface TravelEstimate {
  mode: "walk" | "drive";
  minutes: number;
}

export function travelEstimate(straightLineM: number): TravelEstimate {
  const a = TRAVEL_ASSUMPTIONS;
  const roadM = straightLineM * a.roadFactor;
  if (straightLineM <= a.walkUpToM) {
    return { mode: "walk", minutes: Math.max(1, Math.round(roadM / ((a.walkKmh * 1000) / 60))) };
  }
  return { mode: "drive", minutes: Math.round(roadM / ((a.driveKmh * 1000) / 60) + a.driveOverheadMin) };
}

export function formatTravel(t: TravelEstimate): string {
  const time = t.minutes >= 60 ? `${Math.floor(t.minutes / 60)} h ${t.minutes % 60} min` : `${t.minutes} min`;
  return `${time} ${t.mode === "walk" ? "walk" : "drive"}`;
}
