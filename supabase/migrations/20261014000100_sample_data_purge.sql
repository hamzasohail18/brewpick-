-- One-command removal of the fictional sample data (Section 9): npm run sample:purge.
-- Runs as the caller (security invoker), so RLS limits it to admins and the service role.

create or replace function purge_sample_data() returns jsonb
language plpgsql as $$
declare
  sample_source uuid := (select id from sources where slug = 'sample-data');
  n_deals int;
  n_places int;
  n_brands int;
  n_staged int;
begin
  delete from deals
   where is_sample
      or brand_id in (select id from brands where is_sample)
      or (sample_source is not null and source_id = sample_source);
  get diagnostics n_deals = row_count;

  -- Cascades to hours, menu items, sizes, prices, nutrition, beans, milk options, favorites.
  delete from places where is_sample;
  get diagnostics n_places = row_count;

  delete from brands where is_sample;
  get diagnostics n_brands = row_count;

  delete from staging_records where source_id = sample_source;
  get diagnostics n_staged = row_count;

  -- Drop the source too unless the audit log still points at it.
  delete from sources s
   where s.id = sample_source
     and not exists (select 1 from audit_log a where a.source_id = s.id)
     and not exists (select 1 from item_prices p where p.source_id = s.id);

  return jsonb_build_object('places', n_places, 'deals', n_deals, 'brands', n_brands, 'staged', n_staged);
end $$;

revoke execute on function purge_sample_data() from public, anon;
