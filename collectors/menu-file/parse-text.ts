// Menu text (from OCR or a PDF's text layer) -> menu items. Line based, because printed menus are:
//   HOT COFFEE                       <- section
//            Small   Large           <- size header for the lines below
//   Cappuccino ......  450    550
//   Espresso  Single 300  Double 450
//   Americano 12 oz  Rs. 400/-
// OCR misreads prices often, so everything here is a proposal for mandatory human review.

import type { ParsedMenuItem, ParsedPrice } from "../lib/menu";

export interface MenuText {
  items: ParsedMenuItem[];
  /** Lines with digits we couldn't read as an item, shown to the reviewer. */
  unread: string[];
  warnings: string[];
}

const SIZE_TOKEN = /^(small|medium|large|regular|reg|single|double|tall|grande|venti|short|sm|md|lg|s|m|l|\d{1,3}(?:oz|ml))$/i;
const CURRENCY = /^(rs\.?|pkr|₨)$/i;
const MIN_PRICE = 50;
const MAX_PRICE = 10000;

/** OCR confuses O/o with 0 and I/l with 1 inside numbers; only fix tokens that are mostly digits. */
function fixDigits(token: string): string {
  const core = token.replace(/\/-$/, "");
  if (!/\d/.test(core) || (core.match(/[oOIl]/g) ?? []).length > core.length / 2) return token;
  if (!/^[\doOIl,.]+$/.test(core)) return token;
  return token.replace(/[oO]/g, "0").replace(/[Il]/g, "1");
}

const clean = (t: string) => fixDigits(t.replace(/^[([]|[)\]:,]$/g, ""));

function priceOf(token: string): number | null {
  let t = clean(token).replace(/\/-$/, "").replace(/^(rs\.?|pkr|₨)/i, "");
  if (/^\d{1,3}(,\d{3})+$/.test(t)) t = t.replace(/,/g, "");
  if (/^\d+\.\d{1,2}$/.test(t)) t = t.split(".")[0];
  if (!/^\d{2,5}$/.test(t)) return null;
  const n = Number(t);
  return n >= MIN_PRICE && n <= MAX_PRICE ? n : null;
}

const titleSize = (s: string) => s.replace(/(\d)(oz|ml)/i, "$1 $2");

function splitLine(line: string): { name: string; prices: ParsedPrice[]; calories: number | null } | null {
  const tokens = line.split(" ").filter(Boolean);
  const prices: ParsedPrice[] = [];
  let calories: number | null = null;
  let i = tokens.length - 1;
  while (i >= 0) {
    const t = clean(tokens[i]);
    if (CURRENCY.test(t)) {
      i--;
      continue;
    }
    const kcal = t.match(/^(\d+)k?cal(ories)?$/i);
    if (kcal || (/^k?cal(ories)?$/i.test(t) && i > 0 && /^\d+$/.test(clean(tokens[i - 1])))) {
      calories = Number(kcal ? kcal[1] : clean(tokens[i - 1]));
      i -= kcal ? 1 : 2;
      continue;
    }
    const price = priceOf(t);
    if (price === null) break;
    i--;
    while (i >= 0 && CURRENCY.test(clean(tokens[i]))) i--;
    let label: string | null = null;
    const prev = i >= 0 ? clean(tokens[i]) : "";
    if (SIZE_TOKEN.test(prev)) {
      label = titleSize(prev);
      i--;
    } else if (/^(oz|ml)$/i.test(prev) && i >= 1 && /^\d{1,3}$/.test(clean(tokens[i - 1]))) {
      label = `${clean(tokens[i - 1])} ${prev.toLowerCase()}`;
      i -= 2;
    }
    prices.unshift({ label, price_pkr: price });
  }
  if (!prices.length) return null;
  const name = tokens
    .slice(0, i + 1)
    .join(" ")
    .replace(/[.·…_]{2,}/g, " ")
    .replace(/[\s:.\-–—|]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!/[a-z]{2,}/i.test(name)) return null;
  return { name, prices, calories };
}

export function parseMenuText(text: string): MenuText {
  const items: ParsedMenuItem[] = [];
  const unread: string[] = [];
  const warnings: string[] = [];
  let section: string | null = null;
  let columns: string[] | null = null;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/[.·…_]{3,}/g, " ").replace(/\s+/g, " ").trim();
    if (!line) continue;
    const tokens = line.split(" ").map(clean);

    if (tokens.length >= 2 && tokens.every((t) => SIZE_TOKEN.test(t))) {
      columns = tokens.map(titleSize);
      continue;
    }
    if (!/\d/.test(line)) {
      if (line.length <= 40 && /[a-z]{3,}/i.test(line)) section = line;
      continue;
    }

    const parsed = splitLine(line);
    if (!parsed) {
      unread.push(line);
      continue;
    }
    const { name, prices, calories } = parsed;
    if (prices.every((p) => p.label === null)) {
      if (columns && columns.length === prices.length) prices.forEach((p, k) => (p.label = columns![k]));
      else if (prices.length > 1) {
        warnings.push(`"${name}" has ${prices.length} prices but no size labels; check sizes against the image.`);
        prices.forEach((p, k) => (p.label = `Option ${k + 1}`));
      }
    }
    items.push({ name, section, prices, calories_kcal: prices.length === 1 ? calories : null });
  }
  if (unread.length) warnings.push(`${unread.length} line(s) with numbers couldn't be read as menu items.`);
  return { items, unread, warnings };
}
