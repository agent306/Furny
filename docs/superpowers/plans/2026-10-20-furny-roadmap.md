# Furny — Implementation Roadmap

**Spec:** `docs/superpowers/specs/2026-10-20-furny-design.md` + `docs/superpowers/specs/2026-10-20-furny/*.md` (01–19).

The spec covers several independent subsystems, so implementation is split into **milestone plans**. Each plan produces working, tested software on its own and is written in the `superpowers:writing-plans` format (`docs/superpowers/plans/2026-10-20-furny-pN-*.md`). Execution: subagent-driven development (one fresh implementer per task + reviewer), Sonnet-class implementers.

## Milestones and dependencies

| Plan | Name | Spec sections | Depends on | Can run in parallel with |
|---|---|---|---|---|
| **P1** | Foundation: Laravel skeleton, tooling, CI, data model (all migrations + models + factories + seeders), settings, roles/permissions, auth (email/password, Fortify, staff invitations, 2FA), upload intents, i18n layer, UI design system + layouts, Reverb/Horizon wiring, deployment files | master, 01, 02, 13, 15, 17 | — | P2 (after P1 Task 1 scaffold lands), P3 |
| **P2** | Engine: units, geometry, plan schema/derive/validate/snapping/commands, furniture schema/templates/generate/rules/diff/commands, BOM, nesting, pricing, engine CLI, worker RPC | 03, 04, 07 (engine parts), 08 | P1 Task 1 (repo scaffold: package.json, tsconfig, vitest) | P1, P3 |
| **P3** | Vision service (Python): FastAPI, normalization, CV pipeline, OCR, providers (anthropic/openai/openai_compatible/none), DXF, evaluation harness | 06 (service parts), 18 (provider layer) | — (contract test against engine CLI added after P2) | P1, P2 |
| **P4** | Projects & plan editor: project/plan CRUD, working-copy/revisions API, 2D SVG editor, 3D Tres scene, tools, exports, customer pages | 05, 10 (projects/plans), 14 | P1, P2 | P5 |
| **P5** | Furniture builder & catalog: catalog admin CRUD + snapshot API, presets/templates admin, furniture design CRUD + builder UI + revisions + server BOM job + cut-list exports | 07, 08, 10/11 (furniture, catalog) | P1, P2 | P4 |
| **P6** | Blueprint import & AI credits (Laravel side): import lifecycle, VisionClient, jobs, credits ledger/budget, review mode in editor, trace mode, admin imports/AI usage | 06, 18, 10/11 (imports, credits) | P3, P4 | P7 |
| **P7** | Orders: order lifecycle state machine T1–T31, change proposals, quotes (builder, calculator, PDF via Gotenberg), negotiation, calls, production updates, issues, delivery, messaging, timelines, customer + admin order UIs | 09, 08 §6, 10/11 (orders) | P4, P5 | P6, P8 |
| **P8** | Notifications: event catalogue, routing listener, channels (database/broadcast, mail, WhatsApp Meta/Twilio, SMS Twilio/MSG91, web push), preferences UI, webhooks, digest, reminders, PWA | 12 | P1 (infra), P7 (order events) — channel infra can start after P1 | P6, P7 |
| **P9** | Admin dashboards & hardening: dashboard KPIs, settings pages, reports, audit log viewer, system health, security headers/CSP, rate limits audit, E2E browser suites, deployment verification on staging | 11, 13, 16, 17 | P1–P8 | — |

## Execution order

1. **Wave A:** P1 Task 1 (scaffold) → then P1 (rest), P2, P3 in parallel (separate worktrees/branches, merged to `develop` per task batch).
2. **Wave B:** P4 and P5 in parallel.
3. **Wave C:** P6, P7, P8 in parallel.
4. **Wave D:** P9.

Each plan is written **just before its wave starts**, against the then-current code, so names and interfaces in the plan match what earlier waves actually built.

## Branching

- `spec/prd` — specification (merged to `main` as the first PR).
- `develop` — integration branch; each plan's tasks land here via PRs (or direct commits by the orchestrator after review).
- `main` — production; updated from `develop` at milestone ends.

## Local environment notes (build container)

- PHP 8.4.26 built from source at `/opt/php84` and linked as `/usr/local/bin/php` (first on PATH), so plain `php` and `composer` use 8.4. Extensions: bcmath, curl, exif, gd, intl, mbstring, pcntl, pdo_pgsql, pgsql, posix, redis, sodium, zip, opcache, sqlite.
- Composer dist downloads from api.github.com/codeload.github.com are blocked by the network proxy. Global Composer config is set to `preferred-install=source`, `use-github-api=false` (packages are git-cloned; works, slower). Packages that have **no source** in the lock (e.g. `phpstan/phpstan`) fail with "Could not authenticate against github.com": fix with `composer-seed-dist <vendor/package> <tag> <dist-url-from-composer.lock>` (helper in `/usr/local/bin`), then re-run `composer install`. GitHub release-asset downloads (`github.com/<o>/<r>/releases/download/...`) work. Packagist metadata, npm registry and PyPI are reachable. Package manager for JS is **yarn** (corepack).
- Scaffold source: clone `https://github.com/laravel/vue-starter-kit` (main = Laravel 13, Inertia 3, Fortify, Wayfinder, reka-ui, Vite 8). The Packagist `laravel/vue-starter-kit` package is outdated (Laravel 12) — do NOT use `composer create-project`. The kit's Vite config fetches fonts from `fonts.bunny.net` at build time (blocked here, and against the spec's self-hosted-fonts rule) — remove that font plugin/import in the scaffold task and use `@fontsource-variable/*` per spec 15. Verified in this container: kit installs, `php artisan` runs on PHP 8.4.26 + Laravel 13.38.0, Wayfinder type generation works.
- Start services if the container restarted: `service postgresql start && service redis-server start`.
- PostgreSQL 16 locally (production is 18; do not use PG17/18-only SQL features), Redis 7, Node 22, Python 3.13 with `uv` (vision service targets Python 3.12 in production; code must be 3.12-compatible).
- Databases: `furny` (dev) and `furny_test` (tests), user/password `furny`/`furny` on `127.0.0.1:5432`.
- No Docker daemon available: Gotenberg, MinIO and Mailpit are not available locally — tests fake them (`Http::fake`, `Storage::fake`, `Mail::fake`).
