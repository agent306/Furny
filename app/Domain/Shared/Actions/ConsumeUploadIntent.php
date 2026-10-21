<?php

declare(strict_types=1);

namespace App\Domain\Shared\Actions;

use App\Domain\Identity\Models\User;
use App\Domain\Shared\Enums\UploadPurpose;
use App\Domain\Shared\Enums\UploadStatus;
use App\Domain\Shared\Models\UploadIntent;
use App\Support\Http\CodedValidationException;
use App\Support\Uploads\FileName;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;
use Spatie\MediaLibrary\HasMedia;
use Spatie\MediaLibrary\MediaCollections\Models\Media;

/**
 * The consuming side of an upload (13 §11.3 step 7), called by the action that owns the media collection (`PostMessage`,
 * `UpdateAvatar`, ...) inside its own transaction: the intent must be the user's, `ready`, of the purpose and the target,
 * and not used before. The processed file is copied into the model's collection and the intent is `consumed`.
 */
final class ConsumeUploadIntent
{
    /**
     * @throws CodedValidationException `upload_invalid` with the id of the upload
     */
    public function handle(User $user, string $uploadId, UploadPurpose $purpose, ?Model $target, HasMedia $model, string $collection): Media
    {
        return DB::transaction(function () use ($user, $uploadId, $purpose, $target, $model, $collection): Media {
            // Locked, so that two requests cannot use one upload twice.
            $intent = UploadIntent::query()->whereKey($uploadId)->lockForUpdate()->first();

            if (! $intent instanceof UploadIntent || ! $this->usable($intent, $user, $purpose, $target) || $intent->processed_key === null) {
                throw CodedValidationException::make('upload_invalid', trans_icu('uploads.errors.upload_invalid'))
                    ->withContext(['uploadId' => $uploadId]);
            }

            $media = $model->addMediaFromDisk($intent->processed_key, 's3')
                ->usingName(FileName::sanitize($intent->original_filename, pathinfo($intent->processed_key, PATHINFO_EXTENSION)))
                ->usingFileName(basename($intent->processed_key))
                ->toMediaCollection($collection);

            $intent->forceFill(['status' => UploadStatus::Consumed, 'consumed_at' => now()])->save();

            return $media;
        });
    }

    private function usable(UploadIntent $intent, User $user, UploadPurpose $purpose, ?Model $target): bool
    {
        return $intent->user_id === $user->id
            && $intent->status === UploadStatus::Ready
            && $intent->purpose === $purpose
            && $intent->target_type === $target?->getMorphClass()
            && $intent->target_id === ($target === null ? null : (string) $target->getKey());
    }
}
