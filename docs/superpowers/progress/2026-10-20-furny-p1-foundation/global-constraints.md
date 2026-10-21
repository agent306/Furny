## Global Constraints

- Versions: `php ^8.4`; `laravel/framework ^13.38`; `inertiajs/inertia-laravel ^3.5`; `@inertiajs/vue3 ^3.9`; `vue ^3.5.44`; `vite ^8.3`; `tailwindcss ^4.3`; `typescript ^5.9`; exact pins `laravel/wayfinder 0.1.23`, `three 0.186.1`, `@tresjs/core`/`@tresjs/cientos 5.9.3`, `clipper2-ts 2.0.1-18` (`01 §1`).
- Package manager: **yarn 4 via corepack** only; `package.json` has `"packageManager": "yarn@4.x.y"` and `"engines": {"node": ">=22.12 <23"}`; `.yarnrc.yml` `nodeLinker: node-modules`; `yarn.lock` committed; `package-lock.json` must not exist.
- PHP: `declare(strict_types=1);` in every file; final classes by default; PSR-12 via Pint (Laravel preset); PHPStan level 8 via Larastan.
- TS: `strict: true`, no `any` (use `unknown` + zod); Vue SFCs `<script setup lang="ts">`; component files PascalCase; composables `useXxx.ts`.
- Domain code under `app/Domain/{Area}/{Models,Actions,Data,Enums,Events,States,Jobs,Queries}`; cross-cutting code under `app/Support`. Actions are `final`, single-purpose, wrap multi-row writes in `DB::transaction`, dispatch domain events after commit; controllers: authorise → FormRequest → one Action → response.
- Lengths are integer millimetres; money is integer minor units in `*_minor` `bigint` columns; areas `bigint` mm².
- Primary keys are ULIDs (`char(26)`, `HasUlids`) for all domain tables; bigint only for framework/package tables listed in master §6.3. Timestamps `timestamptz` (`timestampsTz()`); app timezone `UTC`; users see `users.timezone` (default `business.timezone` = `Asia/Kolkata`).
- Database naming: snake_case plural tables, `*_id` FKs, `*_at` timestamptz, `*_on` dates, `is_*`/`has_*` booleans; enums are `string` columns backed by PHP backed enums (never PG enums); ON DELETE per `02` (C/R/N); Postgres does not auto-index FKs — add the indexes `02` lists.
- Wire format: Inertia props, JSON responses and request bodies are **camelCase** (exceptions: `features` flag keys, Laravel paginator `meta` keys, Fortify/`13` auth form field names); query strings snake_case.
- i18n: no user-visible literal strings in Vue templates or PHP notifications/flash; ICU messages in `resources/lang/en/{namespace}.php` (Laravel-format only for `validation`, `passwords`, `pagination`, `auth`); PHP renders with `trans_icu()`, Vue with `t()`; `php artisan i18n:export` output committed and CI-checked.
- Never hard-code the product name: `config('app.name')` / `usePage().props.app.name`.
- Routes: every route has exactly one name, method and path, names dot-separated with the prefixes of master §6.6; names/paths come from `19 §8.5` (spec `14` is not written yet). TS never hard-codes URLs (Wayfinder `@/routes/...` / `@/actions/...`).
- Service providers and config files never touch the database, Redis or HTTP while booting; config files contain no closures (`config:cache`/`php artisan optimize` safe).
- Tests: PHP = Pest 5 (`vendor/bin/pest`), TS = Vitest (`yarn vitest run`). DB tests use Postgres `furny_test` with `RefreshDatabase` (never SQLite). `Http::preventStrayRequests()` is global; S3, mail, notifications, queues are faked (`Storage::fake('s3')`, `Mail::fake()`, …).
- Security: only `MessageBody.vue` may use `v-html` (P7); PII in logs/audit is masked (`App\Support\Privacy\Mask`); no PII in URLs, cache keys, job names or channel names.
- Commits: conventional commits; every message ends with the trailer
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01X1MLnD93h3fkmdHrLPbw3u` (written below as **+ trailer**).
- Quality gates (referenced by every task's Step 5):
  - **Gates-PHP** = `vendor/bin/pint --test && vendor/bin/phpstan analyse --no-progress --memory-limit=1G && vendor/bin/pest tests/Unit tests/Feature`
  - **Gates-JS** = `yarn lint && yarn format:check && yarn typecheck && yarn vitest run`
  - **Gates-Gen** = `php artisan typescript:transform && php artisan i18n:export && git diff --exit-code -- resources/js/types/generated.d.ts resources/js/lang/generated` (from Task 3 on)

