<?php

declare(strict_types=1);

namespace App\Rules;

use App\Support\Features;
use Closure;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

/**
 * Cloudflare Turnstile token check (13 §3). Passes without a token while `features.captcha` is off (local and test
 * environments). Otherwise Cloudflare must confirm the token for this site and this form: `success`, our own
 * `hostname` and the form's `action`. When Cloudflare cannot be reached the form decides: a form that is safe
 * without the check (`$failOpen`) lets the request through and logs it, one that costs money per request does not.
 */
final class TurnstileToken implements ValidationRule
{
    public const string VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

    /** Run for an empty value too: a missing token is a failed check, not a skipped one. */
    public bool $implicit = true;

    public function __construct(private readonly string $action, private readonly bool $failOpen) {}

    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        if (! Features::enabled('captcha')) {
            return;
        }

        if (! is_string($value) || $value === '') {
            $fail('auth.captcha_failed')->translate();

            return;
        }

        try {
            $response = Http::asForm()->timeout(5)->post(self::VERIFY_URL, [
                'secret' => (string) config('services.turnstile.secret_key'),
                'response' => $value,
                'remoteip' => (string) request()->ip(),
                'idempotency_key' => (string) Str::uuid(),
            ]);
        } catch (ConnectionException) {
            $this->unavailable($fail, 'connection');

            return;
        }

        if ($response->serverError()) {
            $this->unavailable($fail, 'status '.$response->status());

            return;
        }

        if (! $this->confirms($response)) {
            $fail('auth.captcha_failed')->translate();
        }
    }

    private function confirms(Response $response): bool
    {
        $body = $response->json();

        if (! is_array($body) || ($body['success'] ?? false) !== true) {
            return false;
        }

        $host = parse_url((string) config('app.url'), PHP_URL_HOST);

        return is_string($host)
            && is_string($body['hostname'] ?? null) && strcasecmp($body['hostname'], $host) === 0
            && ($body['action'] ?? null) === $this->action;
    }

    private function unavailable(Closure $fail, string $reason): void
    {
        Log::warning('captcha.unavailable', ['form' => $this->action, 'reason' => $reason, 'fail_open' => $this->failOpen]);

        if (! $this->failOpen) {
            $fail('auth.captcha_unavailable')->translate();
        }
    }
}
