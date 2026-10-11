-- Who owns a claimed place is private. places.claimed_by was readable by anyone who could read the place
-- (i.e. the public), exposing the owner's account id. Ownership moves to place_owners, readable only by
-- that owner and admins; the public keeps a plain "claimed" flag.

create table place_owners (
  place_id uuid primary key references places(id) on delete cascade,
  user_id uuid not null references user_profiles(id) on delete cascade,
  claim_id uuid references place_claims(id) on delete set null,
  created_at timestamptz not null default now()
);
create index place_owners_user_idx on place_owners (user_id);

insert into place_owners (place_id, user_id)
  select id, claimed_by from places where claimed_by is not null;

alter table places add column is_claimed boolean not null default false;
update places set is_claimed = true where claimed_by is not null;
alter table places drop column claimed_by;

-- Keep the public flag in step with ownership, whoever changes it.
create or replace function sync_place_claimed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    update places set is_claimed = true where id = new.place_id and not is_claimed;
  end if;
  if tg_op in ('DELETE', 'UPDATE') and (tg_op = 'DELETE' or old.place_id <> new.place_id) then
    update places set is_claimed = false where id = old.place_id;
  end if;
  return null;
end $$;
create trigger place_owners_sync after insert or update or delete on place_owners
  for each row execute function sync_place_claimed();

alter table place_owners enable row level security;
create policy admin_all on place_owners for all to authenticated using (is_admin()) with check (is_admin());
create policy own_read on place_owners for select to authenticated using (user_id = auth.uid());
grant select on place_owners to authenticated;
grant insert, update, delete on place_owners to authenticated; -- admins only, by policy
