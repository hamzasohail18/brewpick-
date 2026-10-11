import { describe, expect, test } from "vitest";
import { describeOpenStatus, formatClock, openStatus, weeklyHours, type HoursRow } from "@/lib/explore/hours";
import { formatTravel, travelEstimate } from "@/lib/explore/travel";
import { activeFilterCount, filtersToParams, hasDrinkFilters, parseFilters } from "@/lib/explore/filters";
import { parseOpeningHours } from "@collectors/osm/opening-hours";

/** Lahore is UTC+5 all year (no DST). 2026-10-11 is a Sunday. */
const lahore = (date: string, time: string) => new Date(`${date}T${time}:00+05:00`);
const hours = (osm: string): HoursRow[] =>
  parseOpeningHours(osm)!.map((h) => ({ day_of_week: h.day_of_week, opens_at: h.opens, closes_at: h.closes, is_closed: h.is_closed }));

describe("openStatus (Asia/Karachi)", () => {
  const lateNight = hours("Mo-Su 09:00-01:00");

  test("open in today's window, with the closing time", () => {
    const s = openStatus(lateNight, lahore("2026-10-14", "10:00"));
    expect(s).toMatchObject({ state: "open", closesAt: "01:00", closesInMin: 15 * 60, closingSoon: false });
    expect(describeOpenStatus(s).label).toBe("Open · closes 1 am");
  });

  test("still open after midnight from the previous day, and closing soon", () => {
    const s = openStatus(lateNight, lahore("2026-10-15", "00:30"));
    expect(s).toMatchObject({ state: "open", closesAt: "01:00", closesInMin: 30, closingSoon: true });
    expect(describeOpenStatus(s)).toEqual({ label: "Closes soon · 1 am", tone: "warn" });
  });

  test("closed between closing and opening: opens later today", () => {
    const s = openStatus(lateNight, lahore("2026-10-15", "01:30"));
    expect(s).toMatchObject({ state: "closed", opensAt: "09:00", opensToday: true });
    expect(describeOpenStatus(s).label).toBe("Closed · opens 9 am");
  });

  test("a day off points at the next opening day", () => {
    const s = openStatus(hours("Tu-Su 11:00-23:00; Mo off"), lahore("2026-10-12", "12:00")); // Monday
    expect(s).toMatchObject({ state: "closed", opensAt: "11:00", opensDay: 2, opensToday: false });
    expect(describeOpenStatus(s).label).toBe("Closed · opens Tue 11 am");
  });

  test("the phone's own timezone doesn't matter", () => {
    // 05:00 UTC is 10:00 in Lahore, whatever the device thinks.
    expect(openStatus(lateNight, new Date("2026-10-14T05:00:00Z")).state).toBe("open");
    expect(openStatus(lateNight, new Date("2026-10-14T21:00:00Z")).state).toBe("closed"); // 02:00 Lahore
  });

  test("24/7 and unknown hours", () => {
    expect(openStatus(hours("24/7"), lahore("2026-10-14", "03:00"))).toMatchObject({ state: "open", allDay: true });
    expect(describeOpenStatus(openStatus(hours("24/7")))).toEqual({ label: "Open 24 hours", tone: "ok" });
    expect(openStatus([])).toEqual({ state: "unknown" });
    expect(openStatus(null)).toEqual({ state: "unknown" });
  });

  test("weekly table starts on Monday; unlisted days are closed", () => {
    const week = weeklyHours(hours("Mo-Fr 07:30-22:00"));
    expect(week.map((d) => d.name.slice(0, 3))).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    expect(week[0].text).toBe("7:30 am – 10 pm");
    expect(week[5].text).toBe("Closed");
    expect(weeklyHours(hours("Mo-Su 12:00-00:00"))[0].text).toBe("noon – midnight");
  });

  test("formatClock", () => {
    expect(formatClock("21:30")).toBe("9:30 pm");
    expect(formatClock("00:00")).toBe("midnight");
    expect(formatClock("12:00")).toBe("noon");
    expect(formatClock("00:15")).toBe("12:15 am");
  });
});

describe("travel estimate", () => {
  test("walks short hops, drives longer ones, with the stated assumptions", () => {
    expect(travelEstimate(500)).toEqual({ mode: "walk", minutes: 9 }); // 675 m of road at 4.5 km/h
    expect(travelEstimate(5000)).toEqual({ mode: "drive", minutes: 26 }); // 6.75 km at 18 km/h + 3 min
    expect(travelEstimate(10)).toEqual({ mode: "walk", minutes: 1 });
    expect(formatTravel({ mode: "drive", minutes: 75 })).toBe("1 h 15 min drive");
  });
});

describe("explore filters", () => {
  test("bad values are dropped instead of failing", () => {
    const f = parseFilters(new URLSearchParams("maxPrice=abc&maxKcal=300&roast=burnt&avoid=nuts,dairy,bogus&wifi=1&type=spaceship&q=%20kite%20"));
    expect(f).toEqual({ maxKcal: 300, avoid: ["dairy", "nuts"], wifi: true, q: "kite" });
  });

  test("round-trips through the URL in a stable order", () => {
    const f = parseFilters({ drink: "latte", deals: "1", maxKm: "3", sort: "price" });
    expect(filtersToParams(f).toString()).toBe("deals=1&drink=latte&maxKm=3&sort=price");
    expect(parseFilters(filtersToParams(f))).toEqual(f);
    expect(filtersToParams(f, ["drink", "deals"]).toString()).toBe("deals=1&drink=latte");
  });

  test("counts", () => {
    const f = parseFilters({ q: "x", sort: "price", drink: "latte", openNow: "1" });
    expect(activeFilterCount(f)).toBe(2);
    expect(hasDrinkFilters(f)).toBe(true);
    expect(hasDrinkFilters(parseFilters({ wifi: "1" }))).toBe(false);
  });
});
