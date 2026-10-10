-- Source registry seed (Section 8.2).
--
-- Every `automation` value in the spec table is a STARTING ASSUMPTION. Sources that point at someone
-- else's site or API are seeded as 'unknown_review_required' with the intended status recorded in
-- automation_notes; an admin must read the current robots.txt / ToS / licence, fill robots_checked_at,
-- and only then switch them on (the DB check constraint enforces this).
-- Human-entry sources (manual, field capture, owner portal, community) are seeded as 'allowed' because
-- there is nothing to crawl; their "conditions" are enforced by the review workflow.
--
-- Per-cafe sources (cafe-website-<slug>, cafe-menu-file-<slug>, instagram-official-<slug>) are created
-- per place when the place is added, not here.
--
-- Change the contact address in user_agent before running any collector.

insert into sources (slug, name, kind, base_url, automation, automation_notes, license,
                     attribution_required, attribution_text, rate_limit_seconds, user_agent,
                     default_confidence, check_interval_days, max_cache_days) values

  ('osm-overpass-lahore', 'OpenStreetMap (Overpass API)', 'open_data_api',
   'https://overpass-api.de/api/interpreter', 'unknown_review_required',
   'INTENDED: allowed_with_conditions. ODbL licence: attribution "© OpenStreetMap contributors" required. '
   'Respect the Overpass usage policy and rate limits. Check share-alike implications for the places table '
   '(keep OSM-derived fields identifiable via source_id).',
   'ODbL', true, '© OpenStreetMap contributors', 10,
   'BrewPickLahore/0.1 (+mailto:data@brewpick.example)', 'community_reported', 30, null),

  ('google-places-api', 'Google Places API', 'official_api',
   'https://places.googleapis.com/v1', 'unknown_review_required',
   'INTENDED: allowed_with_conditions. Official API only, within its terms, quotas and billing. Check the '
   'caching/storage limits and attribution rules, then set max_cache_days. Never scrape Google Maps pages.',
   'Google Maps Platform Terms', true, 'Place data © Google', 2,
   'BrewPickLahore/0.1 (+mailto:data@brewpick.example)', 'community_reported', 30, null),

  ('usda-fooddata-central', 'USDA FoodData Central', 'reference_dataset',
   'https://api.nal.usda.gov/fdc/v1', 'unknown_review_required',
   'INTENDED: allowed. Public API (API key required); keep attribution. Used for estimated nutrition only.',
   'Public domain (CC0)', true, 'Nutrition reference: USDA FoodData Central', 2,
   'BrewPickLahore/0.1 (+mailto:data@brewpick.example)', 'estimated', 90, null),

  ('open-food-facts', 'Open Food Facts', 'reference_dataset',
   'https://world.openfoodfacts.org', 'unknown_review_required',
   'INTENDED: allowed_with_conditions. Open Database Licence with attribution and share-alike terms; confirm.',
   'ODbL', true, 'Product data © Open Food Facts contributors', 5,
   'BrewPickLahore/0.1 (+mailto:data@brewpick.example)', 'estimated', 90, null),

  ('bank-offers-alfalah', 'Bank Alfalah offers', 'bank_offer_page', 'https://www.bankalfalah.com',
   'unknown_review_required',
   'INTENDED: unknown_review_required. Confirm ToS and find the current offers page URL. If automation is not '
   'allowed, use manual entry with the offer page URL as source_url.',
   null, false, null, 5, 'BrewPickLahore/0.1 (+mailto:data@brewpick.example)', 'community_reported', 1, null),

  ('bank-offers-hbl', 'HBL offers', 'bank_offer_page', 'https://www.hbl.com',
   'unknown_review_required', 'INTENDED: unknown_review_required. Same as bank-offers-alfalah.',
   null, false, null, 5, 'BrewPickLahore/0.1 (+mailto:data@brewpick.example)', 'community_reported', 1, null),

  ('bank-offers-ubl', 'UBL offers', 'bank_offer_page', 'https://www.ubldigital.com',
   'unknown_review_required', 'INTENDED: unknown_review_required. Same as bank-offers-alfalah.',
   null, false, null, 5, 'BrewPickLahore/0.1 (+mailto:data@brewpick.example)', 'community_reported', 1, null),

  ('bank-offers-meezan', 'Meezan Bank offers', 'bank_offer_page', 'https://www.meezanbank.com',
   'unknown_review_required', 'INTENDED: unknown_review_required. Same as bank-offers-alfalah.',
   null, false, null, 5, 'BrewPickLahore/0.1 (+mailto:data@brewpick.example)', 'community_reported', 1, null),

  ('bank-offers-standard-chartered', 'Standard Chartered PK offers', 'bank_offer_page', 'https://www.sc.com/pk',
   'unknown_review_required', 'INTENDED: unknown_review_required. Same as bank-offers-alfalah.',
   null, false, null, 5, 'BrewPickLahore/0.1 (+mailto:data@brewpick.example)', 'community_reported', 1, null),

  ('bank-offers-faysal', 'Faysal Bank offers', 'bank_offer_page', 'https://www.faysalbank.com',
   'unknown_review_required', 'INTENDED: unknown_review_required. Same as bank-offers-alfalah.',
   null, false, null, 5, 'BrewPickLahore/0.1 (+mailto:data@brewpick.example)', 'community_reported', 1, null),

  ('instagram-manual', 'Instagram (manual entry)', 'social_manual', 'https://www.instagram.com',
   'allowed', 'Manual entry only; save a screenshot as proof_image_url. NO automated scraping.',
   null, false, null, 5, null, 'community_reported', 7, null),

  ('facebook-manual', 'Facebook (manual entry)', 'social_manual', 'https://www.facebook.com',
   'allowed', 'Manual entry only; save a screenshot as proof_image_url. NO automated scraping.',
   null, false, null, 5, null, 'community_reported', 7, null),

  ('delivery-apps-manual', 'Delivery apps (manual reference)', 'delivery_app_manual', null,
   'allowed', 'Manual reference entry only; store with channel = delivery. Automated access not permitted '
   'unless an official partner API is obtained.',
   null, false, null, 5, null, 'community_reported', 14, null),

  ('field-capture', 'Field capture (in-store)', 'field_capture', null,
   'allowed', 'Highest-trust source. Requires photo, date and geotag check. Default confidence verified after review.',
   null, false, null, 5, null, 'verified', 14, null),

  ('owner-portal', 'Owner portal', 'owner_portal', null,
   'allowed', 'Requires an approved place_claims row. Changes still go through review.',
   null, false, null, 5, null, 'verified', 30, null),

  ('community-submissions', 'Community submissions', 'community_submission', null,
   'allowed', 'Default confidence community_reported. Photo proof required for price/deal changes.',
   null, false, null, 5, null, 'community_reported', 14, null),

  ('manual-admin', 'Manual admin entry', 'manual_admin', null,
   'allowed', 'Staff entry. Record actor_id in audit_log.',
   null, false, null, 5, null, 'community_reported', 30, null)

on conflict (slug) do nothing;

update sources set next_check_at = now() where next_check_at is null;
