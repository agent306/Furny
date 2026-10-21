<?php

declare(strict_types=1);

namespace App\Http\Requests\Account;

use App\Domain\Identity\Enums\LengthUnit;
use App\Domain\Identity\Enums\UnitSystem;
use App\Domain\Identity\Models\User;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * `customer|admin.account.preferences.update` (14 §9, §17). The shapes are checked here; that the unit belongs to the
 * system and that the zone exists is for `UpdateDisplayPreferences` to say, with the messages of 10 §13.4.
 */
final class UpdateDisplayPreferencesRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user() instanceof User;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'unitSystem' => ['required', Rule::enum(UnitSystem::class)],
            'lengthUnit' => ['required', Rule::enum(LengthUnit::class)],
            'timezone' => ['required', 'string', 'max:64'],
        ];
    }

    public function userOrFail(): User
    {
        $user = $this->user();

        return $user instanceof User ? $user : abort(403);
    }
}
