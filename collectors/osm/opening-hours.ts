// Parser for the common subset of OSM's opening_hours syntax (https://wiki.openstreetmap.org/wiki/Key:opening_hours):
//   "24/7", "Mo-Su 09:00-23:00", "Mo-Fr 08:00-22:00; Sa,Su 10:00-24:00", "Mo-Th 12:00-01:00; Fr off",
//   "09:00-23:00" (every day), "12:00-15:00,18:00-23:00" (split shifts -> first open to last close).
// Anything else (public-holiday rules, months, sunrise, comments) returns null rather than a guess.

import type { HoursEntry } from "@/lib/pipeline/records";

const DAYS: Record<string, number> = { su: 0, mo: 1, tu: 2, we: 3, th: 4, fr: 5, sa: 6 };
const ORDER = [1, 2, 3, 4, 5, 6, 0]; // OSM ranges run Mo..Su

function expandDays(spec: string): number[] | null {
  const out = new Set<number>();
  for (const part of spec.split(",")) {
    const m = part.trim().toLowerCase().match(/^([a-z]{2})(?:-([a-z]{2}))?$/);
    if (!m || !(m[1] in DAYS) || (m[2] && !(m[2] in DAYS))) return null;
    if (!m[2]) {
      out.add(DAYS[m[1]]);
      continue;
    }
    const from = ORDER.indexOf(DAYS[m[1]]);
    const to = ORDER.indexOf(DAYS[m[2]]);
    for (let i = from; ; i = (i + 1) % 7) {
      out.add(ORDER[i]);
      if (i === to) break;
    }
  }
  return [...out];
}

function parseRanges(spec: string): { opens: string; closes: string } | null {
  const ranges = spec.split(",").map((r) => r.trim().match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})\+?$/));
  if (ranges.some((r) => !r)) return null;
  const fmt = (h: string, m: string) => {
    const hh = Number(h) % 24; // "24:00" and "26:00" (2am next day) wrap
    return `${String(hh).padStart(2, "0")}:${m}`;
  };
  const first = ranges[0]!;
  const last = ranges.at(-1)!;
  return { opens: fmt(first[1], first[2]), closes: fmt(last[3], last[4]) };
}

export function parseOpeningHours(raw: string | undefined | null): HoursEntry[] | null {
  if (!raw) return null;
  const value = raw.trim();
  if (value === "24/7") return [0, 1, 2, 3, 4, 5, 6].map((d) => ({ day_of_week: d, opens: "00:00", closes: "23:59", is_closed: false }));

  const week = new Map<number, HoursEntry>();
  for (const rule of value.split(";").map((r) => r.trim()).filter(Boolean)) {
    // Optional day spec, then a time spec or off/closed.
    const m = rule.match(/^((?:[A-Za-z]{2}(?:-[A-Za-z]{2})?)(?:\s*,\s*[A-Za-z]{2}(?:-[A-Za-z]{2})?)*)?\s*(.*)$/);
    if (!m) return null;
    const days = m[1] ? expandDays(m[1].replace(/\s+/g, "")) : [0, 1, 2, 3, 4, 5, 6];
    if (!days) return null;
    const timeSpec = m[2].trim().toLowerCase();
    if (timeSpec === "off" || timeSpec === "closed") {
      for (const d of days) week.set(d, { day_of_week: d, opens: null, closes: null, is_closed: true });
      continue;
    }
    const range = parseRanges(timeSpec);
    if (!range) return null;
    // Later rules override earlier ones for the same day (OSM semantics).
    for (const d of days) week.set(d, { day_of_week: d, ...range, is_closed: false });
  }
  if (week.size === 0) return null;
  return [...week.values()].sort((a, b) => a.day_of_week - b.day_of_week);
}
