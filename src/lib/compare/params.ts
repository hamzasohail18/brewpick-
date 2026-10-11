// Compare selection (Section 3D) lives in the URL so a comparison can be shared as a link.
//   /compare?items=<item_size id>,<item_size id>          specific drinks (a size at a place)
//   /compare?places=<slug>,<slug>&drink=latte              the same drink across places
// Both can be combined; at most MAX_COMPARE columns in total.

export const MAX_COMPARE = 4;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9][a-z0-9-]{0,80}$/;

export interface CompareSelection {
  items: string[];
  places: string[];
  drink: string | null;
}

type Input = URLSearchParams | Record<string, string | string[] | undefined>;

function list(input: Input, key: string): string[] {
  const raw = input instanceof URLSearchParams ? input.getAll(key) : [input[key] ?? []].flat();
  return raw.flatMap((v) => v.split(",")).map((v) => v.trim()).filter(Boolean);
}

/** Invalid entries are dropped, duplicates removed, and the total capped at MAX_COMPARE. */
export function parseCompare(input: Input): CompareSelection {
  const items = [...new Set(list(input, "items").map((v) => v.toLowerCase()).filter((v) => UUID.test(v)))].slice(0, MAX_COMPARE);
  const places = [...new Set(list(input, "places").filter((v) => SLUG.test(v)))].slice(0, MAX_COMPARE - items.length);
  const drinkRaw = list(input, "drink")[0];
  const drink = drinkRaw && SLUG.test(drinkRaw) ? drinkRaw : null;
  return { items, places, drink };
}

export function compareHref(sel: Partial<CompareSelection>): string {
  const p = new URLSearchParams();
  if (sel.items?.length) p.set("items", sel.items.join(","));
  if (sel.places?.length) p.set("places", sel.places.join(","));
  if (sel.drink && sel.places?.length) p.set("drink", sel.drink);
  const qs = p.toString().replace(/%2C/g, ",");
  return qs ? `/compare?${qs}` : "/compare";
}

export const selectionSize = (s: CompareSelection) => s.items.length + s.places.length;
