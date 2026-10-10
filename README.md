# BrewPick Lahore

Mobile-first PWA that helps people in Lahore decide where to get their next coffee in under 30 seconds:
effective price after the deals *you* can use, distance, and calories, from data with visible sources.

> Prices and deals may change; confirm with the cafe.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design and folder layout.

## Setup

Requirements: Node 20+, and for a local database either the Supabase CLI + Docker, or a hosted Supabase project.

```bash
npm install
cp .env.example .env.local     # fill in Supabase URL + keys
npm run db:start               # local Supabase (Docker)
npm run db:reset               # applies supabase/migrations + supabase/seeds
npm run dev
```

Tests don't need Docker; the database suite runs the real migrations in PGlite:

```bash
npm test
```

## Environment variables

| Name | Where | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | browser + server | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | browser + server | Public key; RLS limits it to published data and the user's own rows |
| `SUPABASE_SERVICE_ROLE_KEY` | server only | Admin routes, publisher, collectors |
| `COLLECTOR_CONTACT_EMAIL` | collectors | Contact in the User-Agent |
| `GOOGLE_PLACES_API_KEY`, `USDA_FDC_API_KEY` | collectors | Optional; only used once the source is reviewed |

Admins are users whose Supabase `app_metadata.role` is `admin` (set from the dashboard or with the service key).

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
- We store facts (prices, items, hours) and link to the source; we don't republish others' photos or text.
- Verified, community-reported and estimated data are kept visually distinct in the UI.
- Takedown / correction contact: *to be set before launch*.
