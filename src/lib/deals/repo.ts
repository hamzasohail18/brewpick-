// Live deals for public screens. Run as ANON: RLS (deal_is_public) already hides drafts and expired
// deals; the date checks here repeat that so the same query is safe for any caller.

import type { Db } from "@/lib/db/core";
import type { ConfidenceLevel } from "@/lib/domain/sources";
import type { DealRule } from "./engine";

export interface DealPlace {
  id: string;
  slug: string;
  name: string;
  branchName: string | null;
  areaName: string | null;
  lat: number;
  lng: number;
  isSample: boolean;
}

/** Everything a deal card shows, plus the rule the effective-price engine evaluates. */
export interface DealView extends DealRule {
  dealType: string;
  terms: string | null;
  isBrandWide: boolean;
  brandName: string | null;
  isSample: boolean;
  /** Names, in the same order as paymentMethodIds. */
  paymentMethods: string[];
  items: string[];
  sourceName: string | null;
  sourceUrl: string | null;
  proofImageUrl: string | null;
  confidence: ConfidenceLevel;
  verifiedAt: string;
  upvotes: number;
  downvotes: number;
  /** The place, or every published branch of the brand for a brand-wide deal. */
  places: DealPlace[];
}

const TODAY = "(now() at time zone 'Asia/Karachi')::date";

/**
 * Deals that are live today. With `placeIds`, only deals that apply at those places (their own and
 * brand-wide ones); otherwise all of them, for the Deals screen.
 */
export async function loadDeals(db: Db, opts: { placeIds?: string[] } = {}): Promise<DealView[]> {
  const params: unknown[] = [];
  let scope = "";
  if (opts.placeIds) {
    if (opts.placeIds.length === 0) return [];
    params.push(opts.placeIds);
    scope = `and (d.place_id = any ($1::uuid[])
               or (d.place_id is null and d.brand_id in (select brand_id from places where id = any ($1::uuid[]) and brand_id is not null)))`;
  }
  const rows = await db.query<Record<string, unknown>>(
    `select d.id, d.title, d.place_id, d.brand_id, d.deal_type, d.discount, d.discount_value::float8 as discount_value,
            d.max_discount_pkr, d.min_spend_pkr,
            to_char(d.valid_from, 'YYYY-MM-DD') as valid_from, to_char(d.valid_to, 'YYYY-MM-DD') as valid_to,
            d.days_of_week, left(d.start_time::text, 5) as start_time, left(d.end_time::text, 5) as end_time,
            d.terms, d.applies_to_all_items, d.is_sample, d.source_url, d.proof_image_url, d.upvotes, d.downvotes,
            display_confidence(d.confidence, coalesce(d.last_verified_at, d.captured_at)) as confidence,
            coalesce(d.last_verified_at, d.captured_at) as verified_at,
            sl.name as source_name, b.name as brand_name,
            array(select di.menu_item_id::text from deal_items di where di.deal_id = d.id order by 1) as item_ids,
            array(select mi.display_name from deal_items di join menu_items mi on mi.id = di.menu_item_id
                   where di.deal_id = d.id order by mi.display_name) as items,
            -- ids and names in the same order, so paymentMethods[i] names paymentMethodIds[i]
            array(select pm.id from deal_payment_methods dpm join payment_methods pm on pm.id = dpm.payment_method_id
                   where dpm.deal_id = d.id order by pm.name, pm.id) as payment_method_ids,
            array(select pm.name from deal_payment_methods dpm join payment_methods pm on pm.id = dpm.payment_method_id
                   where dpm.deal_id = d.id order by pm.name, pm.id) as payment_methods,
            array(select dc.condition_key from deal_conditions dc where dc.deal_id = d.id order by dc.id) as conditions,
            (select coalesce(json_agg(json_build_object('id', p.id, 'slug', p.slug, 'name', p.name, 'branchName', p.branch_name,
                                                        'areaName', a.name, 'lat', p.lat::float8, 'lng', p.lng::float8,
                                                        'isSample', p.is_sample) order by p.name, p.branch_name), '[]'::json)
               from places p left join areas a on a.id = p.area_id
              where p.status = 'published' and (p.id = d.place_id or (d.place_id is null and p.brand_id = d.brand_id))) as places
       from deals d
       left join v_source_labels sl on sl.id = d.source_id
       left join brands b on b.id = d.brand_id
      where d.status = 'published' and d.valid_from <= ${TODAY} and d.valid_to >= ${TODAY} ${scope}
      order by d.valid_to, d.title, d.id`,
    params,
  );
  return rows
    .map((d) => ({
      id: d.id as string,
      title: d.title as string,
      placeId: (d.place_id as string) ?? null,
      brandId: (d.brand_id as string) ?? null,
      dealType: d.deal_type as string,
      discount: d.discount as DealRule["discount"],
      discountValue: (d.discount_value as number) ?? null,
      maxDiscountPkr: (d.max_discount_pkr as number) ?? null,
      minSpendPkr: (d.min_spend_pkr as number) ?? null,
      validFrom: d.valid_from as string,
      validTo: d.valid_to as string,
      daysOfWeek: (d.days_of_week as number[]) ?? null,
      startTime: (d.start_time as string) ?? null,
      endTime: (d.end_time as string) ?? null,
      appliesToAllItems: d.applies_to_all_items as boolean,
      itemIds: d.item_ids as string[],
      paymentMethodIds: d.payment_method_ids as number[],
      conditions: d.conditions as string[],
      terms: (d.terms as string) ?? null,
      isBrandWide: d.place_id === null,
      brandName: (d.brand_name as string) ?? null,
      isSample: d.is_sample as boolean,
      paymentMethods: d.payment_methods as string[],
      items: d.items as string[],
      sourceName: (d.source_name as string) ?? null,
      sourceUrl: (d.source_url as string) ?? null,
      proofImageUrl: (d.proof_image_url as string) ?? null,
      confidence: d.confidence as ConfidenceLevel,
      verifiedAt: new Date(d.verified_at as Date).toISOString(),
      upvotes: d.upvotes as number,
      downvotes: d.downvotes as number,
      places: d.places as DealPlace[],
    }))
    .filter((d) => d.places.length > 0); // a deal whose only place is unpublished isn't shown
}

/** Strip display fields: what list screens ship to the phone for effective prices. */
export function toRule(d: DealView): DealRule {
  return {
    id: d.id,
    title: d.title,
    placeId: d.placeId,
    brandId: d.brandId,
    discount: d.discount,
    discountValue: d.discountValue,
    maxDiscountPkr: d.maxDiscountPkr,
    minSpendPkr: d.minSpendPkr,
    validFrom: d.validFrom,
    validTo: d.validTo,
    daysOfWeek: d.daysOfWeek,
    startTime: d.startTime,
    endTime: d.endTime,
    appliesToAllItems: d.appliesToAllItems,
    itemIds: d.itemIds,
    paymentMethodIds: d.paymentMethodIds,
    conditions: d.conditions,
  };
}

export interface PaymentMethod {
  id: number;
  kind: "bank_card" | "wallet" | "delivery_app" | "loyalty_program";
  name: string;
  tier: string | null;
}

export async function listPaymentMethods(db: Db): Promise<PaymentMethod[]> {
  return db.query<PaymentMethod>(
    `select id, kind, name, tier from payment_methods
      order by array_position(array['bank_card','wallet','delivery_app','loyalty_program'], kind), name, tier nulls first`,
  );
}
