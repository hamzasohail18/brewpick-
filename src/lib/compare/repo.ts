// Read side for Compare. Run as ANON from public pages so RLS decides what's visible.

import type { Db } from "@/lib/db/core";
import type { ConfidenceLevel } from "@/lib/domain/sources";
import { formatPkr } from "@/lib/explore/format";
import type { HoursRow } from "@/lib/explore/hours";
import type { PriceChannel } from "@/lib/explore/repo";
import type { CompareSelection } from "./params";
import type { DealRule } from "@/lib/deals/engine";
import { loadDeals, toRule } from "@/lib/deals/repo";

/** Size used to pick "the" latte at each place when comparing places: closest to a regular cup. */
export const REFERENCE_ML = 350;

/** When places are compared without a drink, prefer the drink most of them serve, then this order. */
const DRINK_PREFERENCE = ["latte", "cappuccino", "americano", "flat-white", "iced-latte", "espresso"];

export interface CompareDrink {
  sizeId: string;
  menuItemId: string;
  name: string;
  drinkType: string | null;
  size: string;
  volumeMl: number | null;
  volumeIsAssumed: boolean;
  channel: PriceChannel;
  pricePkr: number;
  taxInclusive: boolean | null;
  priceConfidence: ConfidenceLevel;
  priceVerifiedAt: string;
  priceSourceName: string | null;
  /** After the best deal open to everyone right now (saved cards come with the Deals step). */
  effectivePricePkr: number;
  discountPkr: number;
  dealTitle: string | null;
  kcal: number | null;
  sugarG: number | null;
  caffeineMg: number | null;
  nutritionConfidence: ConfidenceLevel | null;
  nutritionAssumptions: string | null;
  pricePer100ml: number | null;
  kcalPerPkr: number | null;
}

export interface ComparePlace {
  id: string;
  brandId: string | null;
  slug: string;
  name: string;
  branchName: string | null;
  areaName: string | null;
  lat: number;
  lng: number;
  rating: number | null;
  ratingCount: number;
  isSample: boolean;
  hours: HoursRow[];
  activeDeals: number;
}

export interface CompareColumn {
  key: string;
  place: ComparePlace;
  /** null when the place doesn't serve the requested drink (or has no price for it). */
  drink: CompareDrink | null;
  beans: { kind: string | null; roast: string | null; origin: string | null; arabicaPct: number | null } | null;
}

export interface CompareResult {
  drink: { slug: string; name: string } | null;
  columns: CompareColumn[];
  /** Live deals at the compared places, so prices after deals follow the user's saved cards. */
  deals: DealRule[];
}

export async function getComparison(db: Db, sel: CompareSelection, paymentMethodIds: number[] = []): Promise<CompareResult> {
  const drinkSlug = sel.places.length ? (sel.drink ?? (await defaultDrink(db, sel.places))) : null;

  // Places compared by drink -> the size closest to a regular cup, dine-in before takeaway.
  const resolved = sel.places.length && drinkSlug
    ? await db.query<{ place_slug: string; item_size_id: string }>(
        `select distinct on (m.place_slug) m.place_slug, m.item_size_id
           from v_current_menu m
          where m.place_slug = any ($1::text[]) and m.drink_type_slug = $2 and m.channel <> 'delivery'
          order by m.place_slug, m.channel, abs(coalesce(m.volume_ml, ${REFERENCE_ML}) - ${REFERENCE_ML}), m.price_pkr`,
        [sel.places, drinkSlug],
      )
    : [];
  const sizeIds = [...sel.items, ...resolved.map((r) => r.item_size_id)];

  const drinks = sizeIds.length
    ? await db.query<Record<string, unknown>>(
        `select distinct on (m.item_size_id) m.*, ep.effective_price_pkr, ep.discount_pkr, ep.deal_title,
                sl.name as price_source_name
           from v_current_menu m
           cross join lateral effective_price_detail(m.item_size_id, $2::int[], now(), m.channel) ep
           left join v_source_labels sl on sl.id = m.price_source_id
          where m.item_size_id = any ($1::uuid[]) and m.channel <> 'delivery'
          order by m.item_size_id, m.channel`,
        [sizeIds, paymentMethodIds],
      )
    : [];
  const drinkBySize = new Map(drinks.map((d) => [d.item_size_id as string, d]));

  const placeIds = [...new Set(drinks.map((d) => d.place_id as string))];
  const places = placeIds.length || sel.places.length
    ? await db.query<Record<string, unknown>>(
        `select p.id, p.brand_id, p.slug, p.name, p.branch_name, a.name as area_name, p.lat::float8 as lat, p.lng::float8 as lng,
                p.rating_avg::float8 as rating, coalesce(p.rating_count, 0) as rating_count, p.is_sample,
                (select coalesce(json_agg(json_build_object('day_of_week', h.day_of_week, 'opens_at', left(h.opens_at::text, 5),
                          'closes_at', left(h.closes_at::text, 5), 'is_closed', h.is_closed) order by h.day_of_week), '[]'::json)
                   from place_hours h where h.place_id = p.id) as hours,
                (select count(*)::int from deals d
                  where d.status = 'published'
                    and (now() at time zone 'Asia/Karachi')::date between d.valid_from and d.valid_to
                    and (d.place_id = p.id or (d.place_id is null and d.brand_id = p.brand_id))) as active_deals
           from places p left join areas a on a.id = p.area_id
          where p.status = 'published' and (p.id = any ($1::uuid[]) or p.slug = any ($2::text[]))`,
        [placeIds, sel.places],
      )
    : [];
  const placeById = new Map(places.map((p) => [p.id as string, toPlace(p)]));
  const placeBySlug = new Map([...placeById.values()].map((p) => [p.slug, p]));

  const beans = placeIds.length || places.length
    ? await db.query<{ place_id: string; menu_item_id: string | null; kind: string | null; roast: string | null; origin_country: string | null; arabica_pct: number | null }>(
        `select place_id, menu_item_id, kind, roast, origin_country, arabica_pct
           from bean_info where place_id = any ($1::uuid[]) order by menu_item_id nulls last`,
        [[...placeById.keys()]],
      )
    : [];

  const beansFor = (placeId: string, menuItemId: string | null) => {
    const b = beans.find((x) => x.place_id === placeId && x.menu_item_id === menuItemId) ?? beans.find((x) => x.place_id === placeId && !x.menu_item_id);
    return b ? { kind: b.kind, roast: b.roast, origin: b.origin_country, arabicaPct: b.arabica_pct } : null;
  };

  const columns: CompareColumn[] = [];
  for (const sizeId of sel.items) {
    const d = drinkBySize.get(sizeId);
    const place = d && placeById.get(d.place_id as string);
    if (d && place) columns.push({ key: sizeId, place, drink: toDrink(d), beans: beansFor(place.id, d.menu_item_id as string) });
  }
  for (const slug of sel.places) {
    const place = placeBySlug.get(slug);
    if (!place) continue;
    const sizeId = resolved.find((r) => r.place_slug === slug)?.item_size_id;
    const d = sizeId ? drinkBySize.get(sizeId) : undefined;
    columns.push({ key: `place:${slug}`, place, drink: d ? toDrink(d) : null, beans: beansFor(place.id, (d?.menu_item_id as string) ?? null) });
  }

  let drink: CompareResult["drink"] = null;
  if (drinkSlug) {
    const [row] = await db.query<{ slug: string; name: string }>("select slug, name from drink_types where slug = $1", [drinkSlug]);
    drink = row ?? null;
  }
  const deals = (await loadDeals(db, { placeIds: [...new Set(columns.map((c) => c.place.id))] })).map(toRule);
  return { drink, columns, deals };
}

/** The drink served by most of these places (ties broken by DRINK_PREFERENCE, then name). */
export async function defaultDrink(db: Db, placeSlugs: string[]): Promise<string | null> {
  const [row] = await db.query<{ slug: string }>(
    `select m.drink_type_slug as slug
       from v_current_menu m
      where m.place_slug = any ($1::text[]) and m.drink_type_slug is not null
      group by m.drink_type_slug
      order by count(distinct m.place_slug) desc, array_position($2::text[], m.drink_type_slug::text) nulls last, m.drink_type_slug
      limit 1`,
    [placeSlugs, DRINK_PREFERENCE],
  );
  return row?.slug ?? null;
}

function toPlace(p: Record<string, unknown>): ComparePlace {
  return {
    id: p.id as string,
    brandId: (p.brand_id as string) ?? null,
    slug: p.slug as string,
    name: p.name as string,
    branchName: (p.branch_name as string) ?? null,
    areaName: (p.area_name as string) ?? null,
    lat: p.lat as number,
    lng: p.lng as number,
    rating: (p.rating as number) ?? null,
    ratingCount: p.rating_count as number,
    isSample: p.is_sample as boolean,
    hours: p.hours as HoursRow[],
    activeDeals: p.active_deals as number,
  };
}

function toDrink(d: Record<string, unknown>): CompareDrink {
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    sizeId: d.item_size_id as string,
    menuItemId: d.menu_item_id as string,
    name: d.display_name as string,
    drinkType: (d.drink_type_slug as string) ?? null,
    size: d.size_label as string,
    volumeMl: (d.volume_ml as number) ?? null,
    volumeIsAssumed: d.volume_is_assumed as boolean,
    channel: d.channel as PriceChannel,
    pricePkr: d.price_pkr as number,
    taxInclusive: d.tax_inclusive as boolean | null,
    priceConfidence: d.price_confidence as ConfidenceLevel,
    priceVerifiedAt: new Date(d.price_verified_at as Date).toISOString(),
    priceSourceName: (d.price_source_name as string) ?? null,
    effectivePricePkr: d.effective_price_pkr as number,
    discountPkr: d.discount_pkr as number,
    dealTitle: (d.deal_title as string) ?? null,
    kcal: (d.calories_kcal as number) ?? null,
    sugarG: num(d.sugar_g),
    caffeineMg: (d.caffeine_mg as number) ?? null,
    nutritionConfidence: (d.nutrition_confidence as ConfidenceLevel) ?? null,
    nutritionAssumptions: (d.nutrition_assumptions as string) ?? null,
    pricePer100ml: num(d.price_per_100ml),
    kcalPerPkr: num(d.kcal_per_pkr),
  };
}

/** Plain-text summary for sharing on WhatsApp. */
export function shareText(result: CompareResult): string {
  const title = result.drink ? `${result.drink.name} compared on BrewPick Lahore` : "Coffee compared on BrewPick Lahore";
  const lines = result.columns.map((c) => {
    const where = c.place.branchName ? `${c.place.name} (${c.place.branchName})` : c.place.name;
    if (!c.drink) return `• ${where}: not on the menu`;
    const price = c.drink.effectivePricePkr < c.drink.pricePkr ? `${formatPkr(c.drink.effectivePricePkr)} after deal` : formatPkr(c.drink.pricePkr);
    const kcal = c.drink.kcal !== null ? `, ${c.drink.kcal} kcal` : "";
    return `• ${where}: ${c.drink.name} ${c.drink.size}, ${price}${kcal}`;
  });
  const sample = result.columns.some((c) => c.place.isSample) ? ["(Includes fictional sample data.)"] : [];
  return [title, ...lines, ...sample].join("\n");
}
