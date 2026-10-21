<?php

declare(strict_types=1);

namespace App\Support\Auth;

use App\Support\Features;
use App\Support\Settings\Settings;
use Laravel\Fortify\Features as FortifyFeatures;

/**
 * `AuthPageProps` (13 §2, 14 §3.1): what every page of the auth layout gets besides its own props. The feature flags,
 * the public Turnstile key (only while the captcha is on) and whether new customers may register.
 */
final class AuthPageProps
{
    /** @return array{features: array<string, bool>, turnstileSiteKey: string|null, canRegister: bool} */
    public static function make(): array
    {
        $siteKey = config('services.turnstile.site_key');

        return [
            'features' => Features::all(),
            'turnstileSiteKey' => Features::enabled('captcha') && is_string($siteKey) ? $siteKey : null,
            'canRegister' => FortifyFeatures::enabled(FortifyFeatures::registration())
                && app(Settings::class)->auth()->allowCustomerRegistration,
        ];
    }
}
