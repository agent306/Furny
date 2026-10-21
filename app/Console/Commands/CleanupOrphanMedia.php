<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Domain\Shared\Enums\UploadStatus;
use App\Domain\Shared\Models\UploadIntent;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Storage;
use Throwable;

/**
 * Deletes upload intents that were never consumed 24 hours after they were created, with the objects they left in the
 * bucket: the uploaded file under `tmp/` and the processed file under `uploads/` (13 §11.5). The bucket's lifecycle rule
 * on `tmp/` is only the backstop. Scheduled daily at 03:00 (01 §7).
 */
final class CleanupOrphanMedia extends Command
{
    protected $signature = 'media:cleanup-orphans';

    protected $description = 'Delete upload intents that were not consumed within 24 hours, and their files';

    public function handle(): int
    {
        $deleted = 0;
        $failed = 0;

        UploadIntent::query()
            ->where('status', '!=', UploadStatus::Consumed->value)
            ->where('created_at', '<', now()->subDay())
            ->chunkById(100, function ($intents) use (&$deleted, &$failed): void {
                foreach ($intents as $intent) {
                    try {
                        Storage::disk('s3')->delete(array_values(array_filter([$intent->object_key, $intent->processed_key])));
                    } catch (Throwable $exception) {
                        // The row is kept: it is the only record of the key, and the next run tries again.
                        report($exception);
                        $failed++;

                        continue;
                    }

                    $intent->delete();
                    $deleted++;
                }
            });

        $this->info("Deleted {$deleted} upload intents.");

        $this->sweepWorkDirectories();

        if ($failed > 0) {
            $this->warn("Could not delete the files of {$failed} upload intents; they are kept for the next run.");
        }

        return $failed > 0 ? self::FAILURE : self::SUCCESS;
    }

    /** Work directories of `ProcessUpload` jobs that the queue killed before their `finally` ran (60 s timeout). */
    private function sweepWorkDirectories(): void
    {
        $limit = now()->subHour()->getTimestamp();

        if (! is_dir(storage_path('app/tmp'))) {
            return;
        }

        foreach (File::directories(storage_path('app/tmp')) as $directory) {
            if (filemtime($directory) < $limit) {
                File::deleteDirectory($directory);
            }
        }
    }
}
