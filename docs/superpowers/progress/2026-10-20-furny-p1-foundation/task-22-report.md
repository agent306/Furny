# Task 22 report: HTTP hardening

Commit: `113f606 feat(security): security headers with CSP nonce, PII log redaction and named rate limiters` (base d6f8763).
Trailer used: the harness attribution lines (`Co-Authored-By: Claude Sonnet 5.5`, `Claude-Session: ...01X1MLnD93h3fkmdHrLPbw3u`), per context.md ("use your own attribution lines if your system prompt provides them"). The dispatch message named Opus 5.5; amend the trailer if the project wants that.

## Implemented

| Area | Where |
|---|---|
| Security headers + CSP nonce | `app/Http/Middleware/SecurityHeaders.php`; `config/security.php` (`csp.*`) |
| CSP report endpoint | `app/Http/Controllers/CspReportController.php`, route `csp.report` in `routes/web.php` |
| 25 named limiters | `app/Providers/RateLimitServiceProvider.php`, `app/Support/Http/RateLimitKey.php`, `config/security.php` (`rate_limits`) |
| 429 rendering | `app/Support/Http/RateLimitedResponse.php`, registered in `bootstrap/app.php`; `errors.rate_limited` in `resources/lang/en/errors.php` |
| Masking / redaction | `app/Support/Privacy/Mask.php`, `app/Support/Logging/{RedactPiiProcessor,TapRedaction}.php`, `tap` on every channel + new `security` channel in `config/logging.php` |
| Misc | `config/inertia.php` history encryption; `dontFlash`; CSRF except `csp-report`, `webhooks/*`; `Pulse::user`; Telescope hidden params/headers; `URL::forceScheme('https')` in production (13 §12.8); `app.blade.php` nonce on the Inertia page data script |
| Shared helper | `app/Support/Http/StatelessRoute.php` (the web-group middleware list a stateless route removes; now used by the manifest and csp-report routes) |

### Rulings applied

- **429 for Inertia**: redirect back plus `Inertia::flash('error', trans_icu('errors.rate_limited', ['seconds' => $s]))`, no session flash. Test asserts the next Inertia visit carries top-level `flash.error`, the shared props have no `flash`, and it is gone on the visit after. If the previous URL equals the throttled URL (a reload) or there is no session, it falls through to the Error page instead of redirecting into a loop.
- **Nonces**: theme script (already), Vite tags (`Vite::useCspNonce`), and the Inertia page bootstrap. `<x-inertia::app />` emits `<script data-page="app" type="application/json">` with no nonce attribute and no way to add one, so `app.blade.php` now writes that tag out (same JSON, `JSON_HEX_TAG`, same `#app` div) with the nonce. This bypasses the component's SSR dispatch. SSR is off in v1 (C1 ruling 6, `01 §3`). Test: every `<script` tag of the first-load HTML, with a real Vite instance on a hot file, and of the 404 Error page, carries the nonce. `style-src` keeps `'unsafe-inline'`.
- **Where SecurityHeaders applies**: global middleware, **prepended** (outermost), not the `web` group. The bare-404 route (`unmatched.plain`), `/up`, the stateless manifest, 405s from the router, JSON/API routes and the maintenance 503 are all outside or before the web group; spec 13 §12.1 says "also applied to error pages" and D28 says Laravel owns the headers on all PHP responses. CSP is added only to HTML responses (not 204/304, not JSON/plain/downloads); the other headers go on everything. Tests cover manifest, `/build/*`, `/x.png`, `/api/missing`, `/up`, 405, JSON route. This deviates from spec 14 §1's web-group ordering list (log in 19).
- **CSP report**: stateless (no session, no cookie), so a report flood cannot create sessions. Never logs the raw body: bodies over 64 KB or not valid `{"csp-report": {...}}` log only `{unreadable, bytes}`. Otherwise a whitelist of fields (`document-uri`, `referrer`, `blocked-uri`, `source-file`, `violated-directive`, `effective-directive`, `disposition`, `status-code`, line/column) with every URL reduced to `scheme://host[:port]/path` (query, fragment and credentials dropped), values capped at 300 chars, JSON capped at 2048 bytes. `original-policy` and `script-sample` are dropped. Logged via `Log::channel('security')->warning('csp.violation', ['report' => ...])`.
- **Rate-limit keys**: email is Unicode-folded (NFKC), trimmed, lower-cased; phone is parsed with libphonenumber (default region = business `address.country_code`, else IN) and formatted E.164, unparseable falls back to `+digits`. Both are sha256-hashed in the key (no PII in cache keys, master constraint). Every limit of a limiter gets its own key (`<window>|<kind>:<value>`), otherwise e.g. `uploads-presign` 30/min and 300/day by the same user would share one counter. A missing email/phone/login id never shares one global bucket: guests key by IP.
- **Redaction tap**: on `stack`, every concrete channel and `security`. The `stack` needs its own tap (a stack logger has its own processors and only borrows child handlers). The `security` channel is a stack (`LOG_SECURITY_STACK`, default `LOG_STACK`) named `security` so records read `security.WARNING`. `emergency` has no driver config and is not tapped. Real `Log::` calls through stack and child, direct child, `security` and `daily` are tested against a temp file.
- **Fortify limiters**: moved to `RateLimitServiceProvider`; `FortifyServiceProvider` no longer defines them. Tested with a real `POST /login` (success, then 6th attempt 429 across five case/whitespace variants of the email, and the right password refused while throttled) and `POST /two-factor-challenge` (6th call per `login.id` is 429, another login id is not).

## Tests

New: `tests/Feature/Security/{SecurityHeadersTest,CspReportTest,TrustedProxiesTest,CookieFlagsTest,RateLimitersTest,LogRedactionTest,HttpHardeningTest}.php`, `tests/Unit/Privacy/MaskTest.php`, `tests/Unit/Logging/RedactPiiProcessorTest.php`, `tests/Browser/CspTest.php` (real Chromium under the enforced CSP: public pages have a clean console; an inline script without the nonce is blocked, one with it runs).
Changed: `tests/Feature/Ui/AppearanceCookieTest.php` ("none otherwise" case: SecurityHeaders now always shares a nonce, so the test asserts the header's nonce reaches the theme script and that the view renders without a nonce when none is shared).

### TDD evidence

- RED: `vendor/bin/pest tests/Unit/Privacy tests/Unit/Logging tests/Feature/Security` before any implementation: `Tests: 163 failed, 22 passed` (class `Mask`/`RedactPiiProcessor` missing, `config/security.php` missing, no CSP header, no limiters, etc.). The 22 that passed are characterisation tests of behaviour that already held (cookie encryption exemption, session cookie flags under test config, trusted-proxy resolution, no cookies on the manifest).
- GREEN: same command after implementation: `Tests: 185 passed (686 assertions)`.
- Failures found and fixed on the way: `ErrorPage::render` replaced my 429 JSON for `csp-report` (it only knew `api/*`), so the machine-path list moved to `ErrorPage::MACHINE_PATHS` and is shared by `shouldRenderJsonWhen`, `ErrorPage::handles` and `RateLimitedResponse`; `Log` records were named `testing` not `security` until `'name' => 'security'` was set; the Symfony test client sends `Accept: text/html`, so the XHR test now sends `Accept: */*` like a real XHR.

### Gates

- `vendor/bin/pint --test`: passed. `vendor/bin/phpstan analyse`: `[OK] No errors`.
- `vendor/bin/pest tests/Unit tests/Feature`: `2018 passed (8013 assertions)`.
- Gates-Gen: `php artisan i18n:export` regenerated `resources/js/lang/generated/{en,manifest}.json` (new key `errors.rate_limited`, committed); `typescript:transform` leaves `generated.d.ts` unchanged.
- `yarn vitest run`: 1084 passed. Pest Browser (after `yarn vite build`, PLAYWRIGHT_BROWSERS_PATH workaround from Task 1): the 40 existing tests pass with the CSP enforced, and the 5 new ones in CspTest pass.

## Files changed

Created: `app/Http/Controllers/CspReportController.php`, `app/Http/Middleware/SecurityHeaders.php`, `app/Providers/RateLimitServiceProvider.php`, `app/Support/Http/{RateLimitKey,RateLimitedResponse,StatelessRoute}.php`, `app/Support/Logging/{RedactPiiProcessor,TapRedaction}.php`, `app/Support/Privacy/Mask.php`, `config/security.php`, the test files above.
Modified: `app/Providers/{AppServiceProvider,FortifyServiceProvider,TelescopeServiceProvider}.php`, `app/Support/Http/ErrorPage.php`, `bootstrap/{app,providers}.php`, `config/{inertia,logging}.php`, `resources/lang/en/errors.php`, `resources/views/app.blade.php`, `routes/web.php`, generated lang JSON, `tests/Feature/Ui/AppearanceCookieTest.php`.

## Self-review

- `config/security.php` is closure-free (ConfigValuesTest passes), parse_url only, no I/O. The s3 private origin also handles virtual-hosted style (`bucket.host`) when no `AWS_URL` is set; ports are kept in origins (CSP host-source without a port only matches default ports, so `localhost:9000` would otherwise be blocked).
- Extra beyond the brief: `csp.reverb_port` (non-default Reverb port is appended to the host; `ws://`/`http://` Reverb origins only when local), Telescope now hides always (the old early return for `local` is gone, spec 13 §16 rule 4 has no exception), `URL::forceScheme('https')` in production, `webhooks/*` and `csp-report` count as machine paths for JSON errors.
- The `api` limiter's guest rule is expressed as a `guest` sub-array on the single limit (`{max: 60, key: ip}`), since the brief's `{per,max,key}` shape has no way to say "different for guests".

## Concerns / carry

1. **Dashboards under strict CSP.** `SecurityHeaders` applies the 13 §12.1 CSP to every HTML response, including Horizon, Pulse (Livewire) and Telescope, which ship inline scripts/styles without our nonce and load fonts from bunny.net. They will likely render partly broken for staff in production. Not special-cased because the spec does not carve out an exception; needs an owner ruling (exempt `horizon*`, `pulse*`, `telescope*` paths from CSP, or use report-only for them).
2. **Spec 14 §1 says SecurityHeaders sits in the `web` group** (after `AddLinkHeadersForPreloadedAssets`); it is global and outermost here (reasons above). Log in 19.
3. Redaction regexes follow 13 §16 literally: the key pattern contains `code`, so context keys like `status_code`/`country_code` are redacted too, and the phone pattern `\+?\d[\d\s-]{8,}\d` also matches long digit runs such as `2026-10-21 12`. Keep context key names in mind (use `statusCode`-style names only if that matters) or tighten the spec.
4. The root Blade view no longer uses `<x-inertia::app />`; if SSR is ever enabled (C1 turned it off), the SSR body path must be re-added to `app.blade.php`.
5. Rate-limit `phone` and `email` keys read the request fields `phone` and Fortify's username (`email`). Tasks 24/25/26 must use those field names (or extend `RateLimitKey`) when they wire `throttle:otp-*`/`password-reset`; `password.email` must still apply its limiter silently per C9 (the named limiter itself is registered here).
6. `autosave` (`user_doc`) keys on user, route name and all route parameters; revisit when the real routes (03 §5) exist.
7. Trailer: Sonnet 5.5 attribution lines were used (see top).

## Fix round 1

Commit: see `git log` (`fix(security): redact exceptions and objects, validate CSP origins, relax dashboard CSP`, on top of 113f606). Trailer: harness lines (accepted).

### Important

1. **Exceptions and objects bypassed redaction.** Two layers now. `RedactingFormatter` (new) wraps the formatter of every handler from `TapRedaction` and masks e-mails and phones in whatever the formatter writes: exception messages, previous exceptions, QueryException SQL/bindings, stack-trace arguments, any stringified object. It is applied once per handler (stack children share handlers). `RedactPiiProcessor` additionally reduces `Model` (`attributesToArray`), `Arrayable`, `JsonSerializable` and `Stringable` context values to masked arrays/strings (depth-limited); `Throwable` stays an object so error trackers still get it. Tests through real channels: `report()` with an email and a phone, a QueryException with bound values, trace args (with `zend.exception_ignore_args=0`; the test first asserts the raw trace holds the email), a Model, an anonymous Stringable, an ArrayObject; one test checks the formatter is wrapped exactly once.
2. **CSP origin injection.** `config/security.php` accepts an origin only if the raw value matches `^https?://[A-Za-z0-9.-]+(:\d{1,5})?([/?#]|$)`, has no whitespace, `;`, `,` or `*`, no userinfo, and `parse_url` agrees; REVERB_HOST must be `^[A-Za-z0-9.-]+$`, REVERB_PORT 1..65535 digits. Otherwise the value is null and the variable name goes to `csp.rejected`; `AppServiceProvider::boot()` logs one warning naming the variables (never the values). Tests: 17 rejected values including `;script-src *`, `https://files.example.com *`, `https://*`, `ws.example.com; script-src *`, `javascript://`, `:80a`, a newline injection; valid values kept; nothing of a rejected value reaches the header; warning once / quiet. (The config file stays closure-free.)
3. **Data-page escaping.** New `tests/Feature/Security/InertiaPageEscapingTest.php`: props and a flash holding `</script><script>alert(1)</script>` leave no raw `</script>` inside the block (count of `</script>` equals count of `<script`), the JSON round-trips and contains `<\/script>`; invalid UTF-8 renders with U+FFFD. `app.blade.php` now uses `JSON_HEX_TAG | JSON_INVALID_UTF8_SUBSTITUTE`. Mutation check: dropping HEX_TAG fails 2 of 3, dropping the substitute flag fails 1 of 3.

### Rulings

4. **Dashboards**: `/horizon*`, `/pulse*`, `/telescope*` (paths read from `horizon.path`, `pulse.path`, `telescope.path`, exact or `path/*`) get `script-src 'self' 'unsafe-inline'` (no nonce, no strict-dynamic, no Turnstile) and the usual `style-src` with `'unsafe-inline'`; `default-src`, `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'` are unchanged; report-only follows. Tests: 7 dashboard paths relaxed; 9 other paths (`/horizons`, `/horizon-x`, `/pulsed`, `/x/horizon`, `/admin`, …) strict; custom paths honoured. **Log for 19:** CSP is relaxed for the three vendor dashboards (they use inline scripts we cannot nonce); their fonts from fonts.bunny.net are still blocked by `style-src`/`font-src` (cosmetic).
5. **Redaction over-matching.** Keys are split into words (camelCase and `_ - ` separators); a key is sensitive if any word (or its singular) is `password passwd token secret otp authorization cookie session apikey`, or `api`+`key`, or `code`/`codes` unless the preceding word is a harmless qualifier (`status http country error response exit currency postal zip language locale dial area region state reason line file event item sku hs`). Kept: `status_code`, `http_code`, `statusCode`, `encoded`, `keyboard`, `tokenizer`. Redacted: `code`, `otp`, `otp_code`, `verification_code`, `recovery_codes`, `promo_code`, `accessToken`, `X-Api-Key`, `sessionId`. The phone pattern now has a date/time alternative that is matched first and kept, cannot start inside a word, number or hyphenated code, uses only spaces, hyphens and brackets as separators, needs 9 to 15 digits, and a number without `+` must be written grouped (so bare 10-digit ids and timestamps are left alone). Positive and negative cases tested (ISO date, datetime with fraction and zone, time, unix timestamps, 12-digit id, ULID, order number, file(line), bare ten digits; a phone right after a date is still masked).

### Minor

6. CSP report masks token path segments: segments the app's routes name `{token}` or `{hash}` (`reset-password/[token]`, `email/verify/{id}/[token]`, and any route defined later, read from the route collection per report), plus any opaque `[A-Za-z0-9_-]{32,}` segment that is not a UUID (catalog import and MSG91 tokens). ULIDs and UUIDs stay readable. The old test that kept the token now expects `[token]`.
7. Tests: multi-value `X-Forwarded-For` (client + trusted proxies, client-supplied prefix ignored, all hops trusted, untrusted peer) and headers (all, CSP with nonce, HSTS in production) on the maintenance-mode 503.
8. `RateLimitKey::email()` and `::phone()` return null for empty/non-string/unparseable input (e-mail must pass `FILTER_VALIDATE_EMAIL` with unicode allowed; phone must parse with libphonenumber); those requests key on `guest:<ip>` for the `email`, `email_ip` and `phone` kinds.
9. IPv6 addresses in `ip`, `email_ip` and guest keys are reduced to their /64; IPv4 is unchanged. Tested.
10. `CspReportController` refuses a declared `Content-Length` above 64 KB before reading the body (logs `{unreadable: too_large, bytes}`).
11. Comments added in `config/logging.php` (emergency, `Log::stack`) and `TapRedaction`: `Log::stack([...])` builds a logger without a tap, so only the handler-level masking applies to it (children's handlers keep their wrapped formatters); the emergency logger is not tapped.
12. `.env.example` note: real AWS S3 needs `AWS_URL` so the CSP has an origin; invalid values are ignored with a warning. **Carry for Tasks 24 to 26 and logout:** call `Inertia::clearHistory()` on logout, account deletion and session revocation of the current session (13 §12.4). Nothing in this task calls it.

### Results

- `vendor/bin/pest tests/Unit tests/Feature`: 2155 passed (8343 assertions).
- `vendor/bin/pint --test`: passed. `vendor/bin/phpstan analyse`: `[OK] No errors`.
- Pest Browser after `yarn vite build` (PLAYWRIGHT_BROWSERS_PATH workaround): 45 passed (92 assertions).
- Files: new `app/Support/Logging/RedactingFormatter.php`, `tests/Feature/Security/InertiaPageEscapingTest.php`; changed `RedactPiiProcessor`, `TapRedaction`, `SecurityHeaders`, `CspReportController`, `RateLimitKey`, `AppServiceProvider`, `config/{security,logging}.php`, `app.blade.php`, `.env.example`, and the Security/Logging test files.

## Fix round 2

Three Minors from `task-22-rereview-1.md`.

1. **Key matching.** `RedactPiiProcessor::isSensitiveKey()` matches the secret words as substrings again, on the key with everything but letters and digits removed: `password`, `passwd`, `token`, `secret`, `authorization`, `cookie`, `session`, `apikey` (so `accesstoken`, `authtoken`, `apitoken`, `csrftoken`, `sessionid`, `clientsecret`, `secretkey`, `apisecret`, `X-Api-Key` are redacted). Whole-word logic stays for the ambiguous words only: `otp` (so `hotpot` and `footprint` are kept) and `code`/`codes` with the harmless-qualifier list (`status_code` kept, `otp_code` redacted). All eight keys from the review, plus `xsrf_token`, `passwd`, `userpassword`, `Cookies`, are in the redacted dataset. `tokenizer` moved out of the "kept" dataset: the spec's substring rule redacts it (`keyboard`, `encoded`, `decoder`, `footprint`, `hotpot` stay as kept cases).
2. **Newline in origins.** Every host, origin and port regex in `config/security.php` is anchored with `\A ... \z`. Rejection dataset gains: REVERB_HOST with trailing, leading and inner newline; REVERB_PORT trailing newline; AWS_URL trailing newline and newline after host; AWS_PUBLIC_URL trailing newline.
3. **Boot warning.** `AppServiceProvider` keeps a private static flag; the CSP warning is logged at most once per PHP process (under php-fpm: once per worker, not per request), and the comment says so. Test boots the provider twice and asserts one `warning`; the flag is reset by reflection before and after each test in that group.

Results: Security + Privacy + Logging suites 342 passed; `vendor/bin/pest tests/Unit tests/Feature` 2175 passed (8370 assertions); Pint passed; PHPStan `[OK] No errors`.
