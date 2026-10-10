-- Review-queue support for staging_records (Section 7.3).

alter table staging_records
  -- Human-readable validator output (errors for rejected rows, warnings for flagged ones).
  add column messages text[] not null default '{}',
  -- Identifies "the same real-world thing" (e.g. place+item+size+channel) so a newer proposal
  -- replaces an older one still waiting in the queue instead of piling up beside it.
  add column match_key text;

create index staging_records_pending_key on staging_records (match_key) where status = 'pending_review';
create index on staging_records (target_table, status);
