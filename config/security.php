<?php

declare(strict_types=1);

/*
|--------------------------------------------------------------------------
| HTTP security (13 §10, §12.1)
|--------------------------------------------------------------------------
|
| Plain values only: no closures, no database, Redis or HTTP while booting (17 §5.11 item 3). The origins
| are derived once here with parse_url and read by App\Http\Middleware\SecurityHeaders.
*/

// The origins end up verbatim in the Content-Security-Policy header, so an environment value is used only when
// it is a plain origin: http(s), a host of letters, digits, dots and hyphens (no wildcard, no spaces, no `;`)
// and a numeric port. Anything else is dropped and its variable is listed in `csp.rejected`; AppServiceProvider
// logs one warning for those at boot (a config file cannot log).
$rejected = [];

// With virtual-hosted-style addressing and no explicit AWS_URL, presigned URLs go to `bucket.endpoint-host`.
$virtualHosted = ! env('AWS_URL')
    && ! filter_var(env('AWS_USE_PATH_STYLE_ENDPOINT', true), FILTER_VALIDATE_BOOLEAN)
    && env('AWS_BUCKET');

// Presigned URLs go to AWS_URL, else AWS_ENDPOINT. Real AWS S3 has no endpoint, so AWS_URL must be set there.
$candidates = [
    's3_private_origin' => [
        env('AWS_URL') ? 'AWS_URL' : 'AWS_ENDPOINT',
        (string) (env('AWS_URL') ?: env('AWS_ENDPOINT')),
        $virtualHosted ? (string) env('AWS_BUCKET').'.' : '',
    ],
    's3_public_origin' => ['AWS_PUBLIC_URL', (string) env('AWS_PUBLIC_URL'), ''],
];
$origins = ['s3_private_origin' => null, 's3_public_origin' => null];

foreach ($candidates as $key => [$variable, $url, $hostPrefix]) {
    if (trim($url) === '') {
        continue;
    }

    $parts = parse_url($url);
    $host = is_array($parts) ? $hostPrefix.($parts['host'] ?? '') : '';
    $port = is_array($parts) ? ($parts['port'] ?? null) : null;

    if (
        ! is_array($parts)
        || ! in_array($parts['scheme'] ?? '', ['http', 'https'], true)
        || preg_match('/^[A-Za-z0-9.-]+$/', $host) !== 1
        || isset($parts['user']) || isset($parts['pass'])
        || preg_match('/[\s;,*]/', $url) === 1
        || preg_match('~^https?://[A-Za-z0-9.-]+(?::[0-9]{1,5})?(?:[/?#]|$)~', $url) !== 1
    ) {
        $rejected[] = $variable;

        continue;
    }

    $origins[$key] = $parts['scheme'].'://'.$host.($port === null ? '' : ':'.$port);
}

$reverbHost = env('REVERB_HOST');
$reverbPort = env('REVERB_PORT');

if (! is_string($reverbHost) || preg_match('/^[A-Za-z0-9.-]+$/', $reverbHost) !== 1) {
    if (is_string($reverbHost) && trim($reverbHost) !== '') {
        $rejected[] = 'REVERB_HOST';
    }

    $reverbHost = null;
}

if (is_string($reverbPort) && preg_match('/^[0-9]{1,5}$/', $reverbPort) === 1 && (int) $reverbPort >= 1 && (int) $reverbPort <= 65535) {
    $reverbPort = (int) $reverbPort;
} else {
    if (is_string($reverbPort) && trim($reverbPort) !== '') {
        $rejected[] = 'REVERB_PORT';
    }

    $reverbPort = null;
}

return [

    'csp' => [
        's3_private_origin' => $origins['s3_private_origin'],

        // Origin of the public bucket's URLs.
        's3_public_origin' => $origins['s3_public_origin'],

        'reverb_host' => $reverbHost,
        'reverb_port' => $reverbPort,

        // Rollout switch (17 §6.1): report-only for the first 7 days after go-live, then enforce.
        'report_only' => filter_var(env('CSP_REPORT_ONLY', false), FILTER_VALIDATE_BOOLEAN),

        // Environment variables whose value was dropped for not being a plain origin.
        'rejected' => array_values(array_unique($rejected)),
    ],

    /*
    |--------------------------------------------------------------------------
    | Named rate limiters (13 §10)
    |--------------------------------------------------------------------------
    |
    | Every limit of a limiter applies. `per` is `minute`, `hour`, `day`, `seconds:N` or `minutes:N`; `key`
    | is what the count is kept per: `ip`, `user`, `email`, `email_ip`, `phone`, `session_login_id` or
    | `user_doc`. Emails and phones are normalised before they key anything (RateLimitServiceProvider).
    | `guest` replaces the limit for visitors who are not signed in.
    */
    'rate_limits' => [
        'login' => [
            ['per' => 'minute', 'max' => 5, 'key' => 'email_ip'],
            ['per' => 'minute', 'max' => 30, 'key' => 'ip'],
        ],
        'two-factor' => [
            ['per' => 'minute', 'max' => 5, 'key' => 'session_login_id'],
        ],
        'register' => [
            ['per' => 'hour', 'max' => 5, 'key' => 'ip'],
        ],
        'password-reset' => [
            ['per' => 'hour', 'max' => 3, 'key' => 'email'],
            ['per' => 'hour', 'max' => 10, 'key' => 'ip'],
        ],
        'verification-resend' => [
            ['per' => 'minutes:10', 'max' => 3, 'key' => 'user'],
        ],
        'otp-send' => [
            ['per' => 'hour', 'max' => 5, 'key' => 'phone'],
            ['per' => 'hour', 'max' => 10, 'key' => 'ip'],
        ],
        'otp-cooldown' => [
            ['per' => 'seconds:60', 'max' => 1, 'key' => 'phone'],
        ],
        'otp-verify' => [
            ['per' => 'minute', 'max' => 10, 'key' => 'ip'],
            ['per' => 'hour', 'max' => 20, 'key' => 'phone'],
        ],
        'oauth' => [
            ['per' => 'minute', 'max' => 20, 'key' => 'ip'],
        ],
        'uploads-presign' => [
            ['per' => 'minute', 'max' => 30, 'key' => 'user'],
            ['per' => 'day', 'max' => 300, 'key' => 'user'],
        ],
        'uploads-confirm' => [
            ['per' => 'minute', 'max' => 60, 'key' => 'user'],
        ],
        'imports-start' => [
            ['per' => 'hour', 'max' => 10, 'key' => 'user'],
        ],
        'ai-provider-test' => [
            ['per' => 'minute', 'max' => 10, 'key' => 'user'],
        ],
        'thumbnails' => [
            ['per' => 'minute', 'max' => 6, 'key' => 'user'],
        ],
        'test-push' => [
            ['per' => 'minute', 'max' => 3, 'key' => 'user'],
        ],
        'messages-post' => [
            ['per' => 'minute', 'max' => 20, 'key' => 'user'],
            ['per' => 'day', 'max' => 300, 'key' => 'user'],
        ],
        'autosave' => [
            ['per' => 'minute', 'max' => 60, 'key' => 'user_doc'],
        ],
        'api' => [
            ['per' => 'minute', 'max' => 120, 'key' => 'user', 'guest' => ['max' => 60, 'key' => 'ip']],
        ],
        'exports' => [
            ['per' => 'hour', 'max' => 20, 'key' => 'user'],
        ],
        'data-export' => [
            ['per' => 'day', 'max' => 3, 'key' => 'user'],
        ],
        'invitations' => [
            ['per' => 'day', 'max' => 20, 'key' => 'user'],
        ],
        'broadcasting-auth' => [
            ['per' => 'minute', 'max' => 120, 'key' => 'user'],
        ],
        'webhooks' => [
            ['per' => 'minute', 'max' => 600, 'key' => 'ip'],
        ],
        'client-errors' => [
            ['per' => 'minute', 'max' => 10, 'key' => 'ip'],
        ],
        'csp-report' => [
            ['per' => 'minute', 'max' => 30, 'key' => 'ip'],
        ],
    ],

];
