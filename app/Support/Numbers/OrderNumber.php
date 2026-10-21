<?php

declare(strict_types=1);

namespace App\Support\Numbers;

use App\Support\Settings\Settings;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;

/**
 * Human-readable order numbers (master §6.3): `ORD-{YYYY}-{00001}`, one sequence per year in the
 * business time zone; drafts show the tail of their ULID until submission.
 */
final class OrderNumber
{
    public static function next(?CarbonInterface $at = null): string
    {
        $timezone = app(Settings::class)->business()->timezone;
        $year = CarbonImmutable::instance($at ?? now())->setTimezone($timezone)->year;

        return sprintf('ORD-%d-%05d', $year, NumberSequence::next("order:{$year}"));
    }

    public static function draft(string $ulid): string
    {
        return 'DRAFT-'.substr($ulid, -8);
    }
}
