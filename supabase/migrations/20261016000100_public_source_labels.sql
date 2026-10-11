-- Every price and deal shows where it came from (Section 10). The source registry itself is admin-only
-- (it holds review notes and automation decisions), so the public gets just the label through this view.
-- Runs as the view owner, bypassing RLS on sources by design; only these columns are exposed.
create or replace view v_source_labels as
  select id, slug, name, kind, base_url
    from sources;

grant select on v_source_labels to anon, authenticated;
