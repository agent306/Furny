# Task 2 report — Configuration foundation, feature flags, domain skeleton

Status: DONE_WITH_CONCERNS. Commit: c6cb419 `feat(config): feature flags, queue/redis/session/storage config and domain skeleton` (base b2c3243). Worked in /home/user/furny-p1.

## Implemented
- `app/Support/Features.php` (`enabled()`, `all()`, `FLAGS` in the required order; `web_push` forced off without both VAPID keys, `captcha` derived from both Turnstile keys, unknown flag throws `InvalidArgumentException`), `app/Support/AppVersion.php`.
- `config/features.php` (raw env switches, no app dependency), `config/engine.php`, `config/imports.php` (verbatim 06 §4.1), `config/notification_events.php` (categories verbatim 12 §5.1, `events => []`), `config/cors.php` (`paths => []`), `config/telescope.php` (published from the package, see concerns).
- Modified: `config/app.php` (`version`, `supported_locales`, maintenance store default `redis`; timezone already `UTC`), `database.php` (`sessions` Redis connection DB `REDIS_SESSION_DB` default 2, prefix default `furny_`, default connection `pgsql`), `session.php` (redis/sessions/encrypt defaults, cookie `furny_session`), `cache.php` (redis, prefix `furny_cache_`), `queue.php` (`redis` retry_after 180, `redis-long` retry_after 720 queue `imports`, fixed values, no env override), `filesystems.php` (`s3`, `s3-public` per 17 §5.11 item 6), `mail.php` (SES removed, postmark `message_stream_id`, roundrobin postmark+resend), `services.php` (postmark token, resend key, turnstile, google, whatsapp; SES removed).
- `bootstrap/app.php`: `trustProxies(at: env('TRUSTED_PROXIES', …), headers: XFF|HOST|PORT|PROTO)`, `preventRequestsDuringMaintenance(except: ['up','up/deep'])` (`health: '/up'` already present).
- `AppServiceProvider`: conditional registration of the package and app Telescope providers (`class_exists && config('telescope.enabled')`); boot-time warning when `mb_strlen(app.name) > 20`.
- `app/Providers/TelescopeServiceProvider.php` created (C6); not in `bootstrap/providers.php`. Gate denies everybody until Task 13/22 define the owner/admin gate.
- `.env.example`: every 17 §6.1 variable with its Local value (secrets empty). Local untracked `.env` regenerated from it (kept APP_KEY, DB_PASSWORD=furny).
- `app/Domain/{10 areas}/{8 dirs}/.gitkeep` (80 files).

## Rulings applied
- C2: env-dependent assertions evaluate config files in a clean child process (`evaluateConfigFile()` helper appended to `tests/Pest.php`, uses `new Application(getcwd())` so `database_path()` etc. work): features defaults, Redis DB defaults 0/1/2, filesystem `region === 'auto'` / path style (because `.env.example` says `AWS_DEFAULT_REGION=us-east-1`, which would leak via `.env`). App-level assertions compare against `env('REDIS_SESSION_DB', 2)`.
- C6: Telescope provider created by Task 2.
- I4: Task 2 is the sole owner of session/redis config. I12: `BootWithoutServicesTest` labelled as boot purity (17 §5.11 item 3), no "Review Focus" label.
- Progress ledger rulings (Pest parallel, composer) not affected.

## Tests (TDD)
- RED, command `vendor/bin/pest tests/Unit/Support tests/Feature/Config tests/Unit/ArchTest.php` before any implementation: `Tests: 30 failed, 9 passed` (4x `Class "App\Support\AppVersion" not found`, Features child process failing on missing `config/features.php`, missing config keys, missing `.env.example` variables, missing domain directories). The 9 passing were regression guards that hold on the stock framework (boot-purity x2, no-closure, `/up` 200, `/` 503, no APP_TIMEZONE, strict types, no debug calls, name <=20 quiet).
- GREEN, same command after implementation: `Tests: 39 passed (195 assertions)`.
- Full: `vendor/bin/pest tests/Unit tests/Feature` -> 44 passed (200 assertions); `vendor/bin/pest --testsuite=Unit,Feature --parallel` (CI form) -> 44 passed. `vendor/bin/pint --test` passed; `vendor/bin/phpstan analyse` -> [OK] No errors (Gates-PHP all green).
- Manual checks: `TELESCOPE_ENABLED=true php artisan route:list` shows telescope routes and `optimize` works with it enabled; trusted-proxy behaviour (XFF honoured from 10.x, ignored from 8.8.8.8) verified with a throwaway test (deleted; Task 22 owns `TrustedProxiesTest`).

Test files: `tests/Unit/Support/{FeaturesTest,AppVersionTest}.php`, `tests/Feature/Config/{ConfigValuesTest,EnvExampleTest,BootWithoutServicesTest,MaintenanceModeTest}.php`, `tests/Unit/ArchTest.php` (extended), `tests/Pest.php` (helper). `ConfigValuesTest` also covers the app-name warning (both sides).

## Deviations / concerns for the reviewer
1. `.env.example` omits the seven nixpacks-only variables of the last 17 §6.1 row (`PHP_UPLOAD_MAX_FILESIZE`, `PHP_POST_MAX_SIZE`, `PHP_MEMORY_LIMIT`, `PHP_MAX_EXECUTION_TIME`, `NGINX_CLIENT_MAX_BODY_SIZE`, `NIXPACKS_PHP_ROOT_DIR`, `PHPRC`): the row says "set in nixpacks.toml, do not set in Coolify", and an empty `PHPRC` loaded into the process env by Laravel would be inherited by child PHP processes. Noted in a comment in the file and in the test docblock.
2. `config/telescope.php` was added (not in the brief's file list): with `dont-discover` the package provider never merges its config, so `config('telescope.enabled')` would always be null. Default `TELESCOPE_ENABLED` is `false` (safe), DB connection default `pgsql`.
3. `features.whatsapp` / `features.google_login` are plain env switches as in the brief and master §6.7. 12 §7.2 says `features.whatsapp` should also require the driver credentials; I did not add that because 16 §2 sets `FEATURE_WHATSAPP=true` in the test env without credentials (it would turn the flag off in every test). Task 8/P8 can add it if wanted.
4. `services.php` has turnstile, google, whatsapp, postmark, resend; Twilio/MSG91 SMS config is left to the SMS task (package-specific key names).
5. `Features::enabled()` throws on an unknown flag name rather than returning false.
6. `config/app.php` defines two top-level locals (`$appVersion`, `$sourceCommit`) to satisfy PHPStan level 8 (`env()` returns `bool|string|null`); they live in Laravel's config-loading scope.
7. Defaults in config files were moved to the spec values (cache `redis`, queue `redis`, session `redis`/encrypted, DB `pgsql`) so a missing `.env` still boots as the spec describes; prefixes/cookie defaults hard-code `furny_*` instead of slugging `APP_NAME` (17 §6.1 "fixed so renaming APP_NAME never orphans keys").
8. Maintenance test binds a fake `MaintenanceMode` instead of `artisan down`, to avoid writing `storage/framework/down` (would 503 parallel workers).
