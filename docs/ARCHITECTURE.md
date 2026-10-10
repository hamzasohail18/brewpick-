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
| Nothing scraped writes to live tables | All automated/community data goes through `staging_records` or `submissions` and human review |
| Confidence decays in reads, not writes | `display_confidence()` drops one level after 30 days, so the stored value stays the reviewer's judgement |
| Saved cards stored locally by default | Bank/app *names* only; synced to `user_payment_methods` only when signed in |

## Folder structure

```
brewpick-lahore/
├─ supabase/
│  ├─ migrations/          schema, views/functions, RLS (timestamped, applied in order)
│  ├─ seeds/               reference data, source registry (sample places come later)
│  ├─ test/                Supabase auth/role shim used only by tests
│  └─ config.toml
├─ src/
│  ├─ app/                 Next.js App Router
│  │  ├─ (app)/            Home · Explore · Compare · Deals · Profile (bottom nav)
│  │  ├─ admin/            sources, collectors, review queue, audit log, Menu Capture, moderation
│  │  └─ api/              server routes (submissions, publisher, run-now)
│  ├─ components/          UI (shadcn/ui in components/ui)
│  ├─ lib/
│  │  ├─ db/               SQL access (Postgres or PGlite), actor/role scoping, PGlite migrator
│  │  ├─ auth/             session -> actor (Supabase Auth, or dev-only sign-in)
│  │  ├─ admin/            admin data access (source registry, ...)
│  │  ├─ supabase/         browser / server / service-role clients
│  │  ├─ domain/           types + Zod schemas shared by app, scripts and collectors
│  │  ├─ scoring/          "Pick for me" engine
│  │  ├─ pipeline/         validator, diff engine, publisher
│  │  └─ i18n/             message catalogues (en, ur) and RTL helpers
│  └─ ...
├─ collectors/
│  ├─ lib/                 runner (guard + run log), polite fetch, robots.txt
│  └─ ...                  osm, google-places, website (JSON-LD/HTML), ocr, bank-offers
├─ scripts/                normalize, validate, CSV import/export, purge-sample-data
├─ tests/                  db (PGlite), fixtures (HTML/images), e2e (Playwright)
└─ docs/
```

Folders under `src/app/(app)`, `admin`, `collectors` and `scripts` are created as each build step lands.
