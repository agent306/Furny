# Task 22 re-review 1 (fix 113f606..3470bdb)

### Finding Verdicts

- **Important 1: exceptions, Stringable objects and models bypass redaction** - ADDRESSED.
  - `app/Support/Logging/RedactingFormatter.php` masks everything a handler's formatter writes, including exception messages, previous exceptions, QueryException SQL and trace args.
  - `TapRedaction` wraps each handler's formatter once.
  - `RedactPiiProcessor::value()` reduces `Model`, `Arrayable`, `JsonSerializable` and `Stringable` values to masked arrays or strings.
  - `LogRedactionTest` covers `report()`, QueryException, trace args, Model, Stringable and ArrayObject through a real channel, plus a wrap-once check.
- **Important 2: CSP origin injection from env** - ADDRESSED.
  - `config/security.php` requires a strict origin shape, no whitespace, `;`, `,` or `*`, no userinfo and http(s) only; `REVERB_HOST` must match `[A-Za-z0-9.-]+`.
  - The 17-case rejection dataset in `SecurityHeadersTest` includes the original probes.
  - One trailing-newline gap remains (see New Breakage 1).
- **Important 3: no `</script>` escaping test** - ADDRESSED.
  - `InertiaPageEscapingTest` covers props and a flash.
  - `app.blade.php:51` now uses `JSON_HEX_TAG | JSON_INVALID_UTF8_SUBSTITUTE` (this also fixes Minor 6).
- **Minor 1: report path tokens** - ADDRESSED. `CspReportController::maskTokens()` masks `{token}` and `{hash}` route segments and long opaque segments, and leaves ULIDs and UUIDs readable. Tests cover it.
- **Minor 2: missing tests (multi-value XFF, maintenance 503)** - ADDRESSED. `TrustedProxiesTest` (5 chain cases plus an untrusted peer) and `SecurityHeadersTest` "maintenance mode" (headers, CSP, HSTS).
- **Minor 3: empty identifiers sharing a bucket** - ADDRESSED. `RateLimitKey::identifier()` falls back to `guest:<ip>` for empty, array or unparseable email/phone. Tests cover it.
- **Minor 4: IPv6 rotation** - ADDRESSED. `RateLimitKey::ip()` reduces IPv6 to /64 for `ip`, `email_ip` and guest keys. Tests cover it.
- **Minor 5: AWS S3 without an endpoint** - ADDRESSED. `.env.example` note, and rejected values are logged at boot.
- **Minor 6: invalid UTF-8 in data-page** - ADDRESSED. See Important 3.
- **Minor 7: `Content-Length` checked after the read** - ADDRESSED. `CspReportController.php:~35` refuses a declared length over 64 KB before reading. Tested.
- **Minor 8: `Log::stack()` and emergency bypass the tap** - ADDRESSED. Comments in `config/logging.php` and `TapRedaction`. Handler-level masking now also covers `Log::stack`.
- **Rulings (dashboard CSP, redaction over-matching)** - implemented as ruled; dashboard CSP tests pass. Fonts and `unsafe-inline` not flagged.

Check run: `vendor/bin/pest tests/Feature/Security tests/Unit/Privacy tests/Unit/Logging` gives 322 passed. The report names its covering tests and shows output (2155 passed, pint, phpstan, browser 45).

### New Breakage in the Fix Diff

1. **Minor:** `config/security.php` REVERB_HOST check uses `/^[A-Za-z0-9.-]+$/` without `D` or `\z`. `"ws.example.com\n"` is accepted, probed as host `ws.example.com\n` and not rejected. The CSP header would contain a newline and PHP would refuse it. Nothing can follow the newline, so it is not directive injection. Fix: `\z` or the `D` modifier, and add a newline case to the REVERB_HOST dataset (the dataset has the newline case only for `AWS_ENDPOINT`).
2. **Minor:** `RedactPiiProcessor::isSensitiveKey()` is now word-based for every sensitive word. Probed: `accesstoken`, `authtoken`, `apitoken`, `csrftoken`, `sessionid`, `clientsecret`, `secretkey` and `apisecret` are kept, where the spec regex (substring) redacted them. Ruling 4 only asked for `status_code`-style fixes. Fix: use substring matching for the secret words (`token`, `secret`, `password`, `passwd`, `authorization`, `cookie`, `session`, `apikey`) and keep the word logic only for `code`/`otp`.
3. **Minor:** `AppServiceProvider::warnWhenCspOriginsAreRejected()` runs in `boot()`, so under php-fpm a misconfigured env logs a warning on every request, not "once per process" as commented. It is also quiet in tests via a spy. Acceptable; consider logging once through cache or only in `about`/health.

### Out-of-Scope Observations

None.

### Verdict

**Fix round:** All findings addressed, no new Critical/Important breakage. APPROVED. Three new Minor items above are non-blocking.
