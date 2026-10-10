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
| `GOOGLE_PLACES_API_KEY`, `USDA_FDC_API_KEY` | collectors | Optional; only used once the source is reviewed |

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
