// Explore filters (Section 3F). They live in the URL so a filtered list can be shared or bookmarked.
// Location never goes in the URL: distance, "open now" and the distance limit are applied on the phone.

import { z } from "zod";

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

const num = (max: number) =>
  z.preprocess((v) => {
    const n = typeof v === "number" || typeof v === "string" ? Number(v) : NaN;
    return Number.isInteger(n) && n > 0 && n <= max ? n : undefined;
  }, z.number().optional());
const flag = z.preprocess((v) => (v === "1" || v === "true" || v === true ? true : undefined), z.literal(true).optional());
const oneOf = <T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess((v) => (typeof v === "string" && (values as readonly string[]).includes(v) ? v : undefined), z.enum(values).optional());
const slug = z.preprocess((v) => (typeof v === "string" && /^[a-z0-9_-]{1,40}$/.test(v) ? v : undefined), z.string().optional());

/** Every field is optional and invalid values are dropped, so a hand-edited URL never errors. */
export const ExploreFiltersSchema = z.object({
  q: z.preprocess((v) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 60) : undefined), z.string().optional()),
  // drink-level (server)
  drink: slug, // drink_types.slug
  temp: oneOf(["hot", "iced"] as const),
  maxPrice: num(5000),
  maxKcal: num(2500),
  maxSugar: num(200),
  minCaffeine: num(1000),
  roast: oneOf(ROASTS),
  milk: slug, // milk_types.slug offered as an option
  avoid: z.preprocess(
    (v) => {
      const list = (Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : []).filter((a) => (ALLERGENS as readonly string[]).includes(a));
      return list.length ? [...new Set(list)].sort() : undefined;
    },
    z.array(z.enum(ALLERGENS)).optional(),
  ),
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
});

export type ExploreFilters = z.infer<typeof ExploreFiltersSchema>;

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
  return ExploreFiltersSchema.parse(obj);
}

/** Stable URL encoding (sorted keys, defaults omitted). */
export function filtersToParams(f: ExploreFilters, keys: readonly (keyof ExploreFilters)[] = Object.keys(ExploreFiltersSchema.shape) as (keyof ExploreFilters)[]): URLSearchParams {
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
