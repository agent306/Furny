<?php

declare(strict_types=1);

namespace App\Domain\Shared\Actions;

use App\Domain\Identity\Models\User;
use App\Domain\Shared\Enums\UploadStatus;
use App\Domain\Shared\Jobs\ProcessUpload;
use App\Domain\Shared\Models\UploadIntent;
use App\Support\Http\CodedValidationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

/**
 * Confirm (13 §11.3): the client says the PUT is done. The object must be there with exactly the declared length (the
 * signed PUT cannot be any other, so a difference means something else wrote to the key); then the intent is `uploaded`
 * and `ProcessUpload` is queued. Confirming again does not queue it again.
 */
final class ConfirmUploadIntent
{
    private const string QUEUED = 'queued';

    private const string ALREADY_CONFIRMED = 'already_confirmed';

    /**
     * @throws CodedValidationException `upload_size_mismatch` (the intent is rejected), `upload_expired` (the intent is
     *                                  expired), `upload_missing` (nothing at the key yet; the intent stays pending),
     *                                  `upload_invalid` (rejected, expired or consumed before)
     */
    public function handle(User $user, UploadIntent $intent): void
    {
        abort_unless($intent->user_id === $user->id, 404);

        // The refusal is thrown after the transaction: throwing inside would undo the status it records.
        $outcome = DB::transaction(function () use ($intent): string {
            $locked = UploadIntent::query()->whereKey($intent->id)->lockForUpdate()->firstOrFail();

            return match ($locked->status) {
                UploadStatus::Uploaded, UploadStatus::Ready => self::ALREADY_CONFIRMED,
                UploadStatus::Pending => $this->confirmPending($locked),
                UploadStatus::Rejected, UploadStatus::Expired, UploadStatus::Consumed => 'upload_invalid',
            };
        });

        $intent->refresh();

        if ($outcome === self::QUEUED) {
            ProcessUpload::dispatch($intent->id);
        } elseif ($outcome !== self::ALREADY_CONFIRMED) {
            $refusal = CodedValidationException::make($outcome, trans_icu('uploads.errors.'.$outcome));
            throw $outcome === 'upload_invalid' ? $refusal->withContext(['uploadId' => $intent->id]) : $refusal;
        }
    }

    /** @return string `queued`, or the code of the refusal */
    private function confirmPending(UploadIntent $intent): string
    {
        $disk = Storage::disk('s3');

        if ($intent->expires_at->isPast()) {
            $this->discard($intent, UploadStatus::Expired, 'upload_expired');

            return 'upload_expired';
        }

        if (! $disk->exists($intent->object_key)) {
            return 'upload_missing';
        }

        if ($disk->size($intent->object_key) !== $intent->declared_size) {
            $this->discard($intent, UploadStatus::Rejected, 'upload_size_mismatch');

            return 'upload_size_mismatch';
        }

        $intent->forceFill(['status' => UploadStatus::Uploaded])->save();

        return self::QUEUED;
    }

    private function discard(UploadIntent $intent, UploadStatus $status, string $reason): void
    {
        Storage::disk('s3')->delete($intent->object_key);
        $intent->forceFill(['status' => $status, 'reason_code' => $reason])->save();
    }
}
