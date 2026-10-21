<?php

declare(strict_types=1);

namespace App\Support;

use InvalidArgumentException;

/**
 * Feature flags of master §6.7. The raw switches live in config/features.php (closure-free,
 * so it can be cached); the flags that depend on other configuration are derived here.
 */
final class Features
{
    /** Flag names in the order they are shared with the frontend. */
    public const array FLAGS = [
        'payments',
        'whatsapp',
        'sms',
        'web_push',
        'google_login',
        'dxf_import',
        'walkthrough_camera',
        'captcha',
    ];

    public static function enabled(string $flag): bool
    {
        return match ($flag) {
            // Forced off when the VAPID key pair is missing.
            'web_push' => (bool) config('features.web_push')
                && filled(config('webpush.vapid.public_key'))
                && filled(config('webpush.vapid.private_key')),
            // Derived: Turnstile is active only when both keys are configured.
            'captcha' => filled(config('services.turnstile.site_key'))
                && filled(config('services.turnstile.secret_key')),
            'payments', 'whatsapp', 'sms', 'google_login', 'dxf_import', 'walkthrough_camera' => (bool) config("features.{$flag}"),
            default => throw new InvalidArgumentException("Unknown feature flag [{$flag}]."),
        };
    }

    /** @return array<string, bool> */
    public static function all(): array
    {
        $flags = [];

        foreach (self::FLAGS as $flag) {
            $flags[$flag] = self::enabled($flag);
        }

        return $flags;
    }
}
