-- BrewPick Lahore: core schema (Section 6 of the master spec).
-- Conventions: money = integer PKR, volumes = ml, times = timestamptz (displayed in Asia/Karachi).
-- Every price / nutrition / bean / deal row carries provenance (source_id, source_url, confidence,
-- captured_at, last_verified_at). Scraped data never lands here directly; it goes through staging_records.


-- ============ ENUMS ============
create type confidence_level as enum ('verified', 'community_reported', 'estimated');  -- order matters: strongest first
create type place_type as enum ('specialty_cafe', 'chain', 'kiosk_drive_thru', 'bakery_cafe');
create type roast_level as enum ('light', 'medium_light', 'medium', 'medium_dark', 'dark');
create type bean_kind as enum ('single_origin', 'blend');
create type temperature as enum ('hot', 'iced', 'both');
create type price_channel as enum ('dine_in', 'takeaway', 'delivery');
create type deal_type as enum ('bank_card', 'delivery_app', 'loyalty', 'happy_hour', 'combo', 'student', 'other');
create type discount_kind as enum ('percent', 'flat_pkr', 'bogo', 'fixed_price', 'free_item');
create type record_status as enum ('draft', 'pending_review', 'published', 'rejected', 'archived');
create type submission_type as enum ('price_correction', 'new_item', 'new_deal', 'new_place', 'hours_correction', 'other');
create type source_kind as enum (
  'open_data_api', 'official_api', 'cafe_website', 'cafe_menu_file', 'bank_offer_page',
  'social_official_api', 'social_manual', 'delivery_app_manual', 'field_capture',
  'owner_portal', 'community_submission', 'reference_dataset', 'manual_admin'
);
create type automation_status as enum ('allowed', 'allowed_with_conditions', 'not_allowed', 'unknown_review_required');
create type run_status as enum ('queued', 'running', 'succeeded', 'failed', 'partial');
create type staging_action as enum ('create', 'update', 'delete', 'reconfirm');

-- Shared trigger to keep updated_at honest.
create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ============ REFERENCE ============
create table areas (
  id serial primary key,
  name text not null unique,
  name_ur text,
  centroid_lat numeric(9,6),
  centroid_lng numeric(9,6)
);

create table allergens (
  id serial primary key,
  code text not null unique,
  name text not null,
  name_ur text
);

create table ingredients (
  id serial primary key,
  name text not null unique,
  name_ur text,
  is_dairy boolean not null default false,
  is_vegan boolean not null default false
);

create table drink_types (                -- canonical taxonomy so "Cafe Latte" == "Latte"
  id serial primary key,
  slug text not null unique,
  name text not null,
  name_ur text,
  default_temperature temperature not null default 'hot',
  default_espresso_shots smallint,
  aliases text[] not null default '{}'    -- lowercase; used by the normalizer
);

create table milk_types (
  id serial primary key,
  slug text not null unique,
  name text not null,
  is_dairy boolean not null default false,
  kcal_per_100ml numeric(6,1),            -- reference estimate; source in notes
  notes text
);

create table payment_methods (
  id serial primary key,
  kind text not null check (kind in ('bank_card', 'wallet', 'delivery_app', 'loyalty_program')),
  name text not null,
  tier text,
  unique nulls not distinct (kind, name, tier)   -- tier is usually null; treat nulls as equal
);

-- Added: the spec references brand_id on places/deals without a table. Groups branches of one chain.
create table brands (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  website_url text,
  instagram_handle text,
  is_sample boolean not null default false,
  created_at timestamptz not null default now()
);

-- ============ SOURCE REGISTRY (Section 8) ============
create table sources (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  kind source_kind not null,
  base_url text,
  place_id uuid,                          -- FK added after places exists
  automation automation_status not null default 'unknown_review_required',
  automation_notes text,
  tos_url text,
  robots_checked_at timestamptz,
  license text,
  attribution_required boolean not null default false,
  attribution_text text,
  cache_allowed boolean not null default true,
  max_cache_days integer,
  rate_limit_seconds numeric(5,1) not null default 5 check (rate_limit_seconds >= 1),
  user_agent text,
  default_confidence confidence_level not null default 'community_reported',
  check_interval_days integer not null default 14 check (check_interval_days > 0),
  last_checked_at timestamptz,
  next_check_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Section 8.3: a source can only be opened up for automation once it has actually been reviewed.
  constraint sources_reviewed_before_automation check (
    automation not in ('allowed', 'allowed_with_conditions')
    or kind in ('social_manual', 'delivery_app_manual', 'field_capture', 'owner_portal',
                'community_submission', 'manual_admin')          -- human-entry sources: nothing to crawl
    or (automation_notes is not null and robots_checked_at is not null)
  )
);
create index on sources (next_check_at) where is_active;
create index on sources (place_id);
create trigger sources_updated_at before update on sources for each row execute function set_updated_at();

-- ============ PLACES ============
create table places (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  branch_name text,
  brand_id uuid references brands(id) on delete set null,
  type place_type not null,
  area_id integer references areas(id),
  address text,
  lat numeric(9,6) not null check (lat between -90 and 90),
  lng numeric(9,6) not null check (lng between -180 and 180),
  phone text,
  website_url text,
  instagram_handle text,
  osm_id text unique,
  google_place_id text unique,
  halal_certified boolean,
  has_wifi boolean,
  has_family_seating boolean,
  has_drive_thru boolean,
  rating_avg numeric(2,1) check (rating_avg between 0 and 5),
  rating_count integer default 0,
  status record_status not null default 'draft',
  is_sample boolean not null default false,
  claimed_by uuid,
  source_id uuid references sources(id),
  confidence confidence_level not null default 'community_reported',
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on places (area_id);
create index on places (status);
create index on places (brand_id);
create index on places (source_id);
create index on places (claimed_by);
create index places_geo_idx on places (lat, lng);
create trigger places_updated_at before update on places for each row execute function set_updated_at();

alter table sources add constraint sources_place_fk foreign key (place_id) references places(id) on delete cascade;

create table place_hours (
  id bigserial primary key,
  place_id uuid not null references places(id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6),   -- 0 = Sunday
  opens_at time,
  closes_at time,                         -- may be < opens_at for after-midnight closing
  is_closed boolean not null default false,
  unique (place_id, day_of_week),
  check (is_closed or (opens_at is not null and closes_at is not null))
);

-- ============ MENU ============
create table menu_items (
  id uuid primary key default gen_random_uuid(),
  place_id uuid not null references places(id) on delete cascade,
  drink_type_id integer references drink_types(id),
  display_name text not null,
  description text,
  temperature temperature not null default 'hot',
  espresso_shots smallint check (espresso_shots between 0 and 8),
  has_milk boolean,
  is_vegan_possible boolean,
  photo_url text,
  status record_status not null default 'draft',
  is_sample boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on menu_items (place_id);
create index on menu_items (drink_type_id);
create trigger menu_items_updated_at before update on menu_items for each row execute function set_updated_at();

create table item_sizes (
  id uuid primary key default gen_random_uuid(),
  menu_item_id uuid not null references menu_items(id) on delete cascade,
  size_label text not null,
  volume_ml integer check (volume_ml between 15 and 2000),
  volume_is_assumed boolean not null default false,   -- true when the normalizer applied S240/M350/L470
  unique (menu_item_id, size_label)
);

create table item_prices (
  id uuid primary key default gen_random_uuid(),
  item_size_id uuid not null references item_sizes(id) on delete cascade,
  channel price_channel not null default 'dine_in',
  price_pkr integer not null check (price_pkr between 50 and 5000),
  tax_inclusive boolean,                  -- null = unknown
  is_current boolean not null default true,
  source_id uuid references sources(id),
  source_url text,
  proof_image_url text,
  confidence confidence_level not null default 'community_reported',
  captured_at timestamptz not null default now(),
  last_verified_at timestamptz,
  superseded_at timestamptz,
  check (is_current or superseded_at is not null)
);
create unique index item_prices_one_current on item_prices (item_size_id, channel) where is_current;
create index on item_prices (item_size_id);
create index on item_prices (source_id);
create index on item_prices (last_verified_at);

create table nutrition_info (
  id uuid primary key default gen_random_uuid(),
  item_size_id uuid not null references item_sizes(id) on delete cascade,
  milk_type_id integer references milk_types(id),     -- null = default milk of the drink
  calories_kcal integer check (calories_kcal between 0 and 2500),
  sugar_g numeric(5,1) check (sugar_g >= 0),
  caffeine_mg integer check (caffeine_mg between 0 and 1000),
  fat_g numeric(5,1) check (fat_g >= 0),
  protein_g numeric(5,1) check (protein_g >= 0),
  assumptions text,
  source_id uuid references sources(id),
  source_url text,
  confidence confidence_level not null default 'estimated',
  captured_at timestamptz not null default now(),
  last_verified_at timestamptz,
  check (confidence <> 'estimated' or assumptions is not null)
);
create unique index nutrition_one_per_milk on nutrition_info (item_size_id, coalesce(milk_type_id, 0));
create index on nutrition_info (item_size_id);
create index on nutrition_info (milk_type_id);
create index on nutrition_info (source_id);

create table item_milk_options (
  menu_item_id uuid not null references menu_items(id) on delete cascade,
  milk_type_id integer not null references milk_types(id),
  extra_price_pkr integer not null default 0 check (extra_price_pkr >= 0),
  extra_kcal integer,
  primary key (menu_item_id, milk_type_id)
);
create index on item_milk_options (milk_type_id);

create table item_ingredients (
  menu_item_id uuid not null references menu_items(id) on delete cascade,
  ingredient_id integer not null references ingredients(id),
  quantity_note text,
  primary key (menu_item_id, ingredient_id)
);
create index on item_ingredients (ingredient_id);

create table item_allergens (
  menu_item_id uuid not null references menu_items(id) on delete cascade,
  allergen_id integer not null references allergens(id),
  confidence confidence_level not null default 'estimated',
  primary key (menu_item_id, allergen_id)
);
create index on item_allergens (allergen_id);

create table bean_info (
  id uuid primary key default gen_random_uuid(),
  place_id uuid not null references places(id) on delete cascade,
  menu_item_id uuid references menu_items(id) on delete set null,  -- null = house beans
  kind bean_kind,
  origin_country text,
  origin_region text,
  roaster text,
  roast roast_level,
  arabica_pct smallint check (arabica_pct between 0 and 100),
  robusta_pct smallint check (robusta_pct between 0 and 100),
  tasting_notes text,
  source_id uuid references sources(id),
  source_url text,
  confidence confidence_level not null default 'community_reported',
  captured_at timestamptz not null default now(),
  last_verified_at timestamptz,
  check (coalesce(arabica_pct, 0) + coalesce(robusta_pct, 0) <= 100)
);
create index on bean_info (place_id);
create index on bean_info (menu_item_id);
create index on bean_info (source_id);

-- ============ DEALS ============
create table deals (
  id uuid primary key default gen_random_uuid(),
  place_id uuid references places(id) on delete cascade,   -- null = applies across a brand
  brand_id uuid references brands(id) on delete cascade,
  title text not null,
  deal_type deal_type not null,
  discount discount_kind not null,
  discount_value numeric(8,2) check (discount_value >= 0),
  max_discount_pkr integer check (max_discount_pkr >= 0),
  min_spend_pkr integer check (min_spend_pkr >= 0),
  valid_from date not null,
  valid_to date not null,
  days_of_week smallint[],                -- 0 = Sunday; null = every day
  start_time time,                        -- local (Asia/Karachi); end < start means past midnight
  end_time time,
  terms text,
  applies_to_all_items boolean not null default true,
  status record_status not null default 'pending_review',
  is_sample boolean not null default false,
  source_id uuid references sources(id),
  source_url text,
  proof_image_url text,
  confidence confidence_level not null default 'community_reported',
  upvotes integer not null default 0,
  downvotes integer not null default 0,
  captured_at timestamptz not null default now(),
  last_verified_at timestamptz,
  check (valid_to >= valid_from),
  check (place_id is not null or brand_id is not null),
  check (discount <> 'percent' or discount_value between 0 and 100),
  check (days_of_week is null or days_of_week <@ array[0,1,2,3,4,5,6]::smallint[]),
  check ((start_time is null) = (end_time is null)),
  check (source_url is not null or proof_image_url is not null or status <> 'published')
);
create index on deals (valid_to) where status = 'published';
create index on deals (place_id);
create index on deals (brand_id);
create index on deals (source_id);

create table deal_items (
  deal_id uuid not null references deals(id) on delete cascade,
  menu_item_id uuid not null references menu_items(id) on delete cascade,
  primary key (deal_id, menu_item_id)
);
create index on deal_items (menu_item_id);

create table deal_payment_methods (       -- which cards/apps unlock the deal; none = open to everyone
  deal_id uuid not null references deals(id) on delete cascade,
  payment_method_id integer not null references payment_methods(id),
  primary key (deal_id, payment_method_id)
);
create index on deal_payment_methods (payment_method_id);

create table deal_conditions (
  id bigserial primary key,
  deal_id uuid not null references deals(id) on delete cascade,
  condition_key text not null,            -- 'dine_in_only', 'takeaway_only', 'delivery_only', 'new_customers_only', ...
  condition_value text
);
create index on deal_conditions (deal_id);

-- ============ USERS ============
create table user_profiles (
  id uuid primary key,                    -- = auth.users.id
  display_name text,
  language text not null default 'en' check (language in ('en', 'ur')),
  default_area_id integer references areas(id),
  default_budget_pkr integer check (default_budget_pkr > 0),
  dietary_flags text[] default '{}',
  created_at timestamptz not null default now()
);
create index on user_profiles (default_area_id);

create table user_payment_methods (       -- bank/app name only; NEVER card numbers
  user_id uuid not null references user_profiles(id) on delete cascade,
  payment_method_id integer not null references payment_methods(id),
  primary key (user_id, payment_method_id)
);
create index on user_payment_methods (payment_method_id);

create table favorites (
  user_id uuid not null references user_profiles(id) on delete cascade,
  place_id uuid not null references places(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, place_id)
);
create index on favorites (place_id);

-- ============ COMMUNITY ============
create table submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references user_profiles(id) on delete set null,
  type submission_type not null,
  place_id uuid references places(id) on delete set null,
  payload jsonb not null,
  proof_image_url text,
  note text,
  status record_status not null default 'pending_review',
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  check (type not in ('price_correction', 'new_deal') or proof_image_url is not null)
);
create index on submissions (user_id);
create index on submissions (place_id);
create index on submissions (status, created_at);

create table deal_votes (
  deal_id uuid not null references deals(id) on delete cascade,
  user_id uuid not null references user_profiles(id) on delete cascade,
  is_accurate boolean not null,
  created_at timestamptz not null default now(),
  primary key (deal_id, user_id)
);
create index on deal_votes (user_id);

create table reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references user_profiles(id) on delete set null,
  target_table text not null,
  target_id uuid not null,
  reason text not null,
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  created_at timestamptz not null default now()
);
create index on reports (user_id);
create index on reports (target_table, target_id);

create table place_claims (
  id uuid primary key default gen_random_uuid(),
  place_id uuid not null references places(id) on delete cascade,
  user_id uuid not null references user_profiles(id) on delete cascade,
  verification_method text check (verification_method in ('phone_call', 'business_email', 'document')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index on place_claims (place_id);
create index on place_claims (user_id);

-- ============ DATA PIPELINE ============
create table source_runs (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references sources(id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status run_status not null default 'queued',
  records_found integer default 0,
  records_staged integer default 0,
  error_message text,
  raw_snapshot_url text
);
create index on source_runs (source_id, started_at desc);

create table staging_records (
  id uuid primary key default gen_random_uuid(),
  source_run_id uuid references source_runs(id) on delete set null,
  source_id uuid not null references sources(id),
  target_table text not null,
  target_id uuid,
  action staging_action not null,
  proposed jsonb not null,
  current jsonb,
  diff jsonb,
  flags text[] default '{}',
  evidence_url text,
  status record_status not null default 'pending_review',
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  check (action = 'create' or target_id is not null)
);
create index on staging_records (status, created_at);
create index on staging_records (source_run_id);
create index on staging_records (source_id);

create table audit_log (
  id bigserial primary key,
  actor_id uuid,
  actor_kind text not null check (actor_kind in ('admin', 'bot', 'owner', 'community')),
  table_name text not null,
  record_id uuid not null,
  action text not null,
  old_values jsonb,
  new_values jsonb,
  source_id uuid references sources(id),
  created_at timestamptz not null default now()
);
create index on audit_log (table_name, record_id);
create index on audit_log (source_id);
create index on audit_log (created_at desc);

-- Keep deal vote tallies in sync (votes are written by users; tallies are read publicly).
create or replace function sync_deal_vote_counts() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  d uuid := coalesce(new.deal_id, old.deal_id);
begin
  update deals set
    upvotes   = (select count(*) from deal_votes where deal_id = d and is_accurate),
    downvotes = (select count(*) from deal_votes where deal_id = d and not is_accurate)
  where id = d;
  return null;
end $$;
create trigger deal_votes_sync after insert or update or delete on deal_votes
  for each row execute function sync_deal_vote_counts();
