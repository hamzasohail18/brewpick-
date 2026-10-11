-- Community submissions, reports, deal votes and owner claims (build step 11).

-- A community or owner submission becomes staged records in the normal review queue; this link lets the
-- submission's status follow the review (published / rejected) and lets reviewers see who sent it.
alter table staging_records add column submission_id uuid references submissions(id) on delete set null;
create index staging_records_submission_idx on staging_records (submission_id) where submission_id is not null;

create index submissions_status_idx on submissions (status, created_at desc);
create index submissions_user_idx on submissions (user_id, created_at desc);

-- Reports: what's wrong, plus the moderator's resolution.
alter table reports
  add column details text check (char_length(details) <= 1000),
  add column resolved_by uuid,
  add column resolved_at timestamptz,
  add column resolution_note text;
create index reports_open_idx on reports (status, created_at desc);
create index reports_user_idx on reports (user_id, created_at desc);

-- Claims: how the owner can be verified, and the decision.
alter table place_claims
  add column contact_name text check (char_length(contact_name) <= 100),
  add column contact_phone text check (char_length(contact_phone) <= 30),
  add column contact_email text check (char_length(contact_email) <= 200),
  add column note text check (char_length(note) <= 1000),
  add column document_url text,
  add column decided_by uuid,
  add column decision_note text;
-- One open claim per person per place.
create unique index place_claims_one_pending on place_claims (place_id, user_id) where status = 'pending';

-- Owners see their claimed places' claim history; the public never sees claims.
-- (place_claims own_read / own_insert policies already exist.)

-- Deal votes are public in aggregate (deals.upvotes / downvotes, kept by the existing trigger);
-- individual votes stay private to the voter (existing own_rows policy).
