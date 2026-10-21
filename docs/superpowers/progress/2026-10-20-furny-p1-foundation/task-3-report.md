# Task 3 report: i18n layer (trans_icu, i18n:export, t())

Status: DONE (commit cb40aff `feat(i18n): ICU translation layer with trans_icu, i18n:export and t()`, base c6cb419). Not pushed.

## Implemented
- `app/Support/I18n/helpers.php` (composer `autoload.files`): `trans_icu()` per 15 §15.3. Missing key, a key naming a group, or an unformattable message returns the key and logs one `Log::warning`.
- `app/Console/Commands/ExportTranslations.php` (`i18n:export`): loads every ICU namespace file of each `app.supported_locales` locale, skips auth/pagination/passwords/validation, flattens, validates each with `MessageFormatter::create` (error lists `locale: key ... (ICU message)`), sorts, writes `en.json` and `manifest.json` (`{"en": sha1}`) with PRETTY_PRINT|UNESCAPED_UNICODE|UNESCAPED_SLASHES. All messages are validated before anything is written, so a failing run leaves the committed output untouched. Non-ICU shorthand such as `{n?}` is rejected.
- `resources/lang/en/`: the 4 Laravel files (published, moved from `lang/`; Pint added `declare(strict_types=1)`), `common.php` with the keys in the brief, and 42 other namespace files returning `[]`.
- `bootstrap/app.php`: `useLangPath(resourcePath('lang'))` explicitly (Laravel 13 would auto-detect it anyway).
- `resources/js/lib/i18n.ts`: `createI18n({locale, messages, timeZone?, numberLocale?})` returns a plugin with `t/has/locale`; installs `$t` and provides `I18N_KEY`. `IntlMessageFormat` instances are cached per key (a compile failure is cached too). Missing top-level `{name}` arguments render as '' with a dev warning; arguments inside select/plural branches are filled with '' silently. Missing key, invalid ICU, or a format error returns the key, so `t()` never throws. `timeZone` is applied to the short/medium/long/full date and time styles; `numberLocale` is used as the formatting locale.
- `resources/js/composables/useI18n.ts` (throws a clear error if the plugin is not installed), `$t` typing in `types/global.d.ts`.
- `resources/js/test/setup.ts`: installs the plugin with the generated `en` messages globally for `@vue/test-utils`.
- `resources/js/app.ts`: reads the locale from the initial page JSON (`page.props.i18n.locale`, fallback `en`), loads `./lang/generated/{locale}.json` through lazy `import.meta.glob` (top-level await, because `withApp` is synchronous), and `app.use(createI18n(...))` in `withApp`. Stale-hash reload is left to Task 20.
- `vite/i18n-watch.ts` (serve only) wired in `vite.config.ts`: `resources/lang/**/*.php` add/change/unlink, 300 ms debounce, runs `php artisan i18n:export`, then full reload (errors are logged). Verified with a throwaway Vite server: 3 rapid edits produced one reload.
- Generated `resources/js/lang/generated/{en,manifest}.json` committed.

## Rulings applied
- C4: the php job in `.github/workflows/ci.yml` already holds the "Generated i18n JSON is current" step (17 §10.2) guarded by an `i18n:export` probe. I added no second step and did not touch the file; the probe turns the step on now that the command exists.
- C13(d): the six P2-owned lang files (`engine, parts, hardware, issues, changes, templates`) are NOT created; the export tolerates their absence (it scans the directory).
- C2: `TransIcuTest` is in Unit and uses the app TestCase (Pest.php).
- Test-helper note: no global functions or constants in the new test files.

## TDD evidence
- RED: `vendor/bin/pest tests/Unit/I18n tests/Feature/I18n` gave 12 failed (`trans_icu` undefined, `The command "i18n:export" does not exist.`). `yarn vitest run resources/js/lib resources/js/__tests__/i18n-keys.test.ts` gave 2 failed files (`@/lib/i18n` and `en.json` do not resolve).
- GREEN: same commands pass: Pest `12 passed (65 assertions)`; Vitest 2 files, 14 tests.

## Gates
- Gates-PHP: `pint --test` passed; `phpstan` `[OK] No errors` (one `@phpstan-ignore identical.alwaysFalse` with a comment, because the intl stubs do not allow `MessageFormatter::create` to return null); `pest tests/Unit tests/Feature`: 56 passed (265 assertions).
- Gates-JS: `yarn lint`, `format:check`, `typecheck` clean; `yarn vitest run`: 6 files, 23 tests passed, output pristine; `yarn build` succeeds.
- Gates-Gen: `typescript:transform` and `i18n:export` produce no diff (checked after the commit state).

## Files changed
app/Support/I18n/helpers.php; app/Console/Commands/ExportTranslations.php; resources/lang/en/*.php (47 files); resources/js/lib/i18n.ts; resources/js/composables/useI18n.ts; resources/js/lang/generated/{en,manifest}.json; vite/i18n-watch.ts; composer.json (autoload.files; composer.lock unchanged); bootstrap/app.php; vite.config.ts; resources/js/app.ts; resources/js/test/setup.ts; resources/js/types/global.d.ts; tests/Unit/I18n/TransIcuTest.php; tests/Feature/I18n/ExportTranslationsTest.php; resources/js/lib/__tests__/i18n.test.ts; resources/js/__tests__/i18n-keys.test.ts.

## Notes for the reviewer
- `i18n-keys.test.ts`: `ENUM_KEY_PATTERNS` is empty. The union-member reader is unit-tested on a sample string so it is not vacuous once Task 18 adds entries. Key scan covers `t('…')`, `$t('…')`, `i18n.t('…')`, `labelKey:` and `titleKey:` string literals (dotted word characters only).
- The spy test reloads `@/lib/i18n` with `vi.resetModules()` because the setup file has already imported the real module.
- `i18n.ts` hard-codes the ICU AST element kinds (argument 1, select 5, plural 6, tag 8) to avoid importing the transitive `@formatjs/icu-messageformat-parser` package; the unit tests pin the behaviour.
- Date skeleton arguments (`{at, date, ::yyyyMMdd}`) do not get the configured time zone; only the named styles do. Not needed yet.
- `app.ts` has no test (bootstrap code); it type-checks and builds.

## Fix round 1
Commit: see `git log` (`fix(i18n): apply the user time zone to every date/time argument; survive a failed locale load`).
1. Time zone: removed `zonedFormats`; `createI18n` now passes `{ formatters }` (4th `IntlMessageFormat` argument) when `timeZone` is set. `getDateTimeFormat` builds `Intl.DateTimeFormat(locales, { timeZone, ...options })` with a per-instance cache; number formats and plural rules are plain Intl. This covers named styles, bare `{at, date}` and skeletons. New tests (Asia/Kolkata, 2026-03-01T23:30Z): named styles, bare date (`3/2/2026`), `::yyyyMMMd` (`Mar 2, 2026`), `::hm` (`5:00`), and a UTC control (`3/1/2026`, `Mar 1, 2026`, `11:30`). They also pass with `TZ=America/Los_Angeles`.
2. `app.ts`: `loadMessages` catches a failed dynamic import and returns `{}` (app boots with keys); the glob now excludes `manifest.json`.
Evidence: `yarn vitest run` 6 files / 26 tests passed (i18n.test.ts 13); `TZ=America/Los_Angeles yarn vitest run resources/js/lib` 13 passed; `vendor/bin/pest tests/Unit/I18n` 5 passed; `yarn lint`, `format:check`, `typecheck`, `yarn build` clean.
Known gap carried over: the earlier "skeletons do not get the time zone" note is now obsolete.
