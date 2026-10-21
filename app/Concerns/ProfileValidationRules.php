<?php

declare(strict_types=1);

namespace App\Concerns;

use App\Domain\Identity\Models\User;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Validation\Rule;
use Stringable;

/** The rules for the name and the email of a user (14 §3.1), shared by registration and the profile update. */
trait ProfileValidationRules
{
    /**
     * Get the validation rules used to validate user profiles.
     *
     * @return array<string, array<int, ValidationRule|Stringable|array<mixed>|string>>
     */
    protected function profileRules(?string $userId = null): array
    {
        return [
            'name' => $this->nameRules(),
            'email' => $this->emailRules($userId),
        ];
    }

    /**
     * Get the validation rules used to validate user names.
     *
     * @return array<int, ValidationRule|array<mixed>|string>
     */
    protected function nameRules(): array
    {
        return ['required', 'string', 'min:2', 'max:120'];
    }

    /**
     * Get the validation rules used to validate user emails. The address must be unused, soft-deleted users
     * included: their email stays taken until they are anonymised (13 §9).
     *
     * @return array<int, ValidationRule|Stringable|array<mixed>|string>
     */
    protected function emailRules(?string $userId = null): array
    {
        return [
            'required',
            'string',
            'email:rfc',
            'max:254',
            $userId === null
                ? Rule::unique(User::class)
                : Rule::unique(User::class)->ignore($userId),
        ];
    }
}
