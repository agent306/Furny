<?php

declare(strict_types=1);

namespace App\Domain\Identity\Data;

use App\Domain\Identity\Enums\LengthUnit;
use App\Domain\Identity\Enums\UnitSystem;
use App\Domain\Identity\Models\User;
use DateTimeZone;
use Spatie\LaravelData\Data;
use Spatie\TypeScriptTransformer\Attributes\TypeScript;

/** Props of `Customer/Account/Preferences` and `Admin/Account/Preferences` (10 §13.4, 11 §18, 14 §9). */
#[TypeScript]
final class AccountPreferencesProps extends Data
{
    /**
     * @param  list<string>  $timezones  Every identifier PHP knows: the only values `UpdateDisplayPreferences` accepts.
     */
    public function __construct(
        public UnitSystem $unitSystem,
        public LengthUnit $lengthUnit,
        public string $timezone,
        public array $timezones,
    ) {}

    public static function fromUser(User $user): self
    {
        return new self($user->unit_system, $user->length_unit, $user->timezone, DateTimeZone::listIdentifiers());
    }
}
