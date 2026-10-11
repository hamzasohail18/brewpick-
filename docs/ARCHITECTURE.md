# Architecture

BrewPick Lahore answers one question fast: *where should I get coffee right now?* Everything else
(source registry, staging, review) exists so the answer is built on data we can trace and trust.

```
          ┌──────────── collectors (Node) ────────────┐
sources ─▶│ guard ─▶ fetch/OCR ─▶ normalize ─▶ validate │─▶ staging_records ─▶ review queue ─▶ publisher
(registry)└────────────────────────────────────────────┘        (diff, flags)     (admin)      (txn + audit_log)
                                                                                                   │
            community submissions / Menu Capture / owner portal ──▶ submissions ─▶ review ─────────┤
                                                                                                   ▼
                                                     places · menu · prices · nutrition · beans · deals
                                                                                                   │
                         v_current_menu · effective_price() · freshness ◀──────────────────────────┘
                                                                                                   │
                                Next.js app (RSC + TanStack Query) · PWA cache ◀── RLS: published only
```

## Key decisions

| Decision | Why |
|---|---|
| Supabase Postgres, plain SQL migrations | RLS, auth and cron in one place; SQL keeps `effective_price` close to the data |
| Server queries in SQL, run as the request's role | One data path for Supabase and local PGlite; RLS still decides visibility |
| Collector guard in two layers | TS guard gives readable reasons; a `source_runs` trigger makes it impossible to bypass |
| PGlite for DB tests | Migrations, RLS and functions are tested in-process without Docker |
| Scoring engine in TypeScript, prices in SQL | Effective price must be identical everywhere (SQL); scoring weights change often and need fast unit tests (TS) |
| Effective price mirrored in TS, held to SQL by a parity test | Toggling a saved card must update prices instantly and offline; the parity test keeps the two engines identical |
| Nothing scraped writes to live tables | All automated/community data goes through `staging_records` or `submissions` and human review |
| Confidence decays in reads, not writes | `display_confidence()` drops one level after 30 days, so the stored value stays the reviewer's judgement |
| Distance and "open now" computed on the phone | The user's location never reaches the server; filters that need the database go in the URL instead |
| Saved cards stored locally by default | Bank/app *names* only; synced to `user_payment_methods` only when signed in |
| Hand-written service worker, network first for pages | Works with Turbopack builds without a plugin; fresh data when online, the last copy offline, nothing private cached |
| One scheduler pass from cron (GitHub Actions) | No extra queue to run; each source's own interval and rate limit decide what runs; failures fail the job |
| Ownership of claimed places in its own table | `place_owners` is RLS-private (owner + admins); the public row only says "claimed" |
| OCR locally with Tesseract | No image leaves the server; the English model ships in `node_modules`, so runs work offline and need no key |

## Folder structure

```
brewpick-lahore/
├─ supabase/
│  ├─ migrations/          schema, views/functions, RLS (timestamped, applied in order)
│  ├─ seeds/               reference data, source registry, fictional sample places
│  ├─ test/                Supabase auth/role shim used only by tests
│  └─ config.toml
├─ src/
│  ├─ app/                 Next.js App Router
│  │  ├─ (app)/            Home · Explore · Compare · Deals · Profile (bottom nav)
│  │  ├─ admin/            sources (+ Run now), review queue, moderation, CSV import, manual deal entry
│  │  ├─ offline/          page the service worker shows for pages not saved yet
│  │  └─ manifest.ts       web app manifest (installable PWA)
│  │  └─ api/              server routes (submissions, publisher, run-now)
│  ├─ components/          UI (shadcn/ui in components/ui)
│  ├─ lib/
│  │  ├─ db/               SQL access (Postgres or PGlite), actor/role scoping, PGlite migrator
│  │  ├─ auth/             session -> actor (Supabase Auth, or dev-only sign-in)
│  │  ├─ admin/            admin data access (source registry, ...)
│  │  ├─ supabase/         browser / server / service-role clients
│  │  ├─ domain/           types + Zod schemas shared by app, scripts and collectors
│  │  ├─ profile/          own-rows repo (profile, favourites, account cards) + phone-side stores and account sync
│  │  ├─ scoring/          "Pick for me": engine (filters, factors, weights, reasons), quiz state, candidates query
│  │  ├─ community/        submissions -> staging, votes, reports, claims, owner confirm, moderation queries
│  │  ├─ compare/          compare query, URL selection, best-value rule, tray (localStorage)
│  │  ├─ deals/            effective-price engine (TS mirror of SQL), live deals loader, saved cards store
│  │  ├─ explore/          search + place detail queries, filters (URL), hours, travel estimate, location store
│  │  ├─ pipeline/         normalizer, validator, matcher + diff engine, stager, publisher, CSV import
│  │  └─ i18n/             message catalogues (en, ur) and RTL helpers
│  └─ ...
├─ collectors/
│  ├─ lib/                 runner (guard + run log), polite fetch, robots.txt, snapshots, scheduler,
│  │                       menu-line -> record helpers, merge-with-live-place
│  ├─ registry.ts          which collector serves a source (by slug, then by kind)
│  ├─ osm/                 Overpass importer
│  ├─ google-places/       Places API (New) Text Search
│  ├─ website/             cafe menu pages: JSON-LD first, HTML layout fallback
│  ├─ menu-file/           menu PDFs (text layer) and images (Tesseract OCR)
│  └─ bank-offers/         bank offer pages (manual entry fallback at /admin/deals/new)
├─ public/sw.js            service worker (offline copies of opened pages)
├─ scripts/                collect, scheduler, CSV import, sample data, purge, make-icons
├─ tests/                  unit + db tests (PGlite), fixtures (HTML, PDF, image, API JSON)
├─ e2e/                    Playwright: key journeys, offline, accessibility (axe)
├─ .github/workflows/      daily scheduler run
└─ docs/
```


