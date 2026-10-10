-- Row Level Security.
-- Model: the public (anon + authenticated) can READ published data only. Writes to catalogue/pipeline
-- tables go through the server (service_role bypasses RLS) or admins. Users manage their own rows
-- (profile, saved cards, favorites, votes) and may file submissions/reports/claims for review.
--
-- Admins are identified by app_metadata.role = 'admin' in the Supabase JWT (set server-side only;
-- users cannot edit app_metadata).

create or replace function is_admin() returns boolean
language sql stable as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin'
$$;

-- security definer so child-table policies don't re-run the places policy for every row.
create or replace function place_is_published(p_place_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from places where id = p_place_id and status = 'published')
$$;

create or replace function menu_item_is_public(p_menu_item_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from menu_items mi join places p on p.id = mi.place_id
     where mi.id = p_menu_item_id and mi.status = 'published' and p.status = 'published')
$$;

create or replace function item_size_is_public(p_item_size_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from item_sizes s
      join menu_items mi on mi.id = s.menu_item_id
      join places p on p.id = mi.place_id
     where s.id = p_item_size_id and mi.status = 'published' and p.status = 'published')
$$;

-- Expired deals disappear automatically (valid_to in Asia/Karachi local date).
create or replace function deal_is_public(p_deal_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from deals d
     where d.id = p_deal_id and d.status = 'published'
       and d.valid_to >= (now() at time zone 'Asia/Karachi')::date
       and (d.place_id is null or exists (select 1 from places p where p.id = d.place_id and p.status = 'published')))
$$;

-- ---------- enable RLS everywhere ----------
do $$
declare t text;
begin
  foreach t in array array[
    'areas','allergens','ingredients','drink_types','milk_types','payment_methods','brands',
    'sources','places','place_hours','menu_items','item_sizes','item_prices','nutrition_info',
    'item_milk_options','item_ingredients','item_allergens','bean_info',
    'deals','deal_items','deal_payment_methods','deal_conditions',
    'user_profiles','user_payment_methods','favorites',
    'submissions','deal_votes','reports','place_claims',
    'source_runs','staging_records','audit_log'
  ] loop
    execute format('alter table %I enable row level security', t);
    -- Admins can do everything on every table.
    execute format('create policy admin_all on %I for all to authenticated using (is_admin()) with check (is_admin())', t);
  end loop;
end $$;

-- ---------- reference data: world-readable ----------
create policy public_read on areas           for select to anon, authenticated using (true);
create policy public_read on allergens       for select to anon, authenticated using (true);
create policy public_read on ingredients     for select to anon, authenticated using (true);
create policy public_read on drink_types     for select to anon, authenticated using (true);
create policy public_read on milk_types      for select to anon, authenticated using (true);
create policy public_read on payment_methods for select to anon, authenticated using (true);
create policy public_read on brands          for select to anon, authenticated using (true);

-- ---------- catalogue: published only ----------
create policy public_read on places      for select to anon, authenticated using (status = 'published');
create policy public_read on place_hours for select to anon, authenticated using (place_is_published(place_id));
create policy public_read on menu_items  for select to anon, authenticated using (menu_item_is_public(id));
create policy public_read on item_sizes  for select to anon, authenticated using (menu_item_is_public(menu_item_id));
create policy public_read on item_prices for select to anon, authenticated using (item_size_is_public(item_size_id));
create policy public_read on nutrition_info    for select to anon, authenticated using (item_size_is_public(item_size_id));
create policy public_read on item_milk_options for select to anon, authenticated using (menu_item_is_public(menu_item_id));
create policy public_read on item_ingredients  for select to anon, authenticated using (menu_item_is_public(menu_item_id));
create policy public_read on item_allergens    for select to anon, authenticated using (menu_item_is_public(menu_item_id));
create policy public_read on bean_info   for select to anon, authenticated using (place_is_published(place_id));

create policy public_read on deals                for select to anon, authenticated using (deal_is_public(id));
create policy public_read on deal_items           for select to anon, authenticated using (deal_is_public(deal_id));
create policy public_read on deal_payment_methods for select to anon, authenticated using (deal_is_public(deal_id));
create policy public_read on deal_conditions      for select to anon, authenticated using (deal_is_public(deal_id));

-- ---------- users: own rows ----------
create policy own_row on user_profiles for all to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
create policy own_rows on user_payment_methods for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_rows on favorites for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_rows on deal_votes for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- community: file for review, read your own ----------
create policy own_read on submissions for select to authenticated using (user_id = auth.uid());
create policy own_insert on submissions for insert to authenticated
  with check (user_id = auth.uid() and status = 'pending_review' and reviewed_by is null);

create policy own_read on reports for select to authenticated using (user_id = auth.uid());
create policy own_insert on reports for insert to authenticated
  with check (user_id = auth.uid() and status = 'open');

create policy own_read on place_claims for select to authenticated using (user_id = auth.uid());
create policy own_insert on place_claims for insert to authenticated
  with check (user_id = auth.uid() and status = 'pending' and decided_at is null);

-- sources, source_runs, staging_records, audit_log: admin/service only (no extra policies).

-- Public attribution block (Section 8.3) without exposing the rest of the source registry.
-- Runs as the view owner, so it bypasses RLS on sources by design; only these columns are exposed.
create or replace view v_attributions as
  select name, license, attribution_text, base_url
    from sources
   where attribution_required and is_active;

-- ---------- grants ----------
grant usage on schema public to anon, authenticated;
grant select on all tables in schema public to anon, authenticated;
-- Table-level write grants for signed-in users; RLS above decides which rows (own rows, or admin_all).
grant insert, update, delete on all tables in schema public to authenticated;
grant usage on all sequences in schema public to authenticated;
grant select on v_attributions to anon, authenticated;
