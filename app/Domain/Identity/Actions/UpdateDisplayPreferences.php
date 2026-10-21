<?php

declare(strict_types=1);

namespace App\Domain\Identity\Actions;

use App\Domain\Identity\Enums\LengthUnit;
use App\Domain\Identity\Enums\UnitSystem;
use App\Domain\Identity\Models\User;
use DateTimeZone;
use Illuminate\Validation\ValidationException;

/**
 * The measurement system, the editing length unit and the time zone the user sees (10 §13.4, 11 §18). Named for what it
 * changes: `UpdatePreferences` is the notification preferences action of 12 (C10).
 */
final class UpdateDisplayPreferences
{
    /**
     * @throws ValidationException `lengthUnit` when the unit is not one of the system, `timezone` when PHP does not know it
     */
    public function handle(User $user, UnitSystem $system, LengthUnit $unit, string $timezone): User
    {
        if (! $unit->allowedFor($system)) {
            throw ValidationException::withMessages(['lengthUnit' => trans_icu('account.errors.length_unit')]);
        }

        if (! in_array($timezone, DateTimeZone::listIdentifiers(), true)) {
            throw ValidationException::withMessages(['timezone' => trans_icu('account.errors.timezone')]);
        }

        $user->forceFill(['unit_system' => $system, 'length_unit' => $unit, 'timezone' => $timezone])->save();

        return $user;
    }
}
