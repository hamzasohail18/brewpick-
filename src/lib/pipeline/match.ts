// Finds the live row a staged record refers to, and a stable key for "the same real-world thing".

import type { Db } from "@/lib/db/core";
import type { Flat } from "./diff";
import { normName } from "./normalize";
import type { BeanRecord, DealRecord, NutritionRecord, PlaceRecord, PriceRecord, StagedRecord } from "./records";

export interface Match {
  matchKey: string;
  targetId: string | null;
  current: Flat | null;
}

export async function findCurrent(tx: Db, r: StagedRecord): Promise<Match> {
  switch (r.kind) {
    case "item_price":
      return matchPrice(tx, r);
    case "place":
      return matchPlace(tx, r);
    case "nutrition":
      return matchNutrition(tx, r);
    case "deal":
      return matchDeal(tx, r);
    case "bean":
      return matchBean(tx, r);
  }
}

export interface LivePriceRow {
  price_id: string;
  menu_item_id: string;
  item_size_id: string;
  display_name: string;
  size_label: string;
  volume_ml: number | null;
  price_pkr: number;
  tax_inclusive: boolean | null;
}

/** Every current, non-archived price at a place for one channel. */
export async function livePrices(tx: Db, placeId: string, channel: string): Promise<LivePriceRow[]> {
  return tx.query<LivePriceRow>(
    `select pr.id as price_id, mi.id as menu_item_id, s.id as item_size_id, mi.display_name, s.size_label,
            s.volume_ml, pr.price_pkr, pr.tax_inclusive
       from item_prices pr
       join item_sizes s  on s.id = pr.item_size_id
       join menu_items mi on mi.id = s.menu_item_id
      where mi.place_id = $1 and pr.channel = $2 and pr.is_current and mi.status <> 'archived'`,
    [placeId, channel],
  );
}

export const priceKey = (placeId: string, item: string, size: string, channel: string) =>
  `price:${placeId}:${normName(item)}:${normName(size)}:${channel}`;

async function matchPrice(tx: Db, r: PriceRecord): Promise<Match> {
  const matchKey = priceKey(r.place_id, r.item.display_name, r.size.size_label, r.channel);
  const row = (await livePrices(tx, r.place_id, r.channel)).find(
    (p) => normName(p.display_name) === normName(r.item.display_name) && normName(p.size_label) === normName(r.size.size_label),
  );
  if (!row) return { matchKey, targetId: null, current: null };
  return {
    matchKey,
    targetId: row.price_id,
    current: {
      price_pkr: row.price_pkr,
      tax_inclusive: row.tax_inclusive,
      volume_ml: row.volume_ml,
      display_name: row.display_name,
      size_label: row.size_label,
    },
  };
}

const PLACE_COLUMNS =
  "id, name, branch_name, type, address, lat, lng, phone, website_url, instagram_handle, halal_certified, has_wifi, has_family_seating, has_drive_thru, osm_id, google_place_id";

async function matchPlace(tx: Db, r: PlaceRecord): Promise<Match> {
  const matchKey = r.osm_id
    ? `place:osm:${r.osm_id}`
    : r.google_place_id
      ? `place:google:${r.google_place_id}`
      : `place:name:${normName(r.name)}:${normName(r.branch_name ?? "")}:${r.lat.toFixed(3)},${r.lng.toFixed(3)}`;

  let [row] = await tx.query<Flat & { id: string }>(
    `select ${PLACE_COLUMNS} from places
      where ($1::text is not null and osm_id = $1) or ($2::text is not null and google_place_id = $2)
      limit 1`,
    [r.osm_id, r.google_place_id],
  );
  if (!row) {
    // Same name within ~150 m counts as the same place (branches of a chain differ in location).
    const near = await tx.query<Flat & { id: string }>(
      `select ${PLACE_COLUMNS} from places
        where abs(lat - $1) < 0.0015 and abs(lng - $2) < 0.0015 and status <> 'archived'`,
      [r.lat, r.lng],
    );
    row = near.find((p) => normName(String(p.name)) === normName(r.name))!;
  }
  if (!row) return { matchKey, targetId: null, current: null };
  return { matchKey, targetId: row.id, current: { ...row, lat: Number(row.lat), lng: Number(row.lng) } };
}

/** Resolve place + item display name + size label to an item_sizes row. */
export async function findItemSize(tx: Db, placeId: string, itemName: string, sizeLabel: string) {
  const rows = await tx.query<{ item_size_id: string; menu_item_id: string; display_name: string; size_label: string }>(
    `select s.id as item_size_id, mi.id as menu_item_id, mi.display_name, s.size_label
       from item_sizes s join menu_items mi on mi.id = s.menu_item_id
      where mi.place_id = $1 and mi.status <> 'archived'`,
    [placeId],
  );
  return rows.find((x) => normName(x.display_name) === normName(itemName) && normName(x.size_label) === normName(sizeLabel)) ?? null;
}

async function matchNutrition(tx: Db, r: NutritionRecord): Promise<Match> {
  const matchKey = `nutrition:${r.place_id}:${normName(r.item_display_name)}:${normName(r.size_label)}:${r.milk_type_slug ?? "default"}`;
  const size = await findItemSize(tx, r.place_id, r.item_display_name, r.size_label);
  if (!size) return { matchKey, targetId: null, current: null };
  const [row] = await tx.query<Flat & { id: string }>(
    `select n.id, n.calories_kcal, n.sugar_g, n.caffeine_mg, n.fat_g, n.protein_g, n.assumptions
       from nutrition_info n left join milk_types m on m.id = n.milk_type_id
      where n.item_size_id = $1 and m.slug is not distinct from $2`,
    [size.item_size_id, r.milk_type_slug],
  );
  return row ? { matchKey, targetId: row.id, current: row } : { matchKey, targetId: null, current: null };
}

async function matchDeal(tx: Db, r: DealRecord): Promise<Match> {
  const owner = r.place_id ?? `brand:${r.brand_id}`;
  const matchKey = `deal:${owner}:${normName(r.title)}`;
  const rows = await tx.query<Flat & { id: string; title: string }>(
    `select d.id, d.title, d.deal_type, d.discount, d.discount_value, d.max_discount_pkr, d.min_spend_pkr,
            to_char(d.valid_from, 'YYYY-MM-DD') as valid_from, to_char(d.valid_to, 'YYYY-MM-DD') as valid_to,
            d.days_of_week, to_char(d.start_time, 'HH24:MI') as start_time, to_char(d.end_time, 'HH24:MI') as end_time,
            coalesce((select array_agg(pm.name order by pm.name) from deal_payment_methods dpm
                       join payment_methods pm on pm.id = dpm.payment_method_id where dpm.deal_id = d.id), '{}') as payment_methods,
            coalesce((select array_agg(mi.display_name order by mi.display_name) from deal_items di
                       join menu_items mi on mi.id = di.menu_item_id where di.deal_id = d.id), '{}') as item_names,
            coalesce((select array_agg(dc.condition_key order by dc.condition_key) from deal_conditions dc
                       where dc.deal_id = d.id), '{}') as conditions
       from deals d
      where d.status <> 'archived'
        and (($1::uuid is not null and d.place_id = $1) or ($1::uuid is null and d.place_id is null and d.brand_id = $2))`,
    [r.place_id, r.brand_id],
  );
  const row = rows.find((d) => normName(d.title) === normName(r.title));
  return row ? { matchKey, targetId: row.id, current: row } : { matchKey, targetId: null, current: null };
}

async function matchBean(tx: Db, r: BeanRecord): Promise<Match> {
  const matchKey = `bean:${r.place_id}:${normName(r.item_display_name ?? "house")}`;
  const rows = await tx.query<Flat & { id: string; item_name: string | null }>(
    `select b.id, b.kind as bean_kind, b.origin_country, b.origin_region, b.roaster, b.roast, b.arabica_pct, b.robusta_pct,
            mi.display_name as item_name
       from bean_info b left join menu_items mi on mi.id = b.menu_item_id
      where b.place_id = $1`,
    [r.place_id],
  );
  const want = r.item_display_name ? normName(r.item_display_name) : null;
  const row = rows.find((b) => (b.item_name ? normName(b.item_name) : null) === want);
  return row ? { matchKey, targetId: row.id, current: row } : { matchKey, targetId: null, current: null };
}
