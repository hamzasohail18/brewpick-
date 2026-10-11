// Candidate drinks for "Pick for me". The server narrows by drink style and a loose price ceiling;
// the phone then applies the user's cards, location and goal (src/lib/scoring/engine.ts).

import type { Db } from "@/lib/db/core";
import type { DealRule } from "@/lib/deals/engine";
import { loadDeals, toRule } from "@/lib/deals/repo";
import type { Candidate, Style } from "./engine";

/**
 * Deals can take at most half off a cup in practice (BOGO = 50%), so a drink up to twice the budget
 * might still fit after deals. Anything pricier can't, and isn't sent.
 */
export const BUDGET_HEADROOM = 2;

export async function loadCandidates(db: Db, opts: { style: Style; budgetMax: number | null }): Promise<{ candidates: Candidate[]; deals: DealRule[] }> {
  const where = ["m.channel <> 'delivery'"];
  const params: unknown[] = [];
  if (opts.style !== "any") {
    const [temp, milk] = opts.style.split("-");
    params.push(temp);
    where.push(`m.temperature in ($${params.length}::temperature, 'both')`);
    where.push(milk === "milk" ? "m.has_milk = true" : "m.has_milk = false");
  }
  if (opts.budgetMax !== null) {
    params.push(opts.budgetMax * BUDGET_HEADROOM);
    where.push(`m.price_pkr <= $${params.length}`);
  }
  const rows = await db.query<Record<string, unknown>>(
    `select distinct on (m.item_size_id)
            m.item_size_id, m.menu_item_id, m.place_id, m.brand_id, m.place_slug, m.place_name, m.branch_name, a.name as area_name,
            m.lat::float8 as lat, m.lng::float8 as lng, m.place_is_sample, p.rating_avg::float8 as rating, coalesce(p.rating_count, 0) as rating_count,
            p.source_id is not null as place_sourced,
            (select coalesce(json_agg(json_build_object('day_of_week', h.day_of_week, 'opens_at', left(h.opens_at::text, 5),
                      'closes_at', left(h.closes_at::text, 5), 'is_closed', h.is_closed) order by h.day_of_week), '[]'::json)
               from place_hours h where h.place_id = m.place_id) as hours,
            m.display_name, m.drink_type_slug, m.size_label, m.volume_ml, m.temperature, m.has_milk, m.channel, m.price_pkr,
            m.price_confidence, m.price_verified_at, m.price_source_id is not null as price_sourced,
            m.calories_kcal, m.sugar_g::float8 as sugar_g, m.caffeine_mg, m.nutrition_confidence, m.nutrition_source_id is not null as nutrition_sourced,
            b.kind as bean_kind, b.roast as bean_roast, b.arabica_pct, b.origin_country, b.source_id is not null as bean_sourced, b.id is not null as has_beans
       from v_current_menu m
       join places p on p.id = m.place_id
       left join areas a on a.id = p.area_id
       left join lateral (
         select * from bean_info bi where bi.place_id = m.place_id and (bi.menu_item_id = m.menu_item_id or bi.menu_item_id is null)
          order by bi.menu_item_id nulls last limit 1
       ) b on true
      where ${where.join(" and ")}
      order by m.item_size_id, m.channel`,
    params,
  );
  const candidates: Candidate[] = rows.map((r) => ({
    sizeId: r.item_size_id as string,
    menuItemId: r.menu_item_id as string,
    placeId: r.place_id as string,
    brandId: (r.brand_id as string) ?? null,
    placeSlug: r.place_slug as string,
    placeName: r.place_name as string,
    branchName: (r.branch_name as string) ?? null,
    areaName: (r.area_name as string) ?? null,
    lat: r.lat as number,
    lng: r.lng as number,
    isSample: r.place_is_sample as boolean,
    rating: (r.rating as number) ?? null,
    ratingCount: r.rating_count as number,
    placeSourced: r.place_sourced as boolean,
    hours: r.hours as Candidate["hours"],
    drinkName: r.display_name as string,
    drinkType: (r.drink_type_slug as string) ?? null,
    size: r.size_label as string,
    volumeMl: (r.volume_ml as number) ?? null,
    temperature: r.temperature as Candidate["temperature"],
    hasMilk: (r.has_milk as boolean) ?? null,
    channel: r.channel as Candidate["channel"],
    pricePkr: r.price_pkr as number,
    priceConfidence: r.price_confidence as Candidate["priceConfidence"],
    priceVerifiedAt: new Date(r.price_verified_at as Date).toISOString(),
    priceSourced: r.price_sourced as boolean,
    kcal: (r.calories_kcal as number) ?? null,
    sugarG: (r.sugar_g as number) ?? null,
    caffeineMg: (r.caffeine_mg as number) ?? null,
    nutritionConfidence: (r.nutrition_confidence as Candidate["nutritionConfidence"]) ?? null,
    nutritionSourced: r.nutrition_sourced as boolean,
    beans: r.has_beans
      ? {
          kind: (r.bean_kind as "single_origin" | "blend") ?? null,
          roast: (r.bean_roast as string) ?? null,
          arabicaPct: (r.arabica_pct as number) ?? null,
          origin: (r.origin_country as string) ?? null,
          sourced: r.bean_sourced as boolean,
        }
      : null,
  }));
  const placeIds = [...new Set(candidates.map((c) => c.placeId))];
  const deals = (await loadDeals(db, { placeIds })).map(toRule);
  return { candidates, deals };
}
