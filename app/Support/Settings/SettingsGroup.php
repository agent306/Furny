<?php

declare(strict_types=1);

namespace App\Support\Settings;

use App\Support\Settings\Groups\AiSettings;
use App\Support\Settings\Groups\AuthSettings;
use App\Support\Settings\Groups\BusinessSettings;
use App\Support\Settings\Groups\NotificationsSettings;
use App\Support\Settings\Groups\PricingSettings;
use App\Support\Settings\Groups\SettingsData;
use App\Support\Settings\Groups\UnitsSettings;
use App\Support\Settings\Groups\WorkflowSettings;

/**
 * The seven `app_settings` groups with a typed Data class (02 §13); the two `catalog.*` keys are
 * scalars handled by `Settings` and `CatalogVersion`.
 */
enum SettingsGroup: string
{
    case Business = 'business';
    case Units = 'units';
    case Pricing = 'pricing';
    case Workflow = 'workflow';
    case Ai = 'ai';
    case Notifications = 'notifications';
    case Auth = 'auth';

    /**
     * @return class-string<SettingsData>
     */
    public function dataClass(): string
    {
        return match ($this) {
            self::Business => BusinessSettings::class,
            self::Units => UnitsSettings::class,
            self::Pricing => PricingSettings::class,
            self::Workflow => WorkflowSettings::class,
            self::Ai => AiSettings::class,
            self::Notifications => NotificationsSettings::class,
            self::Auth => AuthSettings::class,
        };
    }

    /** Owner-only groups (gate `settings.manage_restricted`, 13 §7.3). */
    public function isRestricted(): bool
    {
        return $this === self::Ai || $this === self::Auth;
    }
}
