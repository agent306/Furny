# Task 22 re-review 2 (fix round 2, 3470bdb..e5b3902)

### Finding Verdicts

- **Key matching regressed to whole words** - ADDRESSED. `RedactPiiProcessor.php` `SECRET_SUBSTRINGS` is matched with `str_contains` on the key stripped to letters and digits (`isSensitiveKey()`). I probed `accesstoken`, `apitoken`, `sessionid`, `clientsecret`, `authtoken`, `csrftoken`, `secretkey`, `apisecret`, `X-Api-Key` and `xsrf_token`: all REDACT. `status_code`, `statusCode`, `http_code`, `error_code`, `orderNumber`, `count`, `hotpot` and `footprint` are kept; `otp` and `otp_code` are redacted. Side effect: substrings such as `session` and `token` over-match (`tokenizer`, `possession`). That is what the spec's regex does, so it is accepted. The test describe title still says "whole words, not substrings", a stale label only.
- **REVERB_HOST trailing newline accepted** - ADDRESSED. Every host, origin and port regex in `config/security.php` is now `\A...\z`. The dataset gains trailing, leading and inner newline cases for REVERB_HOST, REVERB_PORT, AWS_URL and AWS_PUBLIC_URL.
- **Boot warning logged on every php-fpm request** - ADDRESSED. `AppServiceProvider.php` keeps a static `$cspWarningGiven` flag. The test boots twice, asserts one `warning`, and resets the flag by reflection before and after.

Check run: `vendor/bin/pest tests/Feature/Security tests/Unit/Privacy tests/Unit/Logging` gives 342 passed. The report states the full suite at 2175 passed, Pint and PHPStan clean.

### New Breakage in the Fix Diff

None.

### Out-of-Scope Observations

None.

### Verdict

**Fix round:** All findings addressed, no new Critical/Important breakage. APPROVED.
