<?php

declare(strict_types=1);

namespace App\Http\Requests\Account;

use App\Domain\Identity\Models\User;
use Illuminate\Foundation\Http\FormRequest;

/**
 * `customer|admin.account.avatar.update` (14 §9, §17): `uploadId` must be sent, and `null` removes the photo. Whether
 * the upload is the user's own, ready and an avatar is for `ConsumeUploadIntent` to say (`upload_invalid`).
 */
final class UpdateAvatarRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user() instanceof User;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'uploadId' => ['present', 'nullable', 'ulid'],
        ];
    }

    public function userOrFail(): User
    {
        $user = $this->user();

        return $user instanceof User ? $user : abort(403);
    }

    public function uploadId(): ?string
    {
        $id = $this->input('uploadId');

        return is_string($id) ? $id : null;
    }
}
