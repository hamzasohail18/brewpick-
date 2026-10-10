-- Collector guard, database side (Section 8). The app-level guard (src/lib/domain/source-guard.ts)
-- gives detailed reasons; this trigger is the backstop: no run can even be queued against a source
-- that is not open to automation, whatever code path tries it.

create or replace function enforce_collector_guard() returns trigger
language plpgsql as $$
declare
  s sources%rowtype;
begin
  select * into s from sources where id = new.source_id;

  if not s.is_active then
    raise exception 'collector_guard: source % is inactive', s.slug using errcode = 'check_violation';
  end if;
  if s.kind in ('social_manual', 'delivery_app_manual', 'field_capture', 'owner_portal',
                'community_submission', 'manual_admin') then
    raise exception 'collector_guard: source % is human-entry only', s.slug using errcode = 'check_violation';
  end if;
  if s.automation not in ('allowed', 'allowed_with_conditions') then
    raise exception 'collector_guard: source % has automation = %', s.slug, s.automation using errcode = 'check_violation';
  end if;
  if s.robots_checked_at is null or s.robots_checked_at < now() - interval '6 months' then
    raise exception 'collector_guard: source % review is missing or older than 6 months', s.slug using errcode = 'check_violation';
  end if;

  return new;
end $$;

create trigger source_runs_guard before insert on source_runs
  for each row execute function enforce_collector_guard();

-- Also stop a queued run from starting if the source was closed off after it was queued.
create trigger source_runs_guard_on_start before update of status on source_runs
  for each row when (new.status = 'running' and old.status is distinct from 'running')
  execute function enforce_collector_guard();
