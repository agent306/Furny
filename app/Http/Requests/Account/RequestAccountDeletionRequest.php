<?php

declare(strict_types=1);

namespace App\Http\Requests\Account;

use App\Domain\Identity\Models\User;
use Illuminate\Foundation\Http\FormRequest;

/**
 * `customer.account.destroy` (14 §9): the word to confirm. Whether it is the right word is decided by
 * `RequestAccountDeletion`, which answers `account.errors.confirmation` for a missing or wrong one.
 */
final class RequestAccountDeletionRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user() instanceof User;
    }

    /** @return array<string, list<string>> */
    public function rules(): array
    {
        return ['confirmation' => ['nullable', 'string', 'max:50']];
    }

    public function userOrFail(): User
    {
        $user = $this->user();

        return $user instanceof User ? $user : abort(403);
    }
}
