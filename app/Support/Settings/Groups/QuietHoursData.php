<?php

declare(strict_types=1);

namespace App\Support\Settings\Groups;

use Spatie\LaravelData\Data;

/**
 * `notifications.quiet_hours` (12 §6.2): `HH:MM` in the business time zone.
 */
final class QuietHoursData extends Data
{
    public function __construct(
        public bool $enabled,
        public string $start,
        public string $end,
    ) {}
}
