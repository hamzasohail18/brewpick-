// Generic cafe menu page parser (Section 7.2: prefer JSON-LD / structured data, then HTML).
// Pure: HTML string in, parsed items out. Everything it finds still goes through validation and review.

import * as cheerio from "cheerio";
import type { AnyNode, Element } from "domhandler";
import { parsePkr } from "@/lib/pipeline/normalize";
import type { HoursEntry } from "@/lib/pipeline/records";
import { parseOpeningHours } from "../osm/opening-hours";
import { dedupeItems, type ParsedMenuItem, type ParsedPrice } from "../lib/menu";

export interface WebsiteMenu {
  method: "json-ld" | "html" | "none";
  items: ParsedMenuItem[];
  /** From schema.org openingHours / openingHoursSpecification; null when the page doesn't say. */
  hours: HoursEntry[] | null;
  warnings: string[];
}

type Json = Record<string, unknown>;

// ---------- JSON-LD ----------

const typesOf = (n: Json): string[] => {
  const t = n["@type"];
  return (Array.isArray(t) ? t : [t]).filter((x): x is string => typeof x === "string").map((x) => x.replace(/^https?:\/\/schema\.org\//, ""));
};
const asArray = <T>(v: T | T[] | undefined | null): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

function jsonLdBlocks($: cheerio.CheerioAPI, warnings: string[]): Json[] {
  const out: Json[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).text();
    try {
      for (const node of asArray(JSON.parse(raw) as Json | Json[])) {
        if (node && typeof node === "object") out.push(...(Array.isArray(node["@graph"]) ? (node["@graph"] as Json[]) : [node]));
      }
    } catch {
      warnings.push("A JSON-LD block on the page isn't valid JSON; skipped it.");
    }
  });
  return out;
}

const SIZE_OF_OFFER = (o: Json): string | null =>
  text(o.name) ?? text(o.description) ?? text((o.eligibleQuantity as Json | undefined)?.name) ?? text((o.itemOffered as Json | undefined)?.name);

function caloriesOf(item: Json): number | null {
  const n = item.nutrition as Json | undefined;
  const c = n?.calories;
  const m = typeof c === "number" ? [String(c), String(c)] : typeof c === "string" ? c.match(/(\d+(?:\.\d+)?)/) : null;
  return m ? Math.round(Number(m[1])) : null;
}

function menuItemFromJson(item: Json, section: string | null, warnings: string[]): ParsedMenuItem | null {
  const name = text(item.name);
  if (!name) return null;
  const offers = asArray(item.offers as Json | Json[]).flatMap((o) => (typesOf(o).includes("AggregateOffer") ? asArray(o.offers as Json[]) : [o]));
  const prices: ParsedPrice[] = [];
  for (const o of offers) {
    const currency = text(o.priceCurrency);
    if (currency && currency.toUpperCase() !== "PKR") {
      warnings.push(`"${name}" is priced in ${currency}, not PKR; skipped.`);
      continue;
    }
    const price = parsePkr(typeof o.price === "number" ? o.price : text(o.price));
    if (price === null) continue;
    prices.push({ label: offers.length > 1 ? SIZE_OF_OFFER(o) : (SIZE_OF_OFFER(o) ?? null), price_pkr: price });
  }
  if (!prices.length) return null;
  return { name, section, prices, calories_kcal: caloriesOf(item) };
}

function collectJsonLdItems(nodes: Json[], warnings: string[]): ParsedMenuItem[] {
  const items: ParsedMenuItem[] = [];
  const visit = (n: unknown, section: string | null) => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach((x) => visit(x, section));
    const node = n as Json;
    const types = typesOf(node);
    if (types.includes("MenuItem") || (types.includes("Product") && node.offers)) {
      const it = menuItemFromJson(node, section, warnings);
      if (it) items.push(it);
      return;
    }
    const nextSection = types.includes("MenuSection") ? (text(node.name) ?? section) : section;
    for (const key of ["hasMenu", "hasMenuSection", "hasMenuItem", "itemListElement", "item", "mainEntity"]) visit(node[key], nextSection);
  };
  nodes.forEach((n) => visit(n, null));
  return items;
}

const DAY_NAMES: Record<string, number> = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };

function hoursFromJsonLd(nodes: Json[], warnings: string[]): HoursEntry[] | null {
  for (const n of nodes) {
    const oh = n.openingHours;
    if (oh) {
      const parsed = parseOpeningHours(asArray(oh as string | string[]).join("; "));
      if (parsed) return parsed;
      warnings.push(`Couldn't read openingHours "${asArray(oh).join("; ")}"; hours left out.`);
    }
    const spec = asArray(n.openingHoursSpecification as Json | Json[]);
    if (spec.length) {
      const byDay = new Map<number, HoursEntry>();
      for (const s of spec) {
        const opens = text(s.opens)?.slice(0, 5) ?? null;
        const closes = text(s.closes)?.slice(0, 5) ?? null;
        for (const d of asArray(s.dayOfWeek as string | string[])) {
          const day = DAY_NAMES[String(d).replace(/^https?:\/\/schema\.org\//, "").toLowerCase()];
          if (day === undefined || !opens || !closes) continue;
          const closed = opens === "00:00" && closes === "00:00";
          byDay.set(day, { day_of_week: day, opens: closed ? null : opens, closes: closed ? null : closes === "24:00" ? "23:59" : closes, is_closed: closed });
        }
      }
      if (byDay.size) {
        if (byDay.size < 7) warnings.push("The page's opening hours skip some days; those are treated as closed.");
        return [0, 1, 2, 3, 4, 5, 6].map((d) => byDay.get(d) ?? { day_of_week: d, opens: null, closes: null, is_closed: true });
      }
    }
  }
  return null;
}

// ---------- HTML fallback ----------

const PRICE_RE = /(?:rs\.?|pkr|₨)\s*\d[\d,]*(?:\.\d+)?(?:\s*\/-)?|\d[\d,]*(?:\.\d+)?\s*(?:\/-|pkr\b|rs\.?(?![a-z]))/gi;
const SIZE_WORD = /^(?:small|medium|large|regular|reg|single|double|tall|grande|venti|short|[sml]|\d+\s*(?:ml|oz|fl\s*oz))$/i;
const SIZE_IN_TEXT = /\b(small|medium|large|regular|single|double|tall|grande|venti|short|[sml]|\d+\s*(?:ml|oz))\b\s*:?\s*$/i;
const MAX_ITEM_TEXT = 300;

const squash = (s: string) => s.replace(/\s+/g, " ").trim();
/** Text with prices and size words removed: what's left is the name (and maybe a description). */
const wordsOnly = (s: string) => squash(s.replace(PRICE_RE, " ").replace(/\b(small|medium|large|regular|single|double|[sml])\b\s*:?/gi, " ").replace(/[|•·–—:-]+/g, " "));

function priceTokens(s: string): number[] {
  return [...s.matchAll(PRICE_RE)].map((m) => parsePkr(m[0].replace(/\s*\/-$/, ""))).filter((n): n is number => n !== null);
}

/** The one price an element shows: "Rs 550", "550/-", or a bare "550" marked up as a price. */
function priceOfEl($: cheerio.CheerioAPI, e: Element): number | null {
  const t = squash($(e).text());
  if (t.length > 40) return null;
  const tokens = priceTokens(t);
  if (tokens.length === 1) return tokens[0];
  const marked = /price/i.test(`${$(e).attr("class") ?? ""} ${$(e).attr("itemprop") ?? ""}`);
  return tokens.length === 0 && marked && /^\d[\d,]*(\.\d+)?$/.test(t) ? parsePkr(t) : null;
}

function nameIn($: cheerio.CheerioAPI, container: Element): string | null {
  const named = $(container)
    .find("h1,h2,h3,h4,h5,h6,strong,b,dt,[class*=name],[class*=title],[itemprop=name]")
    .toArray()
    .map((e) => squash($(e).text()))
    .find((t) => t && !priceTokens(t).length && !SIZE_WORD.test(t));
  if (named) return named;
  if (container.tagName === "tr") {
    const first = squash($(container).children("td,th").first().text());
    if (first && !priceTokens(first).length) return first;
  }
  const rest = wordsOnly($(container).text());
  return rest || null;
}

function tableHeaders($: cheerio.CheerioAPI, row: Element): string[] | null {
  const table = $(row).closest("table");
  const head = table.find("thead tr").first().length ? table.find("thead tr").first() : table.find("tr").first();
  if (!head.length || head[0] === row) return null;
  return head.children("th,td").toArray().map((c) => squash($(c).text()));
}

function labelFor($: cheerio.CheerioAPI, priceEl: Element, container: Element): string | null {
  // Table: the column header above the price cell.
  if (container.tagName === "tr") {
    const cell = $(priceEl).closest("td,th")[0];
    const idx = cell ? $(container).children("td,th").toArray().indexOf(cell as Element) : -1;
    const header = idx >= 0 ? tableHeaders($, container)?.[idx] : null;
    if (header && SIZE_WORD.test(header)) return header;
  }
  // "Small Rs 500" / "S: 500/-": a size word right before the price in the same element or its parent.
  for (const el of [priceEl, priceEl.parent as Element | null]) {
    if (!el || el === container) break;
    const t = squash($(el).text());
    const before = t.split(PRICE_RE)[0] ?? "";
    const m = before.match(SIZE_IN_TEXT);
    if (m) return m[1];
  }
  return null;
}

function parseHtmlMenu($: cheerio.CheerioAPI, warnings: string[]): ParsedMenuItem[] {
  $("script,style,noscript,nav,header,footer,form,svg").remove();
  const containers = new Map<Element, { prices: ParsedPrice[] }>();
  let unplaced = 0;

  // Smallest elements that hold exactly one price.
  const priceEls = $("body *")
    .toArray()
    .filter((e): e is Element => e.type === "tag")
    .filter((e) => priceOfEl($, e) !== null && !$(e).children().toArray().some((c) => c.type === "tag" && priceOfEl($, c) !== null));

  for (const el of priceEls) {
    // Climb until the element also holds a name (words that aren't prices or sizes).
    let node: AnyNode | null = el.parent;
    let container: Element | null = null;
    while (node && node.type === "tag") {
      const t = squash($(node).text());
      if (t.length > MAX_ITEM_TEXT) break;
      if (/[a-z]{3,}/i.test(wordsOnly(t))) {
        container = node as Element;
        break;
      }
      node = node.parent;
    }
    if (!container) {
      unplaced++;
      continue;
    }
    const price = priceOfEl($, el)!;
    const entry = containers.get(container) ?? { prices: [] };
    entry.prices.push({ label: labelFor($, el, container), price_pkr: price });
    containers.set(container, entry);
  }

  // A container that holds other containers is a section, not an item.
  const all = [...containers.keys()];
  const items: ParsedMenuItem[] = [];
  for (const [c, { prices }] of containers) {
    if (all.some((o) => o !== c && $(c).find(o).length)) continue;
    let name = nameIn($, c);
    if (!name) continue;
    if (name.length > 60) name = name.split(/\s[-–—|]\s|\.\s/)[0].trim();
    if (name.length > 60) {
      warnings.push(`Skipped a priced block whose name is too long to be an item: "${name.slice(0, 40)}…"`);
      continue;
    }
    if (prices.length > 1 && prices.every((p) => p.label === null)) {
      warnings.push(`"${name}" shows ${prices.length} prices without size labels; check sizes against the page.`);
      prices.forEach((p, i) => (p.label = `Option ${i + 1}`));
    }
    const section = squash($(c).prevAll("h2,h3").first().text()) || squash($(c).parent().prevAll("h2,h3").first().text()) || null;
    items.push({ name, section, prices });
  }
  if (unplaced) warnings.push(`${unplaced} price(s) on the page couldn't be tied to an item name.`);
  return items;
}

export function parseMenuPage(html: string): WebsiteMenu {
  const warnings: string[] = [];
  const $ = cheerio.load(html);
  const nodes = jsonLdBlocks($, warnings);
  const hours = hoursFromJsonLd(nodes, warnings);

  const ld = dedupeItems(collectJsonLdItems(nodes, warnings));
  if (ld.length) return { method: "json-ld", items: ld, hours, warnings };

  const fromHtml = dedupeItems(parseHtmlMenu($, warnings));
  if (fromHtml.length) {
    warnings.unshift("No structured menu data on the page; items were read from the page layout. Check names and sizes.");
    return { method: "html", items: fromHtml, hours, warnings };
  }
  return { method: "none", items: [], hours, warnings: [...warnings, "No menu items with PKR prices found on the page."] };
}
