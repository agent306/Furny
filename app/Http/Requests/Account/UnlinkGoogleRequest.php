<?php

declare(strict_types=1);

namespace App\Http\Requests\Account;

use App\Domain\Identity\Models\User;
use Illuminate\Foundation\Http\FormRequest;

/** `account.google.unlink` (14 §3.3): no fields. Only a signed-in user may unlink; `recent.auth` is route middleware. */
final class UnlinkGoogleRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user() instanceof User;
    }

    /** @return array<string, never> */
    public function rules(): array
    {
        return [];
    }

    /** The signed-in user; `authorize()` has seen to it that there is one. */
    public function userOrFail(): User
    {
        $user = $this->user();

        return $user instanceof User ? $user : abort(403);
    }
}
