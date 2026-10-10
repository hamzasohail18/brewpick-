-- Read-side helpers: freshness, confidence decay, v_current_menu, effective_price.

-- ============ FRESHNESS ============
-- Records not re-verified in 30+ days drop one confidence level in the UI (Section 7.4).
create or replace function display_confidence(c confidence_level, verified_at timestamptz, at_time timestamptz default now())
returns confidence_level
language sql immutable as $$
  select case
    when verified_at is not null and at_time - verified_at <= interval '30 days' then c
    when c = 'verified' then 'community_reported'::confidence_level
    else 'estimated'::confidence_level
  end
$$;

create or replace function freshness_bucket(verified_at timestamptz, at_time timestamptz default now())
returns text
language sql immutable as $$
  select case
    when verified_at is null then 'unknown'
    when (verified_at at time zone 'Asia/Karachi')::date = (at_time at time zone 'Asia/Karachi')::date then 'today'
    when at_time - verified_at <= interval '7 days'  then 'this_week'
    when at_time - verified_at <= interval '30 days' then 'this_month'
    else 'over_30_days'
  end
$$;

-- One row per provenance-carrying record, for freshness badges and the monthly data-health report.
create or replace view v_freshness with (security_invoker = true) as
  select 'item_prices'::text as table_name, id as record_id, confidence,
         coalesce(last_verified_at, captured_at) as verified_at
    from item_prices where is_current
  union all
  select 'nutrition_info', id, confidence, coalesce(last_verified_at, captured_at) from nutrition_info
  union all
  select 'bean_info', id, confidence, coalesce(last_verified_at, captured_at) from bean_info
  union all
  select 'deals', id, confidence, coalesce(last_verified_at, captured_at) from deals
  union all
  select 'places', id, confidence, coalesce(last_verified_at, created_at) from places;

create or replace view v_freshness_labeled with (security_invoker = true) as
  select f.*,
         freshness_bucket(f.verified_at) as freshness,
         display_confidence(f.confidence, f.verified_at) as display_confidence
    from v_freshness f;

-- ============ CURRENT MENU ============
-- One row per published place × item × size × channel, with the current price and default-milk nutrition.
-- security_invoker so RLS on the base tables still applies to anon/authenticated callers.
create or replace view v_current_menu with (security_invoker = true) as
select
  p.id                as place_id,
  p.slug              as place_slug,
  p.name              as place_name,
  p.branch_name,
  p.brand_id,
  p.type              as place_type,
  p.area_id,
  p.lat, p.lng,
  p.is_sample         as place_is_sample,
  mi.id               as menu_item_id,
  mi.display_name,
  dt.slug             as drink_type_slug,
  mi.temperature,
  mi.has_milk,
  mi.espresso_shots,
  s.id                as item_size_id,
  s.size_label,
  s.volume_ml,
  s.volume_is_assumed,
  pr.id               as price_id,
  pr.channel,
  pr.price_pkr,
  pr.tax_inclusive,
  pr.source_id        as price_source_id,
  pr.source_url       as price_source_url,
  coalesce(pr.last_verified_at, pr.captured_at) as price_verified_at,
  display_confidence(pr.confidence, coalesce(pr.last_verified_at, pr.captured_at)) as price_confidence,
  n.calories_kcal,
  n.sugar_g,
  n.caffeine_mg,
  n.assumptions       as nutrition_assumptions,
  n.source_id         as nutrition_source_id,
  display_confidence(n.confidence, coalesce(n.last_verified_at, n.captured_at)) as nutrition_confidence,
  -- Weakest of the two, so a card never looks more certain than its shakiest number.
  greatest(
    display_confidence(pr.confidence, coalesce(pr.last_verified_at, pr.captured_at)),
    coalesce(display_confidence(n.confidence, coalesce(n.last_verified_at, n.captured_at)), 'verified')
  )                   as row_confidence,
  case when s.volume_ml > 0 then round(pr.price_pkr * 100.0 / s.volume_ml, 1) end as price_per_100ml,
  case when pr.price_pkr > 0 and n.calories_kcal is not null
       then round(n.calories_kcal::numeric / pr.price_pkr, 3) end                as kcal_per_pkr
from places p
join menu_items mi   on mi.place_id = p.id and mi.status = 'published'
left join drink_types dt on dt.id = mi.drink_type_id
join item_sizes s    on s.menu_item_id = mi.id
join item_prices pr  on pr.item_size_id = s.id and pr.is_current
left join nutrition_info n on n.item_size_id = s.id and n.milk_type_id is null
where p.status = 'published';

-- ============ EFFECTIVE PRICE ============
-- Discount a single deal gives on a single cup at a given base price.
-- BOGO is modelled per cup: two for the price of one = 50% off each (assumption, documented in README).
-- free_item gives nothing off this cup (the free thing is a different item).
create or replace function deal_discount_pkr(
  d_discount discount_kind, d_value numeric, d_cap integer, base_price integer
) returns integer
language sql immutable as $$
  select greatest(0, least(
    base_price,
    coalesce(d_cap, base_price),
    case d_discount
      when 'percent'     then round(base_price * d_value / 100.0)::int
      when 'flat_pkr'    then round(d_value)::int
      when 'fixed_price' then greatest(base_price - round(d_value)::int, 0)
      when 'bogo'        then base_price / 2
      else 0
    end
  ))
$$;

-- Best applicable deal for one size, given the payment methods the user holds.
-- Checks: published + not expired, date window, weekday, time window (handles past-midnight),
-- min spend (single-cup order), item scope, place/brand match, card/app match, channel conditions, cap.
create or replace function effective_price_detail(
  p_item_size_id uuid,
  p_payment_method_ids integer[] default '{}',
  p_at_time timestamptz default now(),
  p_channel price_channel default 'dine_in'
) returns table (
  base_price_pkr integer,
  effective_price_pkr integer,
  discount_pkr integer,
  deal_id uuid,
  deal_title text
)
language sql stable as $$
  with item as (
    select s.id as size_id, mi.id as menu_item_id, p.id as place_id, p.brand_id, pr.price_pkr
      from item_sizes s
      join menu_items mi on mi.id = s.menu_item_id
      join places p      on p.id = mi.place_id
      join item_prices pr on pr.item_size_id = s.id and pr.is_current and pr.channel = p_channel
     where s.id = p_item_size_id
  ),
  local_now as (
    select (p_at_time at time zone 'Asia/Karachi')::date as d,
           (p_at_time at time zone 'Asia/Karachi')::time as t,
           extract(dow from (p_at_time at time zone 'Asia/Karachi'))::smallint as dow
  ),
  candidates as (
    select d.id, d.title,
           deal_discount_pkr(d.discount, d.discount_value, d.max_discount_pkr, i.price_pkr) as off
      from item i
      cross join local_now n
      join deals d on d.status = 'published'
                  and (d.place_id = i.place_id or (d.place_id is null and d.brand_id = i.brand_id))
     where n.d between d.valid_from and d.valid_to
       and (d.days_of_week is null or n.dow = any (d.days_of_week))
       and (d.start_time is null
            or (d.start_time <= d.end_time and n.t >= d.start_time and n.t < d.end_time)
            or (d.start_time >  d.end_time and (n.t >= d.start_time or n.t < d.end_time)))
       and (d.min_spend_pkr is null or i.price_pkr >= d.min_spend_pkr)
       and (d.applies_to_all_items
            or exists (select 1 from deal_items di where di.deal_id = d.id and di.menu_item_id = i.menu_item_id))
       and (not exists (select 1 from deal_payment_methods dpm where dpm.deal_id = d.id)
            or exists (select 1 from deal_payment_methods dpm
                        where dpm.deal_id = d.id and dpm.payment_method_id = any (p_payment_method_ids)))
       and not exists (
            select 1 from deal_conditions dc
             where dc.deal_id = d.id
               and ((dc.condition_key = 'dine_in_only'  and p_channel <> 'dine_in')
                 or (dc.condition_key = 'takeaway_only' and p_channel <> 'takeaway')
                 or (dc.condition_key = 'delivery_only' and p_channel <> 'delivery')))
  ),
  best as (
    select * from candidates where off > 0 order by off desc, id limit 1
  )
  select i.price_pkr,
         i.price_pkr - coalesce(b.off, 0),
         coalesce(b.off, 0),
         b.id,
         b.title
    from item i
    left join best b on true
$$;

-- Spec signature, variant 1: explicit payment method ids. Returns the lowest price (integer PKR).
create or replace function effective_price(
  p_item_size_id uuid,
  p_payment_method_ids integer[] default '{}',
  p_at_time timestamptz default now(),
  p_channel price_channel default 'dine_in'
) returns integer
language sql stable as $$
  select effective_price_pkr from effective_price_detail(p_item_size_id, p_payment_method_ids, p_at_time, p_channel)
$$;

-- Spec signature, variant 2: look up the user's saved cards/apps.
create or replace function effective_price(
  p_item_size_id uuid,
  p_user_id uuid,
  p_at_time timestamptz default now(),
  p_channel price_channel default 'dine_in'
) returns integer
language sql stable as $$
  select effective_price(
    p_item_size_id,
    coalesce((select array_agg(payment_method_id) from user_payment_methods where user_id = p_user_id), '{}'),
    p_at_time,
    p_channel)
$$;
