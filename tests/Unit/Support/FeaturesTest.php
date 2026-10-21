<?php

declare(strict_types=1);

use App\Support\Features;

const FEATURE_ENV_VARS = [
    'FEATURE_PAYMENTS',
    'FEATURE_WHATSAPP',
    'FEATURE_SMS',
    'FEATURE_WEB_PUSH',
    'FEATURE_GOOGLE_LOGIN',
    'FEATURE_DXF_IMPORT',
    'FEATURE_WALKTHROUGH_CAMERA',
];

/**
 * config/features.php evaluated with the flag variables of phpunit.xml and .env removed.
 *
 * @param  array<string, string|false>  $env
 * @return array<string, bool>
 */
function evaluateFeaturesConfig(array $env = []): array
{
    /** @var array<string, bool> */
    return evaluateConfigFile('features', [...array_fill_keys(FEATURE_ENV_VARS, false), ...$env]);
}

/** @param  array<string, bool>  $flags */
function useFeatureConfig(array $flags, ?string $vapidPublic = 'public-key', ?string $vapidPrivate = 'private-key', ?string $siteKey = null, ?string $secretKey = null): void
{
    config([
        'features' => $flags,
        'webpush.vapid.public_key' => $vapidPublic,
        'webpush.vapid.private_key' => $vapidPrivate,
        'services.turnstile.site_key' => $siteKey,
        'services.turnstile.secret_key' => $secretKey,
    ]);
}

it('reads the documented defaults when no flag variable is set', function (): void {
    useFeatureConfig(evaluateFeaturesConfig());

    expect(Features::all())->toBe([
        'payments' => false,
        'whatsapp' => false,
        'sms' => false,
        'web_push' => true,
        'google_login' => false,
        'dxf_import' => true,
        'walkthrough_camera' => true,
        'captcha' => false,
    ]);
});

it('exposes exactly the eight master flags in order', function (): void {
    useFeatureConfig(evaluateFeaturesConfig());

    expect(array_keys(Features::all()))->toBe([
        'payments', 'whatsapp', 'sms', 'web_push', 'google_login', 'dxf_import', 'walkthrough_camera', 'captcha',
    ]);
});

it('honours the flag environment variables', function (): void {
    $flags = evaluateFeaturesConfig([
        'FEATURE_PAYMENTS' => 'true',
        'FEATURE_SMS' => 'true',
        'FEATURE_DXF_IMPORT' => 'false',
    ]);
    useFeatureConfig($flags);

    expect(Features::enabled('payments'))->toBeTrue()
        ->and(Features::enabled('sms'))->toBeTrue()
        ->and(Features::enabled('dxf_import'))->toBeFalse();
});

it('forces web push off unless both VAPID keys are filled', function (?string $public, ?string $private): void {
    useFeatureConfig(evaluateFeaturesConfig(['FEATURE_WEB_PUSH' => 'true']), $public, $private);

    expect(Features::enabled('web_push'))->toBeFalse();
})->with([
    'public key empty' => ['', 'private-key'],
    'private key empty' => ['public-key', ''],
    'both missing' => [null, null],
]);

it('keeps web push on when enabled and both VAPID keys are filled', function (): void {
    useFeatureConfig(evaluateFeaturesConfig(['FEATURE_WEB_PUSH' => 'true']), 'public-key', 'private-key');

    expect(Features::enabled('web_push'))->toBeTrue();
});

it('keeps web push off when the flag is off even with VAPID keys', function (): void {
    useFeatureConfig(evaluateFeaturesConfig(['FEATURE_WEB_PUSH' => 'false']), 'public-key', 'private-key');

    expect(Features::enabled('web_push'))->toBeFalse();
});

it('derives captcha from both Turnstile keys', function (?string $site, ?string $secret, bool $expected): void {
    useFeatureConfig(evaluateFeaturesConfig(), siteKey: $site, secretKey: $secret);

    expect(Features::enabled('captcha'))->toBe($expected);
})->with([
    'both filled' => ['site', 'secret', true],
    'site only' => ['site', '', false],
    'secret only' => ['', 'secret', false],
    'neither' => [null, null, false],
]);

it('rejects an unknown flag name', function (): void {
    useFeatureConfig(evaluateFeaturesConfig());

    Features::enabled('teleportation');
})->throws(InvalidArgumentException::class);
