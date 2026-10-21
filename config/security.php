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

// scheme://host[:port] of a URL, or null when it has no host. Used for CSP source lists.
$privateUrl = (string) (env('AWS_URL') ?: env('AWS_ENDPOINT'));
$privateParts = parse_url($privateUrl) ?: [];
$publicParts = parse_url((string) env('AWS_PUBLIC_URL')) ?: [];

// With virtual-hosted-style addressing and no explicit URL, presigned URLs go to `bucket.endpoint-host`.
$privateHost = $privateParts['host'] ?? null;

if ($privateHost !== null && ! env('AWS_URL') && ! filter_var(env('AWS_USE_PATH_STYLE_ENDPOINT', true), FILTER_VALIDATE_BOOLEAN) && env('AWS_BUCKET')) {
    $privateHost = env('AWS_BUCKET').'.'.$privateHost;
}

$reverbPort = env('REVERB_PORT');

return [

    'csp' => [
        // Scheme and host (with a non-default port) of presigned URLs: AWS_URL, else AWS_ENDPOINT.
        's3_private_origin' => $privateHost === null
            ? null
            : ($privateParts['scheme'] ?? 'https').'://'.$privateHost.(isset($privateParts['port']) ? ':'.$privateParts['port'] : ''),

        // Origin of the public bucket's URLs.
        's3_public_origin' => isset($publicParts['host'])
            ? ($publicParts['scheme'] ?? 'https').'://'.$publicParts['host'].(isset($publicParts['port']) ? ':'.$publicParts['port'] : '')
            : null,

        'reverb_host' => env('REVERB_HOST') ?: null,
        'reverb_port' => is_numeric($reverbPort) ? (int) $reverbPort : null,

        // Rollout switch (17 §6.1): report-only for the first 7 days after go-live, then enforce.
        'report_only' => filter_var(env('CSP_REPORT_ONLY', false), FILTER_VALIDATE_BOOLEAN),
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
