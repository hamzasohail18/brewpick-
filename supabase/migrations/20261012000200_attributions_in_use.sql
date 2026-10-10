-- Only credit sources whose data we actually hold (or have successfully collected from).
-- Crediting a provider whose data isn't shown is misleading, and some terms (e.g. Google's)
-- tie attribution to displaying their data.
create or replace view v_attributions as
  select s.name, s.license, s.attribution_text, s.base_url
    from sources s
   where s.attribution_required and s.is_active
     and (
       exists (select 1 from source_runs r where r.source_id = s.id and r.status in ('succeeded', 'partial'))
       or exists (select 1 from places p         where p.source_id = s.id)
       or exists (select 1 from item_prices x    where x.source_id = s.id)
       or exists (select 1 from nutrition_info x where x.source_id = s.id)
       or exists (select 1 from bean_info x      where x.source_id = s.id)
       or exists (select 1 from deals x          where x.source_id = s.id)
     );
