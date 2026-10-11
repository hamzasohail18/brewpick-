// Effective price on the phone: the best applicable deal for one cup, given the cards/apps the user holds.
//
// The SQL function effective_price_detail() (supabase/migrations/..._views_functions.sql) is the
// reference. This is a line-for-line mirror so toggling a saved card updates prices instantly and works
// offline. tests/deals/parity.test.ts runs both over every sample drink × card set × time and requires
// identical results: change one, change the other.

export type DiscountKind = "percent" | "flat_pkr" | "bogo" | "fixed_price" | "free_item";
export type Channel = "dine_in" | "takeaway" | "delivery";

/** What the engine needs to know about a deal. Only published, public deals are ever sent. */
export interface DealRule {
  id: string;
  title: string;
  placeId: string | null; // null = brand-wide
  brandId: string | null;
  discount: DiscountKind;
  discountValue: number | null;
  maxDiscountPkr: number | null;
  minSpendPkr: number | null;
  validFrom: string; // YYYY-MM-DD (Lahore calendar day)
  validTo: string;
  daysOfWeek: number[] | null; // 0 = Sunday
  startTime: string | null; // "HH:MM" or "HH:MM:SS", Lahore time; end < start runs past midnight
  endTime: string | null;
  appliesToAllItems: boolean;
  itemIds: string[]; // menu_items.id when not all items
  paymentMethodIds: number[]; // empty = open to everyone
  conditions: string[];
}

export interface Cup {
  pricePkr: number;
  menuItemId: string;
  placeId: string;
  brandId: string | null;
  channel: Channel;
}

export interface Effective {
  basePricePkr: number;
  effectivePricePkr: number;
  discountPkr: number;
  deal: DealRule | null;
}

/** Discount one deal gives on one cup (mirror of deal_discount_pkr). */
export function dealDiscountPkr(d: Pick<DealRule, "discount" | "discountValue" | "maxDiscountPkr">, base: number): number {
  const v = d.discountValue ?? 0;
  let off: number;
  switch (d.discount) {
    case "percent":
      off = roundHalfUp(base * v, 100); // round(base * v / 100.0)
      break;
    case "flat_pkr":
      off = Math.round(v);
      break;
    case "fixed_price":
      off = Math.max(base - Math.round(v), 0);
      break;
    case "bogo":
      off = Math.floor(base / 2); // two for the price of one = 50% per cup (integer division in SQL)
      break;
    default:
      off = 0; // free_item: the free thing is a different item
  }
  return Math.max(0, Math.min(base, d.maxDiscountPkr ?? base, off));
}

/** Postgres round() on a positive numeric: half away from zero. Exact for 2-decimal deal values. */
function roundHalfUp(numerator: number, denominator: number): number {
  const n = Math.round(numerator * 100); // discount_value is numeric(8,2): work in hundredths
  const d = denominator * 100;
  return Math.floor((2 * n + d) / (2 * d));
}

export interface LahoreNow {
  date: string; // YYYY-MM-DD
  dow: number;
  seconds: number; // since local midnight
}

export function lahoreNow(at: Date = new Date()): LahoreNow {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Karachi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    dow: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday")),
    seconds: Number(get("hour")) * 3600 + Number(get("minute")) * 60 + Number(get("second")),
  };
}

const toSeconds = (t: string) => {
  const [h, m, s] = t.split(":").map(Number);
  return h * 3600 + m * 60 + (s || 0);
};

/** Is the deal's date, weekday and time window open at `now`? (Independent of the cup.) */
export function inWindow(d: DealRule, now: LahoreNow): boolean {
  if (now.date < d.validFrom || now.date > d.validTo) return false;
  if (d.daysOfWeek && !d.daysOfWeek.includes(now.dow)) return false;
  if (d.startTime && d.endTime) {
    const s = toSeconds(d.startTime);
    const e = toSeconds(d.endTime);
    const t = now.seconds;
    if (s <= e ? !(t >= s && t < e) : !(t >= s || t < e)) return false;
  }
  return true;
}

const CHANNEL_ONLY: Record<string, Channel> = { dine_in_only: "dine_in", takeaway_only: "takeaway", delivery_only: "delivery" };

/** Why a deal does or doesn't apply to this cup for this user right now. */
export function dealApplies(d: DealRule, cup: Cup, cards: readonly number[], now: LahoreNow): boolean {
  if (!(d.placeId === cup.placeId || (d.placeId === null && d.brandId !== null && d.brandId === cup.brandId))) return false;
  if (!inWindow(d, now)) return false;
  if (d.minSpendPkr !== null && cup.pricePkr < d.minSpendPkr) return false;
  if (!d.appliesToAllItems && !d.itemIds.includes(cup.menuItemId)) return false;
  if (d.paymentMethodIds.length && !d.paymentMethodIds.some((id) => cards.includes(id))) return false;
  if (d.conditions.some((c) => CHANNEL_ONLY[c] && CHANNEL_ONLY[c] !== cup.channel)) return false;
  return true;
}

/** Best deal for one cup (mirror of effective_price_detail). Ties go to the lowest deal id, as in SQL. */
export function effectivePrice(cup: Cup, deals: readonly DealRule[], cards: readonly number[], at: Date | LahoreNow = new Date()): Effective {
  const now = at instanceof Date ? lahoreNow(at) : at;
  let best: { deal: DealRule; off: number } | null = null;
  for (const d of deals) {
    if (!dealApplies(d, cup, cards, now)) continue;
    const off = dealDiscountPkr(d, cup.pricePkr);
    if (off <= 0) continue;
    if (!best || off > best.off || (off === best.off && d.id < best.deal.id)) best = { deal: d, off };
  }
  return {
    basePricePkr: cup.pricePkr,
    effectivePricePkr: cup.pricePkr - (best?.off ?? 0),
    discountPkr: best?.off ?? 0,
    deal: best?.deal ?? null,
  };
}

/** For the Deals screen: can this user use it, and is it on right now? */
export function dealStatus(d: DealRule, cards: readonly number[], now: LahoreNow) {
  return {
    usable: d.paymentMethodIds.length === 0 || d.paymentMethodIds.some((id) => cards.includes(id)),
    onNow: inWindow(d, now),
    today: now.date >= d.validFrom && now.date <= d.validTo && (!d.daysOfWeek || d.daysOfWeek.includes(now.dow)),
  };
}
