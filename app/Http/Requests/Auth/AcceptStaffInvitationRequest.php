<?php

declare(strict_types=1);

namespace App\Http\Requests\Auth;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rules\Password;

/**
 * `staff.invitations.accept` (14 §3.4): the name the member goes by and a password that follows the app's rules. The
 * request is for whoever holds the signed link; the invitation itself is checked by the action.
 */
final class AcceptStaffInvitationRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, list<mixed>> */
    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'min:2', 'max:120'],
            'password' => ['required', 'string', Password::default(), 'confirmed'],
        ];
    }

    public function chosenName(): string
    {
        return $this->string('name')->trim()->toString();
    }

    public function chosenPassword(): string
    {
        return $this->string('password')->toString();
    }
}
