<?php

declare(strict_types=1);

namespace App\Http\Requests\Auth;

use App\Domain\Identity\Models\User;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * `auth.reauthenticate.store` (14 §3.2): `step` is `send` (send a code to the user's verified phone) or `verify` (check
 * the code). A request that does not name its step is taken as `verify` when it carries a code and as `send` when it
 * does not.
 */
final class ReauthenticateRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user() instanceof User;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'step' => ['nullable', Rule::in(['send', 'verify'])],
            'code' => ['required_if:step,verify', 'nullable', 'string', 'max:12'],
            'cf_turnstile_response' => ['nullable', 'string'],
        ];
    }

    public function step(): string
    {
        $step = $this->input('step');

        if (is_string($step) && $step !== '') {
            return $step;
        }

        return is_string($this->input('code')) && $this->input('code') !== '' ? 'verify' : 'send';
    }

    public function userOrFail(): User
    {
        $user = $this->user();

        return $user instanceof User ? $user : abort(403);
    }
}
