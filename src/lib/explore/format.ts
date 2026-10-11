// Display helpers for public screens (prices, freshness, deal terms). Lahore time throughout.

import { karachiDate } from "@/lib/pipeline/normalize";
import { DAY_SHORT, formatClock } from "./hours";

const pkr = new Intl.NumberFormat("en-PK", { maximumFractionDigits: 0 });
export const formatPkr = (n: number) => `Rs ${pkr.format(n)}`;

const DAY_MS = 86_400_000;
const shortDate = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Karachi", day: "numeric", month: "short" });
const longDate = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Karachi", day: "numeric", month: "short", year: "numeric" });

/** Whole calendar days between two instants, counted in Lahore dates. */
export function lahoreDaysBetween(from: Date | string, to: Date = new Date()): number {
  const a = Date.parse(karachiDate(new Date(from)));
  const b = Date.parse(karachiDate(to));
  return Math.round((b - a) / DAY_MS);
}

/** "checked today" / "checked yesterday" / "checked 5 days ago" / "checked 2 Sep" (older than 30 days). */
export function checkedAgo(at: string | Date | null | undefined, now: Date = new Date()): string {
  if (!at) return "date unknown";
  const days = lahoreDaysBetween(at, now);
  if (days <= 0) return "checked today";
  if (days === 1) return "checked yesterday";
  if (days <= 30) return `checked ${days} days ago`;
  return `checked ${formatShortDate(at)}`;
}

export const isStale = (at: string | Date | null | undefined, now: Date = new Date()) => !at || lahoreDaysBetween(at, now) > 30;

export const formatShortDate = (d: string | Date) => shortDate.format(new Date(d));
export const formatLongDate = (d: string | Date) => longDate.format(new Date(d));

/** A YYYY-MM-DD deal date (a Lahore calendar day) for display. */
export const formatDealDate = (ymd: string) => longDate.format(new Date(`${ymd}T12:00:00+05:00`));

/**
 * A deal runs until the end of its valid_to day in Lahore. Returns hours left when that's within
 * 48 hours (Section 3C badge), otherwise null.
 */
export function dealEndsSoon(validTo: string, now: Date = new Date()): number | null {
  const end = new Date(`${validTo}T00:00:00+05:00`).getTime() + DAY_MS;
  const hours = (end - now.getTime()) / 3_600_000;
  return hours > 0 && hours <= 48 ? Math.ceil(hours) : null;
}

/** Badge text for a deal ending within 48 hours: it ends at midnight after its last day. */
export function endsInLabel(validTo: string, now: Date = new Date()): string {
  const hours = dealEndsSoon(validTo, now);
  if (hours !== null && hours <= 6) return `Ends in ${hours} h`;
  return validTo === karachiDate(now) ? "Ends tonight" : "Ends tomorrow";
}

const CONDITION_LABELS: Record<string, string> = {
  dine_in_only: "Dine-in only",
  takeaway_only: "Takeaway only",
  delivery_only: "Delivery only",
  new_customers_only: "New customers only",
  student_id_required: "Student ID required",
};
export const conditionLabel = (key: string) => CONDITION_LABELS[key] ?? key.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export const DEAL_TYPE_LABELS: Record<string, string> = {
  bank_card: "Bank card",
  delivery_app: "Delivery app",
  loyalty: "Loyalty",
  happy_hour: "Happy hour",
  combo: "Combo",
  student: "Student",
  other: "Offer",
};

/** "Mon–Thu", "Fri", "Every day" from a 0=Sunday day list. */
export function formatDays(days: number[] | null): string {
  if (!days || days.length === 0 || days.length === 7) return "Every day";
  const order = [1, 2, 3, 4, 5, 6, 0];
  const sorted = order.filter((d) => days.includes(d));
  const runs: number[][] = [];
  for (const d of sorted) {
    const last = runs.at(-1);
    if (last && order.indexOf(d) === order.indexOf(last.at(-1)!) + 1) last.push(d);
    else runs.push([d]);
  }
  return runs.map((r) => (r.length >= 3 ? `${DAY_SHORT[r[0]]}–${DAY_SHORT[r.at(-1)!]}` : r.map((d) => DAY_SHORT[d]).join(", "))).join(", ");
}

/** "Mon–Thu", "Every day, 10 pm – 3 am", "Weekdays 3 pm – 6 pm". */
export function dealSchedule(d: { daysOfWeek: number[] | null; startTime: string | null; endTime: string | null }): string {
  const days = formatDays(d.daysOfWeek);
  return d.startTime && d.endTime ? `${days}, ${formatClock(d.startTime)} – ${formatClock(d.endTime)}` : days;
}

/** "20% off (max Rs 300)", "Rs 150 off", "Buy one get one", ... */
export function discountLabel(d: { discount: string; discountValue: number | null; maxDiscountPkr: number | null; minSpendPkr: number | null }): string {
  const v = d.discountValue ?? 0;
  let s =
    d.discount === "percent" ? `${v}% off`
    : d.discount === "flat_pkr" ? `${formatPkr(v)} off`
    : d.discount === "fixed_price" ? `For ${formatPkr(v)}`
    : d.discount === "bogo" ? "Buy one get one"
    : "Free item";
  if (d.maxDiscountPkr) s += ` (max ${formatPkr(d.maxDiscountPkr)})`;
  if (d.minSpendPkr) s += ` · min spend ${formatPkr(d.minSpendPkr)}`;
  return s;
}

export const CHANNEL_LABELS = { dine_in: "Dine-in", takeaway: "Takeaway", delivery: "Delivery" } as const;
