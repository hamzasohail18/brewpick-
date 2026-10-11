// Read side for Explore and the place page. Run these as ANON (dbAs(ANON, ...)) from public pages so
// RLS shows exactly what the public may see; the explicit status/date checks below are a second guard.

import type { Db } from "@/lib/db/core";
import type { ConfidenceLevel } from "@/lib/domain/sources";
import type { ExploreFilters } from "./filters";
import { hasDrinkFilters } from "./filters";
import type { HoursRow } from "./hours";

export type PriceChannel = "dine_in" | "takeaway" | "delivery";

export interface DrinkPick {
  name: string;
  drinkType: string | null;
  size: string;
  volumeMl: number | null;
  pricePkr: number;
  channel: PriceChannel;
  kcal: number | null;
  sugarG: number | null;
  caffeineMg: number | null;
  priceConfidence: ConfidenceLevel;
  priceVerifiedAt: string;
  nutritionConfidence: ConfidenceLevel | null;
}

export interface PlaceSummary {
  id: string;
  slug: string;
  name: string;
  branchName: string | null;
  type: string;
  areaName: string | null;
  lat: number;
  lng: number;
  isSample: boolean;
  rating: number | null;
  ratingCount: number;
  halal: boolean | null;
  wifi: boolean | null;
  family: boolean | null;
  driveThru: boolean | null;
  confidence: ConfidenceLevel;
  verifiedAt: string;
  sourceName: string | null;
  hours: HoursRow[];
  hasMenu: boolean;
  /** Drinks matching the drink filters (all drinks when none are set). */
  matchCount: number;
  /** Cheapest matching drink. */
  cheapest: DrinkPick | null;
  /** Lowest-calorie matching drink with calorie data. */
  lightest: DrinkPick | null;
  dealCount: number;
}

const TODAY = "(now() at time zone 'Asia/Karachi')::date";

/** Active-deal predicate for a deals row `d` against a places row `p`. */
const ACTIVE_DEAL = `d.status = 'published' and d.valid_from <= ${TODAY} and d.valid_to >= ${TODAY}
  and (d.place_id = p.id or (d.place_id is null and d.brand_id = p.brand_id))`;

const PICK_COLUMNS = `
  m.display_name as name, m.drink_type_slug as "drinkType", m.size_label as size, m.volume_ml as "volumeMl",
  m.price_pkr as "pricePkr", m.channel, m.calories_kcal as kcal, m.sugar_g::float8 as "sugarG",
  m.caffeine_mg as "caffeineMg", m.price_confidence as "priceConfidence", m.price_verified_at as "priceVerifiedAt",
  m.nutrition_confidence as "nutritionConfidence"`;

export async function searchPlaces(db: Db, f: ExploreFilters): Promise<PlaceSummary[]> {
  const params: unknown[] = [];
  const $ = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };

  // Drink-level conditions on v_current_menu rows `m`. Missing data never counts as a match:
  // a calorie limit skips drinks without calorie data, allergen filters skip drinks with no allergen info.
  const drink: string[] = ["m.channel <> 'delivery'"]; // delivery prices are marked up; deals screen covers them
  if (f.drink) drink.push(`m.drink_type_slug = ${$(f.drink)}`);
  if (f.temp) drink.push(`m.temperature in (${$(f.temp)}::temperature, 'both')`);
  if (f.maxPrice) drink.push(`m.price_pkr <= ${$(f.maxPrice)}`);
  if (f.maxKcal) drink.push(`m.calories_kcal <= ${$(f.maxKcal)}`);
  if (f.maxSugar) drink.push(`m.sugar_g <= ${$(f.maxSugar)}`);
  if (f.minCaffeine) drink.push(`m.caffeine_mg >= ${$(f.minCaffeine)}`);
  if (f.roast) {
    drink.push(`exists (select 1 from bean_info b where b.place_id = m.place_id
      and (b.menu_item_id is null or b.menu_item_id = m.menu_item_id) and b.roast = ${$(f.roast)}::roast_level)`);
  }
  if (f.milk) {
    drink.push(`exists (select 1 from item_milk_options o join milk_types mt on mt.id = o.milk_type_id
      where o.menu_item_id = m.menu_item_id and mt.slug = ${$(f.milk)})`);
  }
  if (f.avoid?.length) {
    const codes = $(f.avoid);
    drink.push(`(exists (select 1 from item_allergens ia where ia.menu_item_id = m.menu_item_id)
      or exists (select 1 from item_ingredients ii where ii.menu_item_id = m.menu_item_id))`);
    drink.push(`not exists (select 1 from item_allergens ia join allergens al on al.id = ia.allergen_id
      where ia.menu_item_id = m.menu_item_id and al.code = any (${codes}::text[]))`);
    if (f.avoid.includes("dairy")) drink.push("m.has_milk = false");
  }
  if (f.dairyFree) {
    drink.push(`(m.has_milk = false
      or exists (select 1 from menu_items mi where mi.id = m.menu_item_id and mi.is_vegan_possible)
      or exists (select 1 from item_milk_options o join milk_types mt on mt.id = o.milk_type_id
                  where o.menu_item_id = m.menu_item_id and not mt.is_dairy))`);
  }

  const place: string[] = ["p.status = 'published'"];
  if (hasDrinkFilters(f)) place.push("agg.place_id is not null");
  if (f.q) {
    const like = $(`%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    place.push(`(p.name ilike ${like} or p.branch_name ilike ${like} or a.name ilike ${like})`);
  }
  if (f.type) place.push(`p.type = ${$(f.type)}::place_type`);
  if (f.area) place.push(`p.area_id = ${$(f.area)}`);
  if (f.halal) place.push("p.halal_certified");
  if (f.family) place.push("p.has_family_seating");
  if (f.wifi) place.push("p.has_wifi");
  if (f.driveThru) place.push("p.has_drive_thru");
  if (f.deals) place.push(`exists (select 1 from deals d where ${ACTIVE_DEAL})`);

  const rows = await db.query<Omit<PlaceSummary, "hours" | "verifiedAt"> & { hours: RawHours[] | null; verifiedAt: Date | string }>(
    `with m as (
       select m.* from v_current_menu m where ${drink.join(" and ")}
     ),
     agg as (select place_id, count(*)::int as n from m group by place_id)
     select p.id, p.slug, p.name, p.branch_name as "branchName", p.type, a.name as "areaName",
            p.lat::float8 as lat, p.lng::float8 as lng, p.is_sample as "isSample",
            p.rating_avg::float8 as rating, coalesce(p.rating_count, 0) as "ratingCount",
            p.halal_certified as halal, p.has_wifi as wifi, p.has_family_seating as family, p.has_drive_thru as "driveThru",
            display_confidence(p.confidence, coalesce(p.last_verified_at, p.created_at)) as confidence,
            coalesce(p.last_verified_at, p.created_at) as "verifiedAt",
            sl.name as "sourceName",
            (select json_agg(json_build_object('day_of_week', h.day_of_week, 'opens_at', h.opens_at,
                                               'closes_at', h.closes_at, 'is_closed', h.is_closed) order by h.day_of_week)
               from place_hours h where h.place_id = p.id) as hours,
            exists (select 1 from menu_items mi where mi.place_id = p.id and mi.status = 'published') as "hasMenu",
            coalesce(agg.n, 0) as "matchCount",
            (select row_to_json(x) from (select ${PICK_COLUMNS} from m where m.place_id = p.id
               order by m.price_pkr, m.volume_ml desc nulls last, m.display_name limit 1) x) as cheapest,
            (select row_to_json(x) from (select ${PICK_COLUMNS} from m where m.place_id = p.id and m.calories_kcal is not null
               order by m.calories_kcal, m.price_pkr, m.display_name limit 1) x) as lightest,
            (select count(*)::int from deals d where ${ACTIVE_DEAL}) as "dealCount"
       from places p
       left join areas a on a.id = p.area_id
       left join v_source_labels sl on sl.id = p.source_id
       left join agg on agg.place_id = p.id
      where ${place.join(" and ")}
      order by p.name, p.branch_name nulls first`,
    params,
  );

  return rows.map((r) => ({
    ...r,
    verifiedAt: iso(r.verifiedAt),
    hours: normHours(r.hours),
    cheapest: normPick(r.cheapest),
    lightest: normPick(r.lightest),
  }));
}

// ---------- place detail ----------

export interface PriceLine {
  channel: PriceChannel;
  pricePkr: number;
  taxInclusive: boolean | null;
  confidence: ConfidenceLevel;
  verifiedAt: string;
  sourceName: string | null;
  sourceUrl: string | null;
  proofImageUrl: string | null;
  pricePer100ml: number | null;
}

export interface SizeLine {
  id: string;
  label: string;
  volumeMl: number | null;
  volumeIsAssumed: boolean;
  prices: PriceLine[];
  nutrition: {
    kcal: number | null;
    sugarG: number | null;
    caffeineMg: number | null;
    assumptions: string | null;
    confidence: ConfidenceLevel | null;
    sourceName: string | null;
  } | null;
}

export interface MenuItemDetail {
  id: string;
  name: string;
  drinkType: string | null;
  temperature: "hot" | "iced" | "both";
  hasMilk: boolean | null;
  veganPossible: boolean | null;
  description: string | null;
  sizes: SizeLine[];
  milkOptions: { slug: string; name: string; isDairy: boolean; extraPricePkr: number; extraKcal: number | null }[];
  allergens: { code: string; name: string; confidence: ConfidenceLevel }[];
  ingredients: string[];
}

export interface BeanDetail {
  menuItemId: string | null;
  kind: "single_origin" | "blend" | null;
  originCountry: string | null;
  originRegion: string | null;
  roaster: string | null;
  roast: string | null;
  arabicaPct: number | null;
  robustaPct: number | null;
  tastingNotes: string | null;
  confidence: ConfidenceLevel;
  verifiedAt: string;
  sourceName: string | null;
}

export interface DealDetail {
  id: string;
  title: string;
  dealType: string;
  discount: string;
  discountValue: number | null;
  maxDiscountPkr: number | null;
  minSpendPkr: number | null;
  validFrom: string; // YYYY-MM-DD
  validTo: string;
  daysOfWeek: number[] | null;
  startTime: string | null;
  endTime: string | null;
  terms: string | null;
  isBrandWide: boolean;
  isSample: boolean;
  paymentMethods: string[];
  conditions: string[];
  items: string[];
  sourceName: string | null;
  sourceUrl: string | null;
  proofImageUrl: string | null;
  confidence: ConfidenceLevel;
  verifiedAt: string;
  upvotes: number;
  downvotes: number;
}

export interface PlaceDetail extends Omit<PlaceSummary, "matchCount" | "cheapest" | "lightest" | "dealCount"> {
  address: string | null;
  phone: string | null;
  websiteUrl: string | null;
  instagramHandle: string | null;
  brandName: string | null;
  sourceKind: string | null;
  menu: MenuItemDetail[];
  beans: BeanDetail[];
  deals: DealDetail[];
}

export async function getPlaceDetail(db: Db, slug: string): Promise<PlaceDetail | null> {
  const [p] = await db.query<Record<string, unknown>>(
    `select p.id, p.slug, p.name, p.branch_name, p.type, a.name as area_name, p.lat::float8 as lat, p.lng::float8 as lng,
            p.is_sample, p.rating_avg::float8 as rating, coalesce(p.rating_count, 0) as rating_count,
            p.halal_certified, p.has_wifi, p.has_family_seating, p.has_drive_thru,
            display_confidence(p.confidence, coalesce(p.last_verified_at, p.created_at)) as confidence,
            coalesce(p.last_verified_at, p.created_at) as verified_at,
            p.address, p.phone, p.website_url, p.instagram_handle, b.name as brand_name,
            sl.name as source_name, sl.kind as source_kind
       from places p
       left join areas a on a.id = p.area_id
       left join brands b on b.id = p.brand_id
       left join v_source_labels sl on sl.id = p.source_id
      where p.slug = $1 and p.status = 'published'`,
    [slug],
  );
  if (!p) return null;
  const placeId = p.id as string;

  const [hours, menuRows, beans, deals] = await Promise.all([
    db.query<RawHours>(
      "select day_of_week, opens_at, closes_at, is_closed from place_hours where place_id = $1 order by day_of_week",
      [placeId],
    ),
    db.query<Record<string, unknown>>(
      `select m.*, mi.description, mi.is_vegan_possible, pr.proof_image_url,
              psl.name as price_source_name, nsl.name as nutrition_source_name
         from v_current_menu m
         join menu_items mi on mi.id = m.menu_item_id
         join item_prices pr on pr.id = m.price_id
         left join v_source_labels psl on psl.id = m.price_source_id
         left join v_source_labels nsl on nsl.id = m.nutrition_source_id
        where m.place_id = $1
        order by m.display_name, m.menu_item_id, m.volume_ml nulls last, m.size_label,
                 array_position(array['dine_in','takeaway','delivery']::price_channel[], m.channel)`,
      [placeId],
    ),
    db.query<Record<string, unknown>>(
      `select bi.*, sl.name as source_name, coalesce(bi.last_verified_at, bi.captured_at) as verified_at,
              display_confidence(bi.confidence, coalesce(bi.last_verified_at, bi.captured_at)) as display_confidence
         from bean_info bi left join v_source_labels sl on sl.id = bi.source_id
        where bi.place_id = $1
        order by bi.menu_item_id nulls first`,
      [placeId],
    ),
    db.query<Record<string, unknown>>(
      `select d.*, to_char(d.valid_from, 'YYYY-MM-DD') as valid_from_s, to_char(d.valid_to, 'YYYY-MM-DD') as valid_to_s,
              sl.name as source_name, coalesce(d.last_verified_at, d.captured_at) as verified_at,
              display_confidence(d.confidence, coalesce(d.last_verified_at, d.captured_at)) as display_confidence,
              array(select pm.name from deal_payment_methods dpm join payment_methods pm on pm.id = dpm.payment_method_id
                     where dpm.deal_id = d.id order by pm.name) as payment_methods,
              array(select dc.condition_key from deal_conditions dc where dc.deal_id = d.id order by dc.id) as conditions,
              array(select mi.display_name from deal_items di join menu_items mi on mi.id = di.menu_item_id
                     where di.deal_id = d.id order by mi.display_name) as items
         from deals d
         join places p on p.id = $1
         left join v_source_labels sl on sl.id = d.source_id
        where ${ACTIVE_DEAL}
        order by d.valid_to, d.title`,
      [placeId],
    ),
  ]);

  const itemIds = [...new Set(menuRows.map((r) => r.menu_item_id as string))];
  const [milk, allergens, ingredients] = itemIds.length
    ? await Promise.all([
        db.query<{ menu_item_id: string; slug: string; name: string; is_dairy: boolean; extra_price_pkr: number; extra_kcal: number | null }>(
          `select o.menu_item_id, mt.slug, mt.name, mt.is_dairy, o.extra_price_pkr, o.extra_kcal
             from item_milk_options o join milk_types mt on mt.id = o.milk_type_id
            where o.menu_item_id = any ($1::uuid[]) order by o.extra_price_pkr, mt.name`,
          [itemIds],
        ),
        db.query<{ menu_item_id: string; code: string; name: string; confidence: ConfidenceLevel }>(
          `select ia.menu_item_id, al.code, al.name, ia.confidence
             from item_allergens ia join allergens al on al.id = ia.allergen_id
            where ia.menu_item_id = any ($1::uuid[]) order by al.name`,
          [itemIds],
        ),
        db.query<{ menu_item_id: string; name: string }>(
          `select ii.menu_item_id, i.name from item_ingredients ii join ingredients i on i.id = ii.ingredient_id
            where ii.menu_item_id = any ($1::uuid[]) order by i.id`,
          [itemIds],
        ),
      ])
    : [[], [], []];

  const items = new Map<string, MenuItemDetail>();
  for (const r of menuRows) {
    const itemId = r.menu_item_id as string;
    let item = items.get(itemId);
    if (!item) {
      item = {
        id: itemId,
        name: r.display_name as string,
        drinkType: (r.drink_type_slug as string) ?? null,
        temperature: r.temperature as MenuItemDetail["temperature"],
        hasMilk: r.has_milk as boolean | null,
        veganPossible: r.is_vegan_possible as boolean | null,
        description: (r.description as string) ?? null,
        sizes: [],
        milkOptions: milk.filter((o) => o.menu_item_id === itemId).map((o) => ({
          slug: o.slug, name: o.name, isDairy: o.is_dairy, extraPricePkr: o.extra_price_pkr, extraKcal: o.extra_kcal,
        })),
        allergens: allergens.filter((a) => a.menu_item_id === itemId).map((a) => ({ code: a.code, name: a.name, confidence: a.confidence })),
        ingredients: ingredients.filter((i) => i.menu_item_id === itemId).map((i) => i.name),
      };
      items.set(itemId, item);
    }
    const sizeId = r.item_size_id as string;
    let size = item.sizes.find((s) => s.id === sizeId);
    if (!size) {
      const hasNutrition = r.calories_kcal !== null || r.sugar_g !== null || r.caffeine_mg !== null;
      size = {
        id: sizeId,
        label: r.size_label as string,
        volumeMl: r.volume_ml as number | null,
        volumeIsAssumed: r.volume_is_assumed as boolean,
        prices: [],
        nutrition: hasNutrition
          ? {
              kcal: r.calories_kcal as number | null,
              sugarG: numOrNull(r.sugar_g),
              caffeineMg: r.caffeine_mg as number | null,
              assumptions: (r.nutrition_assumptions as string) ?? null,
              confidence: (r.nutrition_confidence as ConfidenceLevel) ?? null,
              sourceName: (r.nutrition_source_name as string) ?? null,
            }
          : null,
      };
      item.sizes.push(size);
    }
    size.prices.push({
      channel: r.channel as PriceChannel,
      pricePkr: r.price_pkr as number,
      taxInclusive: r.tax_inclusive as boolean | null,
      confidence: r.price_confidence as ConfidenceLevel,
      verifiedAt: iso(r.price_verified_at as Date),
      sourceName: (r.price_source_name as string) ?? null,
      sourceUrl: (r.price_source_url as string) ?? null,
      proofImageUrl: (r.proof_image_url as string) ?? null,
      pricePer100ml: numOrNull(r.price_per_100ml),
    });
  }

  return {
    id: placeId,
    slug: p.slug as string,
    name: p.name as string,
    branchName: (p.branch_name as string) ?? null,
    type: p.type as string,
    areaName: (p.area_name as string) ?? null,
    lat: p.lat as number,
    lng: p.lng as number,
    isSample: p.is_sample as boolean,
    rating: (p.rating as number) ?? null,
    ratingCount: p.rating_count as number,
    halal: p.halal_certified as boolean | null,
    wifi: p.has_wifi as boolean | null,
    family: p.has_family_seating as boolean | null,
    driveThru: p.has_drive_thru as boolean | null,
    confidence: p.confidence as ConfidenceLevel,
    verifiedAt: iso(p.verified_at as Date),
    sourceName: (p.source_name as string) ?? null,
    sourceKind: (p.source_kind as string) ?? null,
    address: (p.address as string) ?? null,
    phone: (p.phone as string) ?? null,
    websiteUrl: (p.website_url as string) ?? null,
    instagramHandle: (p.instagram_handle as string) ?? null,
    brandName: (p.brand_name as string) ?? null,
    hours: normHours(hours),
    hasMenu: items.size > 0,
    menu: [...items.values()],
    beans: beans.map((b) => ({
      menuItemId: (b.menu_item_id as string) ?? null,
      kind: (b.kind as BeanDetail["kind"]) ?? null,
      originCountry: (b.origin_country as string) ?? null,
      originRegion: (b.origin_region as string) ?? null,
      roaster: (b.roaster as string) ?? null,
      roast: (b.roast as string) ?? null,
      arabicaPct: (b.arabica_pct as number) ?? null,
      robustaPct: (b.robusta_pct as number) ?? null,
      tastingNotes: (b.tasting_notes as string) ?? null,
      confidence: b.display_confidence as ConfidenceLevel,
      verifiedAt: iso(b.verified_at as Date),
      sourceName: (b.source_name as string) ?? null,
    })),
    deals: deals.map((d) => ({
      id: d.id as string,
      title: d.title as string,
      dealType: d.deal_type as string,
      discount: d.discount as string,
      discountValue: numOrNull(d.discount_value),
      maxDiscountPkr: (d.max_discount_pkr as number) ?? null,
      minSpendPkr: (d.min_spend_pkr as number) ?? null,
      validFrom: d.valid_from_s as string,
      validTo: d.valid_to_s as string,
      daysOfWeek: (d.days_of_week as number[]) ?? null,
      startTime: d.start_time ? String(d.start_time).slice(0, 5) : null,
      endTime: d.end_time ? String(d.end_time).slice(0, 5) : null,
      terms: (d.terms as string) ?? null,
      isBrandWide: d.place_id === null,
      isSample: d.is_sample as boolean,
      paymentMethods: d.payment_methods as string[],
      conditions: d.conditions as string[],
      items: d.items as string[],
      sourceName: (d.source_name as string) ?? null,
      sourceUrl: (d.source_url as string) ?? null,
      proofImageUrl: (d.proof_image_url as string) ?? null,
      confidence: d.display_confidence as ConfidenceLevel,
      verifiedAt: iso(d.verified_at as Date),
      upvotes: d.upvotes as number,
      downvotes: d.downvotes as number,
    })),
  };
}

/** Areas for the location picker and the area filter. */
export async function listAreas(db: Db): Promise<{ id: number; name: string; lat: number | null; lng: number | null }[]> {
  return db.query(
    "select id, name, centroid_lat::float8 as lat, centroid_lng::float8 as lng from areas order by name",
  );
}

/** Drink types and milk alternatives for the filter sheet. */
export async function filterOptions(db: Db) {
  const [drinks, milks] = await Promise.all([
    db.query<{ slug: string; name: string }>("select slug, name from drink_types order by name"),
    db.query<{ slug: string; name: string }>("select slug, name from milk_types where slug <> 'whole' order by name"),
  ]);
  return { drinks, milks };
}

// ---------- helpers ----------

interface RawHours {
  day_of_week: number;
  opens_at: string | null;
  closes_at: string | null;
  is_closed: boolean;
}

function normHours(rows: RawHours[] | null): HoursRow[] {
  return (rows ?? []).map((h) => ({
    day_of_week: h.day_of_week,
    opens_at: h.opens_at ? String(h.opens_at).slice(0, 5) : null,
    closes_at: h.closes_at ? String(h.closes_at).slice(0, 5) : null,
    is_closed: h.is_closed,
  }));
}

function normPick(p: DrinkPick | null): DrinkPick | null {
  if (!p) return null;
  return { ...p, priceVerifiedAt: iso(p.priceVerifiedAt) };
}

function iso(d: Date | string | null | undefined): string {
  if (!d) return "";
  // json_build_object renders timestamptz without the "T"; Date handles both shapes.
  return new Date(d).toISOString();
}

const numOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));
