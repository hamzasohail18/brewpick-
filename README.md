# BrewPick Lahore

Mobile-first PWA that helps people in Lahore decide where to get their next coffee in under 30 seconds:
effective price after the deals *you* can use, distance, and calories, from data with visible sources.

> Prices and deals may change; confirm with the cafe.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design and folder layout.

## Setup

Requirements: Node 20+. Nothing else is needed for local development.

```bash
npm install
cp .env.example .env.local
npm run dev            # http://localhost:3000
```

With `DATABASE_URL` blank, the app runs on an embedded PGlite database in `.data/pglite`, applying
`supabase/migrations` and `supabase/seeds` on first start. Delete that folder (with the dev server
stopped) to start fresh. With Supabase Auth unset, `/admin/login` offers a **dev-only** admin sign-in;
it is disabled whenever Supabase is configured or `NODE_ENV=production`.

To use Supabase instead: set `DATABASE_URL` and the `NEXT_PUBLIC_SUPABASE_*` keys, then apply the
schema with the Supabase CLI (`npm run db:reset` locally, or `supabase db push` to a hosted project).

```bash
npm test               # unit + database tests (real migrations in PGlite; no Docker)
npm run lint
npm run typecheck
```

## Environment variables

| Name | Where | Purpose |
|---|---|---|
| `DATABASE_URL` | server | Postgres connection string. Blank = embedded PGlite |
| `PGLITE_DIR` | server | Where the embedded database lives (default `.data/pglite`) |
| `NEXT_PUBLIC_SUPABASE_URL` | browser + server | Supabase project URL (enables Supabase Auth) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | browser + server | Public key; RLS limits it to published data and the user's own rows |
| `SUPABASE_SERVICE_ROLE_KEY` | server only | Reserved for jobs that must bypass RLS |
| `COLLECTOR_CONTACT_EMAIL` | collectors | Contact in the User-Agent; collectors refuse to run without it |
| `SNAPSHOT_DIR` | collectors | Where raw collector responses are kept (default `.data/snapshots`) |
| `UPLOAD_DIR` | server | Where proof photos are stored (default `.data/uploads`) |
| `APP_URL` | server | Public origin used in stored proof-photo links (e.g. `https://brewpick.pk`) |
| `CAPTURE_MAX_DISTANCE_M` | server | How close to a place a Menu Capture must be made (default 200) |
| `GOOGLE_PLACES_API_KEY`, `USDA_FDC_API_KEY` | collectors | Optional; only used once the source is reviewed |
| `NEXT_PUBLIC_MAP_TILE_URL` | browser | Map tile template (default: OpenStreetMap's standard tiles, see the map note below) |
| `NEXT_PUBLIC_MAP_ATTRIBUTION` | browser | Attribution HTML for that tile provider |

Admins are users whose Supabase `app_metadata.role` is `admin` (set from the dashboard or with the service key).

## How data access works

Server code talks to Postgres with SQL through `src/lib/db`. Every query runs as an *actor*:
`anon`, a signed-in user, or `service` (jobs only). For anon and users, the transaction switches to
the matching Postgres role and JWT claims, so the RLS policies decide what's visible, the same as
for direct Supabase access.

## Source registry and collector guard

`/admin/sources` lists every data source with its automation status, review state and last run.
Collectors go through `collectors/lib/runner.ts`, which:

1. reads the source row and runs the guard (`src/lib/domain/source-guard.ts`). It refuses unless the
   source is active, not a manual-entry kind, `allowed`/`allowed_with_conditions`, has review notes
   and a review date under 6 months old, has a base URL, and has a real contact in its User-Agent;
2. records a `source_runs` row (a database trigger re-checks the same rules, so no code path can skip them);
3. hands the collector a fetch that sends the User-Agent, waits `rate_limit_seconds` between requests,
   honours robots.txt (including Crawl-delay), stays on the source's host, backs off on 429/5xx and
   caches only when `cache_allowed`;
4. on a 401/403, fails the run and switches the source to `not_allowed` with a note, so a person re-reviews it.

"Run now" in the admin queues a run; the worker that executes queued runs arrives with the scheduler (build step 12).

## Review pipeline (staging → review → publish)

Nothing collected or imported writes live tables directly. Everything goes through `src/lib/pipeline`:

1. **Normalize** (`normalize.ts`): integer PKR from "Rs. 1,250/-", sizes to ml (Small 240 / Regular 350 /
   Large 470 *only* when the source states no volume, marked `volume_is_assumed`), menu names to
   `drink_types` via aliases, times to 24h Asia/Karachi.
2. **Validate** (`validate.ts`). Rejected outright: missing source URL and proof image, price outside
   Rs. 50–5,000, deal ending before it starts, estimated nutrition without assumptions. Flagged for a
   closer look: price outside Rs. 100–3,000, calories implausible for the cup size/milk, assumed volume,
   unknown drink type, deal expired or ending within 48 h, discount over 50%, coordinates outside Lahore.
   Rejected rows are kept (status `rejected`) so you can see what a source got wrong.
3. **Diff** (`diff.ts`, `match.ts`): finds the live row (place+item+size+channel for prices, OSM/Google
   id or name+location for places, …). No live row = *new*; identical = *re-confirm*, auto-approved and
   only bumps `last_verified_at`; otherwise *change*, with a per-field diff and a flag for price
   changes over 15%. A blank value in the source is treated as "not stated", never as "clear this".
   When a batch is marked as a complete menu, live items missing from it are staged as *removals*.
   A newer proposal for the same thing replaces one still pending.
4. **Review** (`/admin/review`): evidence beside live and proposed values; Approve, Edit (re-validated)
   or Reject (reason required). Approving moves on to the next pending item.
5. **Publish** (`publish.ts`), in one transaction: creates the menu item/size if needed, marks the old
   price `is_current = false` with `superseded_at`, inserts the new price with full provenance and
   `last_verified_at = now()`, and writes `audit_log`.

## Adding real data from a spreadsheet

`/admin/import` takes a CSV of **prices** or **places** (templates linked on the page, also in
`public/templates/`). Rows land in the review queue like any other source. For a hosted database you
can also run:

```bash
npm run import:csv -- --type prices --source manual-admin prices.csv
```

(The script needs `DATABASE_URL`; with the embedded dev database use the admin page, since two processes
must not open the same PGlite folder.)

## Places from OpenStreetMap

`collectors/osm` asks the Overpass API for cafés, coffee shops and coffee kiosks inside Lahore and
stages them as place records: name, branch, type (chain if branded, kiosk if drive-through, otherwise
specialty café for a reviewer to adjust), nearest area, address, phone, website, Instagram, wifi,
halal, drive-through and opening hours (common `opening_hours` patterns; anything unusual is left
blank rather than guessed). Unnamed, disused and out-of-town entries are skipped. The raw response is
saved under `.data/snapshots/<run>/` for audit.

To run it, an admin first reviews the source in `/admin/sources` (Overpass usage policy + ODbL),
and `COLLECTOR_CONTACT_EMAIL` must be set. Then use **Run now**, or `npm run collect -- osm-overpass-lahore`
against a hosted database. New places land in the review queue; later runs re-confirm unchanged places
automatically.

## Menu Capture (in-store prices)

`/capture` is a phone page for volunteers and admins (users whose `app_metadata.role` is `volunteer`
or `admin`; in local dev use "Continue as dev volunteer"):

1. **Where are you?** "Use my location" sorts places by distance and checks you're within
   `CAPTURE_MAX_DISTANCE_M` (default 200 m; reported GPS accuracy, up to 100 m, counts in your favour).
   Further away is refused. No location at all is allowed but flagged `geotag_missing` for the reviewer.
2. **Photograph the menu** (up to 6 photos). Photos are resized on the phone and re-encoded, which drops
   EXIF (GPS, device); the server strips any remaining EXIF before saving.
3. **Check the prices.** Rows are prefilled from the current menu: change what's different, delete
   what's gone, add what's new. Ticking "whole coffee menu" proposes removal of drinks not listed.
4. **Submit.** Changed prices go to the review queue as `field-capture` records (verified once approved),
   with the photo as evidence. Unchanged prices are re-confirmed straight away.

With no signal, captures wait in the phone's outbox (IndexedDB) and upload when the connection is back.
The capture id comes from the phone, so a retry can't create duplicates. We store the distance to the
café, never the volunteer's coordinates.

Photos are stored in `.data/uploads` (`UPLOAD_DIR`) and served at `/uploads/...`. Set `APP_URL` in
production so stored proof links use the public domain.

Phones only share their location with HTTPS sites. Over plain-HTTP Wi-Fi (http://<your-mac>:3000) the
location check reports "missing" and captures are flagged; use a deployed HTTPS preview, or
`next dev --experimental-https`, to test it on a real phone.

## Explore and place pages

`/explore` lists published places with every filter from the spec. Filters live in the URL, so a filtered list can be shared.

- **Server side** (`src/lib/explore/repo.ts`, runs as `anon` so RLS applies): drink type, hot/iced, price/calorie/sugar limits, minimum caffeine, roast, milk alternative, allergens, dairy-free, place type, area, amenities and "has deals". Each card shows the cheapest matching drink, or the lowest-calorie one when sorting by calories.
- **On the phone**: distance, travel time, "open now" and the distance limit. Your GPS position is never sent to the server or stored; only the *choice* (an area, or "use my location") is remembered in the browser.
- **Missing data is never zero.** A calorie or sugar limit skips drinks without that data. An allergen filter skips drinks with no allergen or ingredient information, and "no dairy" means the drink as served has no milk.
- **Opening hours** are evaluated in Lahore time (`Asia/Karachi`), including after-midnight closing; unlisted days count as closed (OSM convention).
- **Travel time is an estimate**: straight-line distance × 1.35 for roads, walking at 4.5 km/h up to 1.2 km, otherwise driving at 18 km/h + 3 min. The assumptions sit in `src/lib/explore/travel.ts` and show on hover.

`/places/[slug]` shows the menu per size with tax flag, calories, sugar and caffeine. Every price shows its confidence, last-checked date, source, source link and menu photo where there is one. Estimated nutrition shows how it was estimated. The page also lists milk options with price and calorie differences, allergens, ingredients, beans, today's active deals (with a badge when a deal ends within 48 hours), weekly hours and a map. Source names come from the `v_source_labels` view, so the public sees a source's name without the registry's review notes.

### Compare

`/compare` puts 2–4 drinks side by side as a real table: drinks are columns and measures are rows, so screen readers read each cell with its row and column. A selection is a shareable link:

- `/compare?places=a,b,c&drink=latte` compares the same drink across places. For each place it picks the size closest to a regular cup (350 ml), dine-in before takeaway. A place that doesn't serve the drink still gets a column, marked "Not on the menu".
- `/compare?items=<item_size id>,...` compares specific sizes picked with the "Compare" buttons on a place's menu.

Picks collect in a tray (kept in this browser only) from the Explore cards and the place pages. The page can also start from scratch: pick a drink, then places. Rows are price, price after deals, size, price per 100 ml, calories, sugar, caffeine, calories per Rs 100, beans, distance, open now, rating, deals, and confidence with source. The best value in each row is marked with ✓ and a label, not colour alone. Lower wins for prices and calories; higher wins for caffeine ("strongest") and rating. Unknown values never win, and a row where all values are equal marks nothing. "After deals" counts only deals open to everyone right now; the user's saved cards come with the Deals step. Share uses the phone's share sheet (or copies the link); WhatsApp opens with a text summary and the link.

### Deals and effective price

`/deals` lists every live deal: bank cards, wallets, delivery apps, happy hours, combos and student offers. Each shows its terms, days and times, minimum spend, items it covers, conditions, validity, source link or proof photo, and how sure we are. Expired deals never reach the page (RLS plus the date check in `src/lib/deals/repo.ts`). Deals ending within 48 hours get an "Ends tonight / Ends tomorrow" badge, and each deal says whether it's on right now and whether you can use it. Filters: "I can use", "On now", and deal type. Sort: ending soonest, or nearest when a location is set.

**My cards:** the user picks the banks, wallets and apps they hold (names only, never card numbers). The choice is stored in this browser (`bp.cards`); syncing to an account comes with the Profile step. Explore cards, place menus and Compare show the price after the best deal the user can use right now, and recalculate the moment a card is toggled.

**One rule, two engines:** `effective_price_detail()` in SQL is the reference. `src/lib/deals/engine.ts` mirrors it line for line, so prices update instantly on the phone and work offline. `tests/deals/parity.test.ts` runs both over every sample drink × 5 card sets × 56 times across a week (10,000+ checks, with extra fixed-price, 12.5% rounding, free-item and tie deals) and requires identical results. If you change one, change the other.

Assumptions: BOGO counts as 50% off each cup. "Free item" deals don't reduce the drink's price. Minimum spend is checked against a single cup. Percentage discounts round half away from zero, as Postgres does.

### Pick for me (decision engine)

Home asks the first question (budget) right on the screen, so a recommendation is **4 taps** from opening the app: budget → goal (cheapest, healthiest, strongest, best beans, best deal) → style (hot or iced, with or without milk) → distance. Answers live in the URL (`/pick?b=800&g=cheapest&s=hot-milk&d=3`), so Back works and a chip on the result changes one answer. The server only gets the style and budget (`/api/pick`). Ranking runs on the phone in `src/lib/scoring/engine.ts`, because it needs the user's location and saved cards.

How a pick is made:
1. **Hard filters:** drink style (unknown milk isn't guessed), budget against the **price after deals**, distance limit, and closed places left out. A price without a source is never ranked (Section 9).
2. **Eight factors**, each scaled 0–1 across the drinks still in play: price after deals, menu price, calories, caffeine, bean quality, distance, rating, deal value.
3. **Weights by goal** (`WEIGHTS` in the engine, shown in "Why this pick?"). For example, "cheapest" puts 45% on price after deals, 15% on distance and 10% each on menu price, deal and rating.
4. **Missing data is never zero.** A factor with no data for a drink is left out of its average, and the score drops by half that factor's weight (`MISSING_PENALTY`). The card says so, e.g. "No calories data: scored lower". A factor nobody has data for (distance with no location) is dropped and the weights rescaled. Nutrition or beans without a source count as missing.
5. **Best drink per place, then the top three places**, so the alternates are real alternatives. Each pick gets a one-line reason: the top pick by your goal, and alternates by their trade-off against it ("Rs 60 more, 80 fewer kcal, 2.0 km further").

Heuristics, stated so they can be argued with:
- Bean quality = 60% Arabica share + 30% single origin (blend 0.4) + 10% origin stated.
- Ratings are pulled towards 4.0 with a weight of 20 votes.
- The server sends drinks up to 2× the budget, since a deal can take up to half off.

**Home** also shows the three closest places open now (top rated if no location is set) and today's best deals you can use.

### Profile, favourites and saved cards

Everything works without an account. Favourites, recently viewed places, saved cards, the home area, the usual budget and compare picks live in this browser (`bp.*` keys in localStorage). Profile has a button to clear them; clearing never touches the account.

Signing in is optional (`/login`):
- With Supabase configured, sign-in is by **emailed link** (no password); `/auth/callback` swaps the link's code for a session.
- Locally without Supabase, a dev-only "Continue as dev user" button is shown. It's disabled in production.
- After sign-in, `/` loads `/api/me` once per visit and merges: favourites on the phone go up to the account (`favorites`), and the account's come down.
- **Saved cards stay on the phone by default** (Section 3G). Ticking "Also keep my cards on my account" copies them to `user_payment_methods` and keeps them in step; unticking removes them from the account.
- The account's email and profile are held in memory only, never in browser storage.
- Return paths after sign-in are limited to same-site, non-admin paths.

`/api/me`, `/api/me/favorites` and `/api/me/cards` run as the signed-in user, so RLS limits every read and write to that user's own rows (tested: another user sees and changes nothing). Writes need a JSON body and a same-origin `Origin` header.

Language: the setting is in place but Urdu is marked "coming soon". The message catalogue and RTL plumbing exist; the translation isn't done yet.

### Community, moderation and owners

- **Suggestions** (`/places/[slug]/suggest`, signed in): a price change, missing drink, new deal, opening hours, or free text. All but free text need a photo (metadata stripped). Structured suggestions become staged records in the **review queue** (source *Community submissions*, flag *community*) with the photo as evidence. The submission's status follows the review, and senders see it under Profile → My submissions. Free text goes to **Moderation**. If the sender says "not sure" about tax, the known value is kept. Limit: 20 suggestions, reports and claims per user per day.
- **Deal votes**: "Worked / Didn't work" on every deal (one vote per user; tallies are public, individual votes private). Deals with at least 3 "didn't work" votes, and more of those than "worked", appear under Moderation → Disputed deals, where an admin can take them down (audited).
- **Reports** (`/places/[slug]/report`): closed, wrong hours/location/price, deal not honoured, duplicate, other.
- **Owner claims** (`/places/[slug]/claim`): verify by a call to the cafe's *listed* number, a business email on the cafe's domain, or a document photo. Documents are stored privately (`.data/private-uploads`, served only to admins at `/admin/files/...`). Approving sets `places.claimed_by`.
- **Owner portal** (`/owner`): "Confirm my menu is up to date" re-confirms every current price as the owner; unchanged prices move up to **Verified** at once. Owner price changes, drinks, deals and hours go through review (source *Owner portal*, flag *owner update*) and publish as Verified.
- **Confidence on re-confirmation**: a stronger source re-confirming unchanged data (an owner, or an in-store check) raises it to that level; it never lowers it.

**Map tiles:** the map uses Leaflet with OpenStreetMap's standard tile server by default. That's fine for development and light use, but the [OSM tile usage policy](https://operations.osmfoundation.org/policies/tiles/) doesn't allow heavy traffic. Before launch, set `NEXT_PUBLIC_MAP_TILE_URL` (and `NEXT_PUBLIC_MAP_ATTRIBUTION`) to a tile provider with a suitable plan, or self-host tiles.

## Sample data

The seed includes **14 fictional places** (`supabase/seeds/03_sample_data.sql`): menus, prices, estimated
nutrition with stated assumptions, house beans, milk options and 10 deals. Every row has `is_sample = true`,
and the app shows a "Sample data" badge. Names and values are invented. Edit `scripts/sample-data/data.ts`
and run `npm run sample:generate` to change it. Remove it all with `npm run sample:purge` or the button on
`/admin/import`.

## Database notes

- Money is integer PKR, volumes are ml, times are `timestamptz` shown in Asia/Karachi.
- `effective_price(item_size_id, payment_method_ids int[] | user_id uuid, at_time, channel)` returns the
  lowest price after the single best valid deal. `effective_price_detail(...)` also returns which deal.
  - Deals don't stack; the biggest single discount wins.
  - Min spend is checked against one cup (the app's unit of comparison).
  - BOGO counts as 50% off per cup; `free_item` gives nothing off the cup itself.
  - `deal_conditions` keys `dine_in_only`, `takeaway_only`, `delivery_only` are enforced; other keys are shown as terms.
- Records not verified in 30 days drop one confidence level when read (`display_confidence`).
- Expired and unpublished deals are invisible to the public through RLS.

## Data sources and legal notes

<!-- Expanded as collectors land (Section 7.8). -->
- Every source is listed in the `sources` registry with its automation status and review date.
  Collectors refuse to run unless a source is `allowed` or `allowed_with_conditions`, and the database
  refuses those statuses until `automation_notes` and `robots_checked_at` are filled.
- Third-party sources are seeded as `unknown_review_required`; the intended status is in `automation_notes`.
- Attribution (footer and About page) lists only sources we actually hold data from.
- We store facts (prices, items, hours) and link to the source; we don't republish others' photos or text.
- Verified, community-reported and estimated data are kept visually distinct in the UI.
- Takedown / correction contact: *to be set before launch*.
