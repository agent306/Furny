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
use Illuminate\Support\Facades\Storage;
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

            $processedKey = $intent?->processed_key;

            if (! $intent instanceof UploadIntent || $processedKey === null || ! $this->usable($intent, $user, $purpose, $target)) {
                throw CodedValidationException::make('upload_invalid', trans_icu('uploads.errors.upload_invalid'))
                    ->withContext(['uploadId' => $uploadId]);
            }

            // The original is kept until the outermost transaction has committed: if the caller fails after this, the intent is
            // `ready` again and its file must still be there.
            $media = $model->addMediaFromDisk($processedKey, 's3')
                ->preservingOriginal()
                ->withCustomProperties(['width' => $intent->width, 'height' => $intent->height])
                ->usingName(FileName::sanitize($intent->original_filename, pathinfo($processedKey, PATHINFO_EXTENSION)))
                ->usingFileName(basename($processedKey))
                ->toMediaCollection($collection);

            $intent->forceFill(['status' => UploadStatus::Consumed, 'consumed_at' => now()])->save();

            DB::afterCommit(static fn () => Storage::disk('s3')->delete($processedKey));

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
