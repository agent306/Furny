<?php

declare(strict_types=1);

namespace App\Domain\Identity\Actions;

use App\Domain\Identity\Models\User;
use App\Domain\Shared\Actions\ConsumeUploadIntent;
use App\Domain\Shared\Enums\UploadPurpose;
use App\Support\Http\CodedValidationException;
use Illuminate\Support\Facades\DB;

/** Sets the photo of the user from a ready upload, or removes it (10 §13.2). The collection holds one file: a new photo replaces the old. */
final class UpdateAvatar
{
    public function __construct(private readonly ConsumeUploadIntent $consume) {}

    /**
     * @param  string|null  $uploadId  a ready `avatar` upload of the user, or `null` to remove the photo
     *
     * @throws CodedValidationException `upload_invalid`
     */
    public function handle(User $user, ?string $uploadId): void
    {
        DB::transaction(function () use ($user, $uploadId): void {
            if ($uploadId === null) {
                $user->clearMediaCollection('avatar');

                return;
            }

            $this->consume->handle($user, $uploadId, UploadPurpose::Avatar, null, $user, 'avatar');
        });
    }
}
