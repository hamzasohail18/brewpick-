-- Menu Capture (Section 7.6): one row per in-store capture. The id is generated on the phone, so an
-- offline capture that syncs twice is stored once. We keep the distance to the place, never the
-- volunteer's own coordinates.

create table field_captures (
  id uuid primary key,                         -- client-generated
  user_id uuid not null,                       -- auth user (admin or volunteer)
  place_id uuid not null references places(id) on delete cascade,
  captured_at timestamptz not null,            -- when the photo was taken (may be before sync)
  submitted_at timestamptz not null default now(),
  geotag_status text not null check (geotag_status in ('ok', 'far', 'missing')),
  distance_m integer,
  accuracy_m integer,
  photo_urls text[] not null check (cardinality(photo_urls) between 1 and 6),
  full_menu boolean not null default false,
  notes text,
  items_submitted integer not null default 0,
  items_staged integer not null default 0,
  items_reconfirmed integer not null default 0,
  items_rejected integer not null default 0
);
create index on field_captures (place_id, captured_at desc);
create index on field_captures (user_id, submitted_at desc);

alter table field_captures enable row level security;
create policy admin_all on field_captures for all to authenticated using (is_admin()) with check (is_admin());
-- Volunteers can see their own history; writes go through the server.
create policy own_read on field_captures for select to authenticated using (user_id = auth.uid());
grant select on field_captures to authenticated;
grant insert, update, delete on field_captures to authenticated;
