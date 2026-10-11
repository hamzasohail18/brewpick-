// "Open now" and closing time, always in Lahore time (Asia/Karachi), whatever the phone's timezone.
// Pure functions so the server, the browser and tests agree.

export interface HoursRow {
  day_of_week: number; // 0 = Sunday
  opens_at: string | null; // "HH:MM" or "HH:MM:SS"
  closes_at: string | null; // may be earlier than opens_at: closes after midnight
  is_closed: boolean;
}

export type OpenStatus =
  | { state: "unknown" }
  | { state: "open"; allDay: boolean; closesAt: string | null; closesInMin: number | null; closingSoon: boolean }
  | { state: "closed"; opensAt: string | null; opensDay: number | null; opensToday: boolean };

const TZ = "Asia/Karachi";
const CLOSING_SOON_MIN = 60;
const DAY_MIN = 24 * 60;

const toMin = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

/** Weekday (0 = Sunday) and minutes since midnight in Lahore. */
// Built once: constructing a time-zone formatter is slow, and lists call this for every place.
const clockFmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export function lahoreClock(at: Date): { dow: number; min: number } {
  const parts = clockFmt.formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { dow, min: Number(get("hour")) * 60 + Number(get("minute")) };
}

/** A day's opening as [start, end) minutes from that day's midnight; end may run past 1440. */
function span(row: HoursRow | undefined): [number, number] | null {
  if (!row || row.is_closed || !row.opens_at || !row.closes_at) return null;
  const o = toMin(row.opens_at);
  let c = toMin(row.closes_at);
  if (c === 23 * 60 + 59) c = DAY_MIN; // "24/7" and "-24:00" are stored as 23:59
  if (c <= o) c += DAY_MIN; // past midnight ("12:00-02:00"); equal times mean round the clock
  return [o, c];
}

export function openStatus(hours: HoursRow[] | null | undefined, at: Date = new Date()): OpenStatus {
  if (!hours || hours.length === 0) return { state: "unknown" };
  const byDay = new Map(hours.map((h) => [h.day_of_week, h]));
  const { dow, min } = lahoreClock(at);

  // Still open from yesterday's late night, or open in today's window.
  const yesterday = span(byDay.get((dow + 6) % 7));
  const today = span(byDay.get(dow));
  let closeAbs: number | null = null; // minutes from today's midnight
  if (yesterday && min < yesterday[1] - DAY_MIN) closeAbs = yesterday[1] - DAY_MIN;
  else if (today && min >= today[0] && min < today[1]) closeAbs = today[1];

  if (closeAbs !== null) {
    // Round the clock: today's window runs straight into tomorrow's (e.g. 00:00-24:00 every day).
    const tomorrow = span(byDay.get((dow + 1) % 7));
    const allDay = closeAbs >= DAY_MIN && tomorrow !== null && tomorrow[0] === 0 && tomorrow[1] >= DAY_MIN;
    if (allDay) return { state: "open", allDay: true, closesAt: null, closesInMin: null, closingSoon: false };
    const closesInMin = closeAbs - min;
    return {
      state: "open",
      allDay: false,
      closesAt: fromMin(closeAbs % DAY_MIN),
      closesInMin,
      closingSoon: closesInMin <= CLOSING_SOON_MIN,
    };
  }

  // Closed: find the next opening within a week.
  if (today && min < today[0]) return { state: "closed", opensAt: fromMin(today[0]), opensDay: dow, opensToday: true };
  for (let i = 1; i <= 7; i++) {
    const d = (dow + i) % 7;
    const s = span(byDay.get(d));
    if (s) return { state: "closed", opensAt: fromMin(s[0]), opensDay: d, opensToday: false };
  }
  return { state: "closed", opensAt: null, opensDay: null, opensToday: false };
}

const fromMin = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** "21:30" -> "9:30 pm", "13:00" -> "1 pm", "00:00" -> "midnight", "12:00" -> "noon". */
export function formatClock(t: string): string {
  const [h, m] = t.split(":").map(Number);
  if (h === 0 && m === 0) return "midnight";
  if (h === 12 && m === 0) return "noon";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "am" : "pm"}`;
}

export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** One line for cards: "Open · closes 1 am", "Closes soon · 11:30 pm", "Closed · opens Tue 11 am". */
export function describeOpenStatus(s: OpenStatus): { label: string; tone: "ok" | "warn" | "bad" | "neutral" } {
  if (s.state === "unknown") return { label: "Hours not known", tone: "neutral" };
  if (s.state === "open") {
    if (s.allDay) return { label: "Open 24 hours", tone: "ok" };
    if (s.closingSoon) return { label: `Closes soon · ${formatClock(s.closesAt!)}`, tone: "warn" };
    return { label: `Open · closes ${formatClock(s.closesAt!)}`, tone: "ok" };
  }
  if (!s.opensAt) return { label: "Closed", tone: "bad" };
  const when = s.opensToday ? formatClock(s.opensAt) : `${DAY_SHORT[s.opensDay!]} ${formatClock(s.opensAt)}`;
  return { label: `Closed · opens ${when}`, tone: "bad" };
}

/** Weekly table rows, Monday first (how Lahore menus and boards list hours). */
export function weeklyHours(hours: HoursRow[]): { day: number; name: string; text: string }[] {
  const byDay = new Map(hours.map((h) => [h.day_of_week, h]));
  return [1, 2, 3, 4, 5, 6, 0].map((d) => {
    const s = span(byDay.get(d)); // a day the source doesn't list counts as closed (OSM semantics)
    let text = "Closed";
    if (s) text = s[0] === 0 && s[1] >= DAY_MIN ? "Open 24 hours" : `${formatClock(fromMin(s[0]))} – ${formatClock(fromMin(s[1] % DAY_MIN))}`;
    return { day: d, name: DAY_NAMES[d], text };
  });
}
