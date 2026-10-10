// Normalizer (Section 7.3 step 2): turns the messy strings collectors and CSVs produce into the
// units the database stores. Pure functions; no I/O.

/** Size defaults, used only when the source doesn't state a volume (then volume_is_assumed = true). */
export const DEFAULT_VOLUMES_ML = { small: 240, medium: 350, large: 470 } as const;
const ML_PER_FL_OZ = 29.5735;

/** Lowercase, strip accents and punctuation, collapse spaces: "Caffè  Latte!" -> "caffe latte". */
export function normName(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Parse a PKR price into an integer. Accepts "Rs. 1,250/-", "PKR 650", "650.00", "Rs 1250.5".
 * Returns null for anything that isn't clearly one price (ranges, other currencies, empty).
 */
export function parsePkr(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "number") return Number.isFinite(input) && input > 0 ? Math.round(input) : null;
  let s = input.trim().toLowerCase();
  if (!s) return null;
  if (/[$€£]|usd|aed|inr/.test(s)) return null;
  s = s.replace(/\/-$/, "").replace(/^(rs\.?|pkr|₨)\s*/, "").replace(/\s*(rs\.?|pkr)$/, "");
  if (/\d\s*[-–~]\s*\d/.test(s) || /\bto\b/.test(s)) return null; // a range, not a price
  if (!/^\d{1,3}(,\d{3})*(\.\d+)?$|^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

export interface NormalizedSize {
  size_label: string;
  volume_ml: number | null;
  volume_is_assumed: boolean;
}

const SIZE_WORDS: [RegExp, "small" | "medium" | "large", string][] = [
  [/^(s|sm|small|short|tall|single)$/, "small", "Small"],
  [/^(m|md|med|medium|regular|reg|grande)$/, "medium", "Regular"],
  [/^(l|lg|large|venti|double|big)$/, "large", "Large"],
];

/**
 * "12 oz" -> 355 ml (stated). "350ml" -> 350 (stated). "L" -> Large, 470 ml (assumed).
 * An explicit volume always wins over a size word; assumptions are flagged.
 */
export function parseSize(label: string | null | undefined, statedVolume?: string | number | null): NormalizedSize {
  const raw = (label ?? "").trim();
  const volume = parseVolume(statedVolume) ?? parseVolume(raw);
  const word = normName(raw.replace(/\d+(\.\d+)?\s*(ml|oz|fl oz)\b/gi, ""));
  const match = SIZE_WORDS.find(([re]) => re.test(word));
  const size_label = match ? match[2] : raw ? titleCase(raw) : "Regular";
  if (volume) return { size_label, volume_ml: volume, volume_is_assumed: false };
  const bucket = match?.[1] ?? (raw ? null : "medium");
  return bucket
    ? { size_label, volume_ml: DEFAULT_VOLUMES_ML[bucket], volume_is_assumed: true }
    : { size_label, volume_ml: null, volume_is_assumed: false };
}

function parseVolume(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return v > 0 ? Math.round(v) : null;
  const m = v.toLowerCase().match(/(\d+(?:\.\d+)?)\s*(ml|oz|fl\.?\s*oz)\b/);
  if (!m) return null;
  const n = Number(m[1]);
  return Math.round(m[2] === "ml" ? n : n * ML_PER_FL_OZ);
}

const titleCase = (s: string) => s.replace(/\s+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export interface DrinkTypeAliases {
  slug: string;
  aliases: string[];
}

/**
 * Map a menu name to a canonical drink type. Exact alias first; otherwise the longest alias that
 * appears as whole words in the name ("Hazelnut Iced Latte" -> iced-latte). null when nothing fits.
 */
export function matchDrinkType(name: string, types: DrinkTypeAliases[]): { slug: string; exact: boolean } | null {
  const n = normName(name);
  if (!n) return null;
  let best: { slug: string; len: number } | null = null;
  for (const t of types) {
    for (const a of [t.slug.replace(/-/g, " "), ...t.aliases].map(normName)) {
      if (!a) continue;
      if (a === n) return { slug: t.slug, exact: true };
      if (` ${n} `.includes(` ${a} `) && (!best || a.length > best.len)) best = { slug: t.slug, len: a.length };
    }
  }
  return best ? { slug: best.slug, exact: false } : null;
}

/** "9:30 pm" / "21:30" / "noon" / "12am" -> "21:30" style 24h string; null if unparseable. */
export function parseTime(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = input.trim().toLowerCase().replace(/\./g, "");
  if (s === "noon") return "12:00";
  if (s === "midnight") return "00:00";
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? "0");
  if (min > 59 || h > 24) return null;
  if (m[3]) {
    if (h < 1 || h > 12) return null;
    if (m[3] === "am") h = h === 12 ? 0 : h;
    else h = h === 12 ? 12 : h + 12;
  } else if (!m[2] && h <= 12) {
    return null; // "9" alone is ambiguous
  }
  if (h === 24) h = 0;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** "12pm - 2am" -> { opens: "12:00", closes: "02:00" } (closing past midnight is allowed). */
export function parseTimeRange(input: string | null | undefined): { opens: string; closes: string } | null {
  if (!input) return null;
  const parts = input.split(/\s*(?:-|–|—|to)\s*/i);
  if (parts.length !== 2) return null;
  const opens = parseTime(parts[0]);
  const closes = parseTime(parts[1]);
  return opens && closes ? { opens, closes } : null;
}

/** Today's date in Asia/Karachi as YYYY-MM-DD. */
export function karachiDate(at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(at);
}
