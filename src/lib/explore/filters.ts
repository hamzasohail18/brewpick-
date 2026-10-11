// Explore filters (Section 3F). They live in the URL so a filtered list can be shared or bookmarked.
// Location never goes in the URL: distance, "open now" and the distance limit are applied on the phone.

export const PLACE_TYPES = ["specialty_cafe", "chain", "kiosk_drive_thru", "bakery_cafe"] as const;
export const ROASTS = ["light", "medium_light", "medium", "medium_dark", "dark"] as const;
export const ALLERGENS = ["dairy", "nuts", "gluten", "soy"] as const;
export const SORTS = ["distance", "price", "calories", "rating", "name"] as const;

export const PLACE_TYPE_LABELS: Record<(typeof PLACE_TYPES)[number], string> = {
  specialty_cafe: "Specialty cafe",
  chain: "Chain",
  kiosk_drive_thru: "Kiosk / drive-thru",
  bakery_cafe: "Bakery cafe",
};
export const ROAST_LABELS: Record<(typeof ROASTS)[number], string> = {
  light: "Light",
  medium_light: "Medium-light",
  medium: "Medium",
  medium_dark: "Medium-dark",
  dark: "Dark",
};
export const ALLERGEN_LABELS: Record<(typeof ALLERGENS)[number], string> = { dairy: "Dairy", nuts: "Nuts", gluten: "Gluten", soy: "Soy" };
export const SORT_LABELS: Record<(typeof SORTS)[number], string> = {
  distance: "Nearest",
  price: "Cheapest",
  calories: "Fewest calories",
  rating: "Top rated",
  name: "A–Z",
};

// Plain parsers instead of a schema library: this module ships to the phone, and every rule is
// "keep it if valid, else drop it", so a hand-edited URL never errors.
type Parser<T> = (v: unknown) => T | undefined;
const num =
  (max: number): Parser<number> =>
  (v) => {
    const n = typeof v === "number" || typeof v === "string" ? Number(v) : NaN;
    return Number.isInteger(n) && n > 0 && n <= max ? n : undefined;
  };
const flag: Parser<true> = (v) => (v === "1" || v === "true" || v === true ? true : undefined);
const oneOf =
  <T extends string>(values: readonly T[]): Parser<T> =>
  (v) =>
    typeof v === "string" && (values as readonly string[]).includes(v) ? (v as T) : undefined;
const slug: Parser<string> = (v) => (typeof v === "string" && /^[a-z0-9_-]{1,40}$/.test(v) ? v : undefined);
const text: Parser<string> = (v) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 60) : undefined);
const allergens: Parser<(typeof ALLERGENS)[number][]> = (v) => {
  const list = (Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : []).filter((a): a is (typeof ALLERGENS)[number] =>
    (ALLERGENS as readonly string[]).includes(a),
  );
  return list.length ? [...new Set(list)].sort() : undefined;
};

const FIELDS = {
  q: text,
  // drink-level (server)
  drink: slug, // drink_types.slug
  temp: oneOf(["hot", "iced"] as const),
  maxPrice: num(5000),
  maxKcal: num(2500),
  maxSugar: num(200),
  minCaffeine: num(1000),
  roast: oneOf(ROASTS),
  milk: slug, // milk_types.slug offered as an option
  avoid: allergens,
  dairyFree: flag,
  // place-level (server)
  type: oneOf(PLACE_TYPES),
  area: num(10_000),
  deals: flag,
  halal: flag,
  family: flag,
  wifi: flag,
  driveThru: flag,
  // applied on the phone
  openNow: flag,
  maxKm: num(100),
  sort: oneOf(SORTS),
} satisfies Record<string, Parser<unknown>>;

/** Every field is optional and invalid values are dropped. */
export type ExploreFilters = { [K in keyof typeof FIELDS]?: NonNullable<ReturnType<(typeof FIELDS)[K]>> };
export const FILTER_KEYS = Object.keys(FIELDS) as (keyof ExploreFilters)[];

/** Filters the server needs (everything except the on-device ones). Used as the query cache key. */
export const SERVER_KEYS = [
  "q", "drink", "temp", "maxPrice", "maxKcal", "maxSugar", "minCaffeine", "roast", "milk", "avoid", "dairyFree",
  "type", "area", "deals", "halal", "family", "wifi", "driveThru",
] as const satisfies readonly (keyof ExploreFilters)[];

export const DRINK_KEYS = [
  "drink", "temp", "maxPrice", "maxKcal", "maxSugar", "minCaffeine", "roast", "milk", "avoid", "dairyFree",
] as const satisfies readonly (keyof ExploreFilters)[];

export function parseFilters(input: URLSearchParams | Record<string, string | string[] | undefined>): ExploreFilters {
  const obj: Record<string, unknown> = {};
  if (input instanceof URLSearchParams) {
    for (const key of new Set(input.keys())) {
      const all = input.getAll(key);
      obj[key] = all.length > 1 ? all : all[0];
    }
  } else {
    Object.assign(obj, input);
  }
  const out: Record<string, unknown> = {};
  for (const k of FILTER_KEYS) {
    const v = (FIELDS[k] as Parser<unknown>)(obj[k]);
    if (v !== undefined) out[k] = v;
  }
  return out as ExploreFilters;
}

/** Stable URL encoding (sorted keys, defaults omitted). */
export function filtersToParams(f: ExploreFilters, keys: readonly (keyof ExploreFilters)[] = FILTER_KEYS): URLSearchParams {
  const p = new URLSearchParams();
  for (const k of [...keys].sort()) {
    const v = f[k];
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      if (v.length) p.set(k, v.join(","));
    } else if (v === true) p.set(k, "1");
    else p.set(k, String(v));
  }
  return p;
}

export const hasDrinkFilters = (f: ExploreFilters) => DRINK_KEYS.some((k) => f[k] !== undefined);

/** How many filters are on (for the "Filters (3)" button); search text and sort don't count. */
export function activeFilterCount(f: ExploreFilters): number {
  return (Object.keys(f) as (keyof ExploreFilters)[]).filter((k) => k !== "q" && k !== "sort" && f[k] !== undefined).length;
}
