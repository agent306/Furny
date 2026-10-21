# Task 1 report: scaffold, dependencies, tooling, CI

**Status:** DONE_WITH_CONCERNS
**Commit:** `bbfab4e` chore(scaffold): bootstrap app from vue-starter-kit with yarn 4, Pest 5, Larastan 8, Vitest and CI (base `cf6cd3e`, branch `build/p1-foundation`, not pushed)

## What was implemented

### Scaffold (kit `laravel/vue-starter-kit` main @ `d282e81`, same HEAD as preflight)
- Cloned to the scratchpad and copied into the repo root without `.git`, `README.md`, `CHANGELOG.md` or `LICENSE.md`. `rsync` is not installed, so I used `tar`. `git status --porcelain -- docs vision` printed nothing before and after the copy, and the commit excludes `docs/` and `vision/`.
- **C1 cleanup**, in order, before any Composer run:
  1. Removed chisel (`laravel/chisel`, `chisel.php`, `chisel-paths.php`, `InstallFeaturesCommand`, the `install:features` hooks in `post-update-cmd` and `extra.laravel.installer`). Stripped every `@chisel-*` marker comment from PHP, TS and Vue files.
  2. Deleted `pnpm-workspace.yaml`, `.npmrc` and `.github/workflows/tests.yml`. There was no `package-lock.json`.
  3. Replaced `vite-plus` with `vite`: plain `defineConfig`, no `lazyPlugins`, no `lint`/`fmt` blocks. Scripts use `vite` / `vite build`.
  4. Wrote `eslint.config.js` and `.prettierrc`.
  5. Removed passkeys everywhere: the Fortify feature, limiter and config block, the migration, `@laravel/passkeys`, the `Passkey*`/`ManagePasskeys` components, the `PasskeyUser`/`PasskeyAuthenticatable` usage on `User`, the `Passkey` TS type, and the blocks in the Login/ConfirmPassword pages.
  6. Set `inertia.ssr.enabled = false`.
  7. Removed `@fonts` from Blade and "Instrument Sans" from `app.css`. `vite.config.ts` has no `bunny()` call.
- Removed the kit settings area: `routes/settings.php` and its `require`, `Controllers/Settings`, `Requests/Settings`, `pages/settings`, `layouts/settings` and the `SettingsLayout` case in `app.ts`. I also deleted the kit components that only the settings pages used: `DeleteUser`, `ManageTwoFactor`, `AppearanceTabs`, `TwoFactorSetupModal`, `TwoFactorRecoveryCodes`, `Heading` and `useTwoFactorAuth`. The "Settings" link is gone from `UserMenuContent.vue`.
- Moved `pages/auth/*` to `pages/Auth/*`. The `FortifyServiceProvider` views now render `Auth/...`, and the layout resolver in `app.ts` matches `Auth/`. Welcome and Dashboard still work.
- Deleted the kit PHPUnit tests.
- **C12:** no branch was created; I committed on `build/p1-foundation`. Ran `cp .env.example .env && php artisan key:generate`. In `.env.example`, only the DB block changed: `pgsql` with the 17 §6.1 local values. The full `.env.example` belongs to Task 2. The local `.env` uses `DB_PASSWORD=furny`.

### Composer (`composer.json`, `composer.lock`)
- `name: furny/app`, `require.php ^8.4`, the 11 `ext-*` at `*`, and every 01 §1.1 package with its constraint. The lock resolves to framework v13.38.0, wayfinder v0.1.23 (exact pin), pest v5.3.3, and `resend/resend-php ^1.17` (latest stable, v1.17.0). Sentry is not installed (P1-D14).
- Dev: pest ^5.3, pest-plugin-laravel ^5.0, pest-plugin-browser ^5.1, larastan ^3.13, pint ^1.32, telescope ^5.26, boost ^2.10, plus the kit's pail, faker and mockery. Dropped as direct dependencies: `phpunit/phpunit` (Pest provides it), `nunomaduro/collision` (Pest requires it), `laravel/pao` and `laravel/sail` (not needed; no Docker).
- `extra.laravel.dont-discover: ["laravel/telescope"]`.
- Removed the project-level `preferred-install: dist` so the container's global `source` setting applies. CI still passes `--prefer-dist`.
- `scripts.dev` is the 17 §3.3 version. `setup` uses yarn, and `test` runs pint, phpstan and pest.

### Yarn (`package.json`, `.yarnrc.yml`, `yarn.lock`)
- `corepack use yarn@4` failed because `repo.yarnpkg.com` is blocked (proxy 403). I used `COREPACK_NPM_REGISTRY=https://registry.npmjs.org corepack use yarn@4.18.1`, then removed the `+sha512…` suffix so the field reads exactly `"packageManager": "yarn@4.18.1"` (the test regex requires that).
- `engines.node: ">=22.12 <23"`. `.yarnrc.yml` contains `nodeLinker: node-modules`. No `package-lock.json` exists.
- Scripts match the Interfaces exactly: `dev`, `build`, `build:engine-cli`, `test`, `lint`, `format:check`, `typecheck`. I added a `format` script that runs `prettier --write`.
- Every 01 §1.2 runtime package is installed. Exact pins: `three 0.186.1`, `@tresjs/core` and `@tresjs/cientos` `5.9.3`, `clipper2-ts 2.0.1-18`. P2's packages are already present: `zod ^4`, `mutative ^2.0`, `earcut ^3.2`, `flatbush ^4.6`, `nanoid ^5`.
- Other pre-1.0 packages are pinned exactly per 01 §1: `class-variance-authority 0.7.1`, `vue-input-otp 0.3.2` (the version the kit was built with; 0.4.0 is out), `@laravel/vite-plugin-wayfinder 0.1.11`, `prettier-plugin-tailwindcss 0.8.1`.
- `@vue/devtools-api` (a pinia peer) is a dependency. `@sentry/vue` (optional) is not installed, consistent with P1-D14.
- Dev packages (C3/C13): `vitest ^3` (3.2.7), `@vitest/coverage-v8 ^3`, `happy-dom` (replaces jsdom per C2), `@vue/test-utils`, eslint 10 with `@eslint/js`, `eslint-plugin-vue`, `@vue/eslint-config-typescript`, `typescript-eslint`, `vue-eslint-parser`, `eslint-config-prettier`, `prettier` + `prettier-plugin-tailwindcss`, `@axe-core/playwright ^4.10`, `culori ^4.0`, `@types/culori`, `concurrently`, `@types/three 0.186.0` (the only 0.186.x published), `@types/node ^22`, `typescript ^5.9`, `vue-tsc` (latest, 3.3.13), `vite ^8.3`, `@vitejs/plugin-vue`, `@tailwindcss/vite`.
- Playwright: `playwright`, `@playwright/test` and `playwright-core` are pinned to **1.63.0**, not 1.56.1. See Concern 1.

### Tooling
- **`tsconfig.json`:** `strict` and `noUncheckedIndexedAccess`, `@/*` mapped to `./resources/js/*`, includes `resources/js/**/*.{ts,d.ts,tsx,vue}` and `engine-cli/src/**/*.ts` (C13d, so `engine-cli/dist` is not checked). Two kit files needed type fixes under the new flags: `useInitials.ts` (noUncheckedIndexedAccess) and `useCurrentUrl.ts` (`any` replaced by generics).
- **`vitest.config.ts`:** standalone, using only the vue plugin and the `@` alias, so it never loads the laravel or wayfinder plugins (E6). It has two projects:
  - `engine`: node environment; includes `resources/js/engine/**/*.test.ts` and `engine-cli/src/**/*.test.ts`; excludes `**/__perf__/**`.
  - `app`: happy-dom; includes `resources/js/**/*.test.ts` minus the engine globs; setup file `resources/js/test/setup.ts`.
  - Coverage uses the v8 provider, with `reportsDirectory: build/coverage/js` and no thresholds yet (P2 Task 51 adds them).
  - `setup.ts` currently only shims `ResizeObserver` and `matchMedia`. The i18n install and the route() stub are left for later (Concern 6).
- **`eslint.config.js`** (flat config, built with `defineConfigWithVueTs`):
  - `vue` `flat/recommended` + `vueTsConfigs.recommended` + `eslint-config-prettier`.
  - `@typescript-eslint/no-explicit-any: error`.
  - `vue/no-v-html: error`, with an override that turns it off for `resources/js/components/orders/MessageBody.vue`.
  - `vue/no-bare-strings-in-template: error` with the allowlist `['×','—','·','/',':','%','+']`.
  - The 16 §7.2 Wayfinder URL `no-restricted-syntax` rule, for both `Literal` and `TemplateLiteral` nodes, on `resources/js/**`, excluding `__tests__`.
  - Global ignores: vendor, node_modules, public, storage, build, engine-cli/dist, Wayfinder output, `lang/generated`, `types/generated.d.ts`, docs, vision, .superpowers, and the kit's `components/ui/**`.
  - An exported `LEGACY_KIT_FILES` array (34 kit Vue files), used as a global ignore.
  - I checked every rule against a temporary probe file (since deleted). `any`, both URL forms, v-html, and bare strings were flagged; `×` was allowed; `MessageBody.vue` was allowed `v-html`.
  - P2 adds the engine purity blocks.
- **`.prettierrc`:** the kit's fmt options plus `prettier-plugin-tailwindcss` (`tailwindFunctions` clsx/cn/cva, `tailwindStylesheet`).
- **`.prettierignore`:** the generated directories (actions, routes, wayfinder, lang/generated, types/generated.d.ts, engine-cli/dist) plus the kit's `components/ui/` and `views/mail/`.
- **`pint.json`:** laravel preset with `declare_strict_types` and `final_class`. I ran Pint once over the kit code.
- **`phpstan.neon`:** larastan extension (the kit's carbon extension is kept), level 8, paths app, config, database, routes. There is no baseline. One level-8 finding was fixed: `ProfileValidationRules` return types now include `Stringable`. `tests/Support` is not in the paths yet because the directory does not exist; whichever task creates it should add the path.
- **`phpunit.xml`:** suites Unit, Feature and Browser, with the full 16 §2 env block:
  - `BROADCAST_CONNECTION=log`, `FILESYSTEM_DISK=s3`, Redis DBs 14/15/13, vision, Gotenberg and health tokens.
  - Blank `TURNSTILE_*`, `FEATURE_*=true`, `ENGINE_NODE_BINARY`, `UPLOADS_TESTING_LOCAL`.
  - A freshly generated test-only P-256 VAPID pair.
  - The brief's `DB_HOST`, `DB_USERNAME` and `DB_PASSWORD=furny`, all non-forced, so the CI env overrides them.
- **`tests/Pest.php`** (C2, 16 §3):
  - `TestCase` with `LazilyRefreshDatabase` in Feature.
  - `TestCase` with `RefreshDatabase` in Browser.
  - `TestCase` alone in Unit.
  - `pest()->browser()->timeout(15_000)`.
- **`tests/TestCase.php`** (16 §2): throws unless the DB driver is `pgsql`, fakes `s3` and `s3-public`, calls `Http::preventStrayRequests()` and `Pdf::fake()`.
- **TS transformer:** `App\Providers\TypeScriptTransformerServiceProvider` is the v3 README/`typescript:install` stub, registered in `bootstrap/providers.php`. It uses `AttributedClassTransformer` + `EnumTransformer` + the laravel-data extension over `app/`, and writes `resources/js/types/generated.d.ts` with `GlobalNamespaceWriter`. It has no formatter (the file is prettier-ignored) and no manifest file. The output is deterministic (same md5 across runs). See Concern 7.

### Engine stub and CLI
- `resources/js/engine/version.ts` exports `ENGINE_VERSION = '1.0.0'`; `index.ts` re-exports it.
- `engine-cli/src/cli.ts` exports:
  - the `CliResponse` union;
  - `dispatch(command, rawInput)`, with error codes `unknown_command` (checked first) and `invalid_json`;
  - `main()`, which reads all of stdin, writes the JSON response plus a newline, and sets exit code 0. `main()` runs only when the file is executed directly, not when it is imported.
- `engine-cli/vite.config.ts`: `build.ssr` entry, target `node22`, `ssr.noExternal: true` (all dependencies bundled), output `engine-cli/dist/cli.mjs` in ES format. `engine-cli/dist` is git-ignored.

### CI (`.github/workflows/ci.yml`)
Jobs `php`, `frontend`, `vision` and `browser` follow 17 §10.2 verbatim, with no `deploy` job. Changes from the verbatim text:

**C4 probes.** A probe step per job; each guarded step switches on automatically once its artefact exists:
- `audit-gate.sh`: Task 40.
- `i18n:export` command: Task 3, so Task 3 must not add a second i18n step.
- `testing:seed-catalog-snapshot`: unowned.
- `tests/Support/coverage-gate.php`: unowned.
- `bench:check` script: P2.
- `scripts/check-bundle-size.mjs`: unowned.
- `playwright.config.ts`: unowned.

**`vision` job.**
- Its first step, `id: probe`, runs with `working-directory: .` because `vision/` may not exist. It writes `present=true|false` from `test -f vision/pyproject.toml`.
- Every later step has `if: steps.probe.outputs.present == 'true'`; pip-audit additionally requires the audit gate to exist.
- The requirements staleness check uses the progress.md ruling's command: `uv export --no-header --no-dev --no-emit-project --frozen`.

**`php` job.** The Pest step is now `vendor/bin/pest --testsuite=Unit,Feature --parallel --ci --coverage-clover=…`. The spec's `pest tests/Unit tests/Feature --parallel` fails because paratest accepts a single path ("Too many arguments, expected arguments "path""). I confirmed `--testsuite=Unit,Feature --parallel` passes locally.

The `frontend` job's `wayfinder:generate --with-form` before ESLint is already part of the 17 text.

## Tests and results

### TDD evidence
**RED**
- Vitest: `npx vitest@3.2.4 run --root /home/user/furny-p1 --config <scratch config without imports>`, run on the raw kit copy after writing the tests (the kit's `vite.config.ts` imports `vite-plus`, which was not installed). All 3 files failed:
  - `pins yarn 4 via corepack`: `TypeError: .toMatch() expects to receive a string, but got undefined` (no `packageManager`).
  - `pins exact pre-1.0 packages`: `AssertionError: expected undefined to be '0.186.1'`.
  - `loads no fonts from third-party hosts`: `expected 'import inertia from '@inertiajs/vite…' not to match /bunny|fonts\.googleapis/`.
  - `engine/__tests__/version.test.ts`: `Cannot find module '../version'`.
  - `engine-cli/src/__tests__/cli.test.ts`: `Cannot find module '../cli'`.

  All of these were expected: no packageManager or pins yet, bunny fonts still present, engine files missing.
- Pest: `vendor/bin/pest` did not exist before `composer install`, as expected. After installing, before running Pint: `ArchTest › strict types` failed with `Expecting 'app/Models/User.php' to use strict types.` (expected; Pint's `declare_strict_types` fixes it).
- Browser: before the Pest plugin cache existed (Concern 3), `SmokeTest` failed with `WebSocket client is not connected.`

**GREEN** (final run, all at commit `bbfab4e`)
- `vendor/bin/pint --test`: passed.
- `vendor/bin/phpstan analyse --no-progress --memory-limit=1G`: `[OK] No errors`.
- `vendor/bin/pest tests/Unit tests/Feature`: `Tests: 7 passed (7 assertions)`. `--testsuite=Unit,Feature --parallel` also passes.
- `yarn lint` / `yarn format:check` / `yarn typecheck`: exit 0, exit 0, exit 0.
- `yarn vitest run`: `Test Files 3 passed (3)`, `Tests 7 passed (7)` (engine: version 1 + cli 3; app: package-manager 3).
- `yarn build`: client and engine CLI build OK. `echo '{}' | node engine-cli/dist/cli.mjs version | grep -q '"ok":true'` succeeds. Manual checks:
  - `version` → `{"ok":true,"result":{"engineVersion":"1.0.0"}}`;
  - `{` → `invalid_json`;
  - `nope` → `unknown_command`;
  - exit code 0 in every case.
- `php artisan typescript:transform && git diff --exit-code -- resources/js/types/generated.d.ts`: no diff.
- `yarn install --immutable`: OK.
- `PLAYWRIGHT_BROWSERS_PATH=<scratch alias dir> vendor/bin/pest tests/Browser`: `✓ it renders the welcome page without JS errors`, `Tests: 1 passed`. This run used a local-only browser alias (Concern 1).
- Test output is clean. The only noise is yarn's `@vue/compiler-dom` peer warning (vue provides it transitively) and Pest 5's agent-mode duplicate summary, which Pest prints because the `AI_AGENT` environment variable is set.

## Files changed
Everything is in the single commit `bbfab4e`: 275 files, mostly the kit copy, including the kit's 60+ `components/ui/*` files.
- **Created:** `.yarnrc.yml`, `yarn.lock`, `composer.lock`, `.prettierrc`, `.prettierignore`, `eslint.config.js`, `vitest.config.ts`, `engine-cli/{src/cli.ts,src/__tests__/cli.test.ts,vite.config.ts}`, `resources/js/engine/{index.ts,version.ts,__tests__/version.test.ts}`, `resources/js/__tests__/package-manager.test.ts`, `resources/js/test/setup.ts`, `resources/js/types/generated.d.ts`, `app/Providers/TypeScriptTransformerServiceProvider.php`, `.github/workflows/ci.yml`, `tests/{Pest.php,TestCase.php}`, `tests/Unit/{ArchTest,ComposerPlatformTest}.php`, `tests/Feature/HealthUpTest.php`, `tests/Browser/SmokeTest.php`.
- **Modified from the kit:** `composer.json`, `package.json`, `vite.config.ts`, `tsconfig.json`, `pint.json`, `phpstan.neon`, `phpunit.xml`, `.gitignore` (adds `/build`, `/engine-cli/dist`, `/tests/Browser/screenshots`, `/.yarn/*` with the usual exceptions, `/.pnp.*`), `.env.example` (DB block), `config/{fortify,inertia}.php`, `app/Models/User.php`, `app/Providers/FortifyServiceProvider.php`, `app/Concerns/ProfileValidationRules.php`, `bootstrap/providers.php`, `routes/web.php`, `resources/{css/app.css,views/app.blade.php,js/app.ts,js/types/auth.ts}`, `resources/js/components/UserMenuContent.vue`, `resources/js/composables/{useInitials,useCurrentUrl}.ts`, `resources/js/pages/{Welcome.vue,Auth/Login.vue,Auth/ConfirmPassword.vue}`, `database/factories/UserFactory.php`. Pint also added strict types and `final` across app, config, database, routes, bootstrap and `public/index.php`.
- **Not copied or deleted:**
  - chisel files and `InstallFeaturesCommand`;
  - `pnpm-workspace.yaml`, `.npmrc`, `.github/workflows/tests.yml`;
  - the passkeys migration and components;
  - the kit tests;
  - the settings area and the settings-only components listed above.
- **Kept for later tasks:** `.github/dependabot.yml` (Task 40 modifies it) and the kit `UserFactory` (I2: Task 4 deletes it).

## Concerns (controller ruling needed on 1; the rest are notes)
1. **Playwright pin conflicts with C3. I chose 1.63.0, not 1.56.1.**
   - `pestphp/pest-plugin-browser` v5.x refuses older Playwright: `PlaywrightNpmServer::PLAYWRIGHT_VERSION` is `1.61.1` in v5.0.0 and `1.63.0` in v5.1.1 and v5.1.2. Anything lower throws `PlaywrightOutdatedException`. 16 §2 requires that same Pest 5 plugin major, so "pin 1.56.1 (Chromium 1194)" cannot be satisfied together with Pest 5.
   - I pinned `playwright`, `@playwright/test` and `playwright-core` to 1.63.0, the plugin's minimum. CI's `yarn playwright install --with-deps chromium` fetches the matching Chromium (revision 1243).
   - Locally, the Playwright CDN is blocked. I verified the smoke test using a scratch `PLAYWRIGHT_BROWSERS_PATH` (`…/scratchpad/pw-browsers`) in which `chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell` symlinks to `/opt/pw-browsers/chromium_headless_shell-1194` (Chrome 141). It passed, but it is a local workaround, not the spec's setup. 16 §2 and §19 need a ruling: either accept 1.63.x plus the alias trick for local runs, or provide a newer local browser.
2. **CI Pest invocation** (described under CI above): `--testsuite=Unit,Feature` replaces `tests/Unit tests/Feature` because paratest accepts one path. Spec 16 §16/§19 and 17 §10.2 quote the two-path form with `--parallel`; it fails both locally and in CI.
3. **Local Composer runs as root**, so Composer plugins are disabled. As a result `vendor/pest-plugins.json` is never written, and the Pest browser, laravel and arch plugins are not booted (the browser tests fail with "WebSocket client is not connected"). Fix: `COMPOSER_ALLOW_SUPERUSER=1 composer dump-autoload` after any `composer install` or `require`; I ran it here. CI is unaffected because it does not run as root. **P2 and every later worktree need this note**, together with C13(b): run `composer install` + `php artisan wayfinder:generate --with-form` before `vue-tsc`.
4. **Pint from source pollutes the `App\` namespace.** Its git checkout contains an `app/` directory in namespace `App\`, which crashed the arch test ("Typed property … $path must not be accessed before initialization"). Locally I re-installed pint from a dist archive seeded with `composer-seed-dist laravel/pint v1.32.1 …` (`git archive` honours export-ignore) and ran `composer reinstall laravel/pint --prefer-install=dist`. CI (`--prefer-dist`) is unaffected. Another worktree running `composer install` from source will hit the same crash; the same two commands fix it.
5. **Disk space.**
   - The disk was full (28 MB free) on the first `composer update`.
   - To free space I deleted the 9.9 GB `~/.cache/composer/vcs/https---github.com-phpstan-phpstan` mirror, a regenerable cache created before this session; `phpstan/phpstan` installs from a seeded dist anyway.
   - Now 3.2 GB is free; the vendor directory alone takes 8.3 GB because of full git histories.
   - I did not touch `/tmp/skit2` (6.6 GB, a stale kit trial install from 22:57 that is not mine). The controller may want to reclaim it.
6. **Deferred from 16 §2–§4 (needs owners).**
   - `TestCase` does not yet bind `FakeWhatsAppClient`/`ArraySmsDriver` (P8) or reset the settings cache (Task 6).
   - `Pest.php` has no global expectations yet (`toBeUlid`, `toBeCamelCaseKeys`, `toMatchApiError`).
   - The Vitest `setup.ts` lacks the i18n install (Task 3) and the "Wayfinder-safe route() stub".
   - `phpstan.neon` will need `tests/Support` once that directory exists.
7. **`generated.d.ts` is not empty.** The laravel-data extension (needed for proper Data class transformation) emits Illuminate and laravel-data paginator helper types. Data classes are transformed whether or not they carry `#[TypeScript]`, which matches 14 §19.
8. **Vision requirements step.** It uses the progress.md ruling's flags (`--no-header`, without `--no-hashes`). P3's current `vision/requirements.txt` was exported with a header and `--no-hashes`, so P3 must regenerate the file with the same flags, or adjust the CI step when it removes the guard.
9. **Minor.** `vue-input-otp` is pinned to the kit-tested 0.3.2 rather than the latest 0.4.0. ESLint and Prettier keep the kit's ignore of `components/ui/**`. `vue/multi-word-component-names` is off, since kit and Furny page names such as `Login.vue` and `Index.vue` are single words.

---

## Fix round 1 (commit `b2c3243`)

### What changed
1. **(Important) The built CLI now always runs `main()`.**
   - New file `engine-cli/src/main.ts` imports `main` from `./cli` and calls `void main()`.
   - `engine-cli/vite.config.ts` now uses `build.ssr` = `src/main.ts`. The output name is still `engine-cli/dist/cli.mjs` (set by `entryFileNames`).
   - `cli.ts` no longer starts anything on import. The `import.meta.url` vs `process.argv[1]` check and the `pathToFileURL` import are gone. It still exports `dispatch`, `main` and `CliResponse`.
2. **(Minor) Third-party font removed.** `resources/js/pages/Welcome.vue` no longer has the `rsms.me` preconnect and stylesheet links; it now renders `<Head title="Welcome" />`. The font test checks `Welcome.vue` too, and its regex is now `/bunny|fonts\.googleapis|rsms\.me/`.

### New test
`engine-cli/src/__tests__/build.test.ts` runs in the `engine` project:
- It builds the real bundle with the same config into a temp directory: `node node_modules/vite/bin/vite.js build --config engine-cli/vite.config.ts --outDir <tmp>/dist`.
- It symlinks `<tmp>/linked` to `<tmp>/dist`.
- It runs `node <entry> version` with `{}` on stdin twice, once through `dist/cli.mjs` and once through `linked/cli.mjs`. Each run must print `{"ok":true,"result":{"engineVersion":"1.0.0"}}`.
- It builds into a temp directory, so it does not depend on `yarn build` having run first. That matters because the CI frontend job runs Vitest before the build.

### TDD evidence
**RED** (tests written before the fix): `yarn vitest run` gave `Tests 2 failed | 7 passed (9)`.
- `built engine CLI > answers on stdout when run through a symlinked directory`: `SyntaxError: Unexpected end of JSON input`. stdout was empty because the old guard skipped `main()`.
- `loads no fonts from third-party hosts`: `expected '<script setup lang="ts">…' not to match /bunny|fonts\.googleapis|rsms\.me/`.

The direct, non-symlinked run passed already, which confirms the bug only occurs through a symlink.

**GREEN:**
- `yarn vitest run`: `Test Files 4 passed (4)`, `Tests 9 passed (9)`; `build.test.ts` took 319 ms.
- `yarn build` produced `engine-cli/dist/cli.mjs` (1.46 kB). The CI smoke command `echo '{}' | node engine-cli/dist/cli.mjs version | grep -q '"ok":true'` passed. Running the same command through a symlinked `dist` directory printed `{"ok":true,"result":{"engineVersion":"1.0.0"}}`.
- `yarn lint` = 0, `yarn format:check` = 0, `yarn typecheck` = 0.
- Pint passed, Larastan `[OK] No errors`, `pest tests/Unit tests/Feature` 7 passed, and `pest tests/Browser` 1 passed (with the same local Chromium workaround as before).

### Files
- `engine-cli/src/main.ts` (new)
- `engine-cli/src/cli.ts`
- `engine-cli/vite.config.ts`
- `engine-cli/src/__tests__/build.test.ts` (new)
- `resources/js/__tests__/package-manager.test.ts`
- `resources/js/pages/Welcome.vue`
