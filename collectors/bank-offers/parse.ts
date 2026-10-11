// Bank offer page parser. Banks list hundreds of merchants; we keep only offers that name a cafe or
// brand already in the directory, and only facts stated on the page. An offer without a stated end
// date or discount is reported for manual entry, never filled in with a guess.

import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import { normName, parsePkr } from "@/lib/pipeline/normalize";

export interface Merchant {
  kind: "brand" | "place";
  id: string;
  name: string;
}

export interface ParsedOffer {
  merchant: Merchant;
  text: string;
  percent: number | null;
  flatPkr: number | null;
  capPkr: number | null;
  minSpendPkr: number | null;
  validFrom: string | null;
  validTo: string | null;
  days: number[] | null;
  /** Why it can't be staged automatically (missing end date / discount); null when complete. */
  missing: string | null;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH = String.raw`(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)`;
const DATE = String.raw`(?:\d{1,2}(?:st|nd|rd|th)?\s+${MONTH},?\s+\d{4}|${MONTH}\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}|\d{1,2}[/-]\d{1,2}[/-]\d{4}|\d{4}-\d{2}-\d{2})`;

const iso = (y: number, m: number, d: number) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
};

/** "31st Dec, 2026" / "December 31 2026" / "31/12/2026" (Pakistan writes day first) / "2026-12-31". */
export function parseDate(s: string): string | null {
  const t = s.toLowerCase().replace(/(\d)(st|nd|rd|th)/, "$1").replace(",", " ").replace(/\s+/g, " ").trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) return iso(+m[3], +m[2], +m[1]);
  m = t.match(/^(\d{1,2}) ([a-z]+) (\d{4})$/);
  if (m) return iso(+m[3], MONTHS.indexOf(m[2].slice(0, 3)) + 1, +m[1]);
  m = t.match(/^([a-z]+) (\d{1,2}) (\d{4})$/);
  if (m) return iso(+m[3], MONTHS.indexOf(m[1].slice(0, 3)) + 1, +m[2]);
  return null;
}

const DAY_WORDS: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const DAY = String.raw`(?:sun(?:day)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?)`;

export function parseDays(text: string): number[] | null {
  const t = text.toLowerCase();
  if (/\bweekdays?\b/.test(t)) return [1, 2, 3, 4, 5];
  if (/\bweekends?\b/.test(t)) return [0, 6];
  const range = t.match(new RegExp(String.raw`\b(${DAY})\s*(?:-|–|to|till)\s*(${DAY})\b`));
  if (range) {
    const from = DAY_WORDS[range[1].slice(0, 3)];
    const to = DAY_WORDS[range[2].slice(0, 3)];
    const out: number[] = [];
    for (let d = from; ; d = (d + 1) % 7) {
      out.push(d);
      if (d === to) break;
    }
    return out;
  }
  // Single days only after "every" / "on" ("every Monday", "on Tue & Wed"): bare "sun" or "sat" is too often a word.
  const lists = [...t.matchAll(new RegExp(String.raw`\b(?:every|on|each)\s+((?:${DAY})s?\b(?:\s*(?:,|&|and)\s*(?:${DAY})s?\b)*)`, "g"))];
  const listed = lists.flatMap((m) => [...m[1].matchAll(new RegExp(String.raw`\b(${DAY})s?\b`, "g"))].map((d) => DAY_WORDS[d[1].slice(0, 3)]));
  return listed.length ? [...new Set(listed)].sort((a, b) => a - b) : null;
}

const money = (re: RegExp, t: string) => {
  const m = t.match(re);
  return m ? parsePkr(m[1]) : null;
};

export function parseOfferText(text: string, merchant: Merchant, today: string): ParsedOffer {
  const t = text.replace(/\s+/g, " ");
  const percentM = t.match(/(\d{1,2})\s*%/);
  const percent = percentM ? Number(percentM[1]) : null;
  const flatPkr = percent === null ? money(/flat\s*(?:rs\.?|pkr)\s*([\d,]+)\s*off/i, t) : null;
  const capPkr = money(/(?:up\s*to|upto|max(?:imum)?(?:\s+discount)?(?:\s+of)?|capped\s+at)\s*(?:rs\.?|pkr)\s*([\d,]+)/i, t);
  const minSpendPkr = money(/min(?:imum)?\.?\s*(?:spend|bill|purchase|transaction|order)(?:\s+(?:of|value))?\s*(?:rs\.?|pkr)\s*([\d,]+)/i, t);

  let validFrom: string | null = null;
  let validTo: string | null = null;
  const between = t.match(new RegExp(String.raw`(${DATE})\s*(?:to|till|until|-|–|and)\s*(${DATE})`, "i"));
  if (between) {
    validFrom = parseDate(between[1]);
    validTo = parseDate(between[2]);
  } else {
    const until = t.match(new RegExp(String.raw`(?:valid|offer|ends?|expires?|till|until|upto|up to)\D{0,20}?(${DATE})`, "i"));
    if (until) validTo = parseDate(until[1]);
  }

  const missing =
    percent === null && flatPkr === null
      ? "no discount amount stated"
      : !validTo
        ? "no end date stated"
        : validTo < today
          ? `already ended (${validTo})`
          : null;
  return { merchant, text: t.trim(), percent, flatPkr, capPkr, minSpendPkr, validFrom, validTo, days: parseDays(t), missing };
}

/** Longest merchant name that appears as whole words; names under 4 letters are too ambiguous to match. */
function findMerchant(text: string, merchants: Merchant[]): Merchant | null {
  const n = ` ${normName(text)} `;
  let best: Merchant | null = null;
  for (const m of merchants) {
    const name = normName(m.name);
    if (name.replace(/ /g, "").length < 4) continue;
    if (n.includes(` ${name} `) && (!best || name.length > normName(best.name).length)) best = m;
  }
  return best;
}

const DISCOUNTISH = /\d{1,2}\s*%|\bflat\s*(?:rs|pkr)|\bdiscount\b|\boff\b/i;

export function parseBankOffers(html: string, merchants: Merchant[], today: string): { offers: ParsedOffer[]; blocks: number } {
  const $ = cheerio.load(html);
  $("script,style,noscript,nav,header,footer,svg").remove();
  const qualifies = (e: Element) => {
    const t = $(e).text().replace(/\s+/g, " ");
    return t.length >= 10 && t.length <= 800 && DISCOUNTISH.test(t) && findMerchant(t, merchants) !== null;
  };
  const candidates = $("body *")
    .toArray()
    .filter((e): e is Element => e.type === "tag" && qualifies(e));
  // Innermost blocks only: a list that holds several offers isn't itself an offer.
  const blocks = candidates.filter((e) => !candidates.some((o) => o !== e && $(e).find(o).length));
  const seen = new Set<string>();
  const offers: ParsedOffer[] = [];
  for (const b of blocks) {
    const text = $(b).text().replace(/\s+/g, " ").trim();
    if (seen.has(text)) continue;
    seen.add(text);
    offers.push(parseOfferText(text, findMerchant(text, merchants)!, today));
  }
  return { offers, blocks: blocks.length };
}
