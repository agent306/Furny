<?php

declare(strict_types=1);

namespace App\Domain\Shared\Jobs;

use App\Domain\Shared\Enums\UploadPurpose;
use App\Domain\Shared\Enums\UploadStatus;
use App\Domain\Shared\Models\UploadIntent;
use App\Support\Uploads\HeicConverter;
use App\Support\Uploads\ImageSanitizer;
use App\Support\Uploads\MagicBytes;
use App\Support\Uploads\UploadRejected;
use finfo;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Filesystem\Filesystem;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use RuntimeException;
use Throwable;

/**
 * What happens to an upload after the PUT (13 §11.3): the bytes are looked at, not the name or the browser's word. The type
 * is sniffed, images are decoded and written again without their metadata, and the result goes to
 * `uploads/{purpose}/{Y}/{m}/{id}.{ext}`. A file that is not what it says, or not what the purpose takes, is `rejected`
 * with a `reason_code`; trouble with storage or the vision service is retried (once), then the upload is rejected too.
 */
final class ProcessUpload implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable;

    /** The queue kills the job after this; the vision call is kept shorter (`VisionHeicConverter`). */
    public const int TIMEOUT_SECONDS = 60;

    public int $timeout = self::TIMEOUT_SECONDS;

    public int $tries = 2;

    /** The types `finfo` must agree on (13 §11.3 step 2); HEIC and DXF are not identified reliably by libmagic. */
    private const array FINFO_TYPES = ['jpeg', 'png', 'webp', 'pdf'];

    /** The types GD can decode and write again. */
    private const array IMAGE_TYPES = ['jpeg', 'png', 'webp'];

    public function __construct(public readonly string $uploadId)
    {
        $this->onQueue('default');
    }

    public function handle(HeicConverter $heic): void
    {
        $intent = UploadIntent::query()->find($this->uploadId);

        // Confirmed once, or already done: a repeated job changes nothing.
        if ($intent === null || $intent->status !== UploadStatus::Uploaded) {
            return;
        }

        $directory = storage_path('app/tmp/'.Str::ulid());
        File::ensureDirectoryExists($directory);

        try {
            $this->process($intent, $heic, $directory);
        } catch (UploadRejected $rejection) {
            $this->reject($intent, $rejection->reason);
        } finally {
            File::deleteDirectory($directory);
        }
    }

    /** The last try has failed: the upload is turned down and its object removed. */
    public function failed(Throwable $exception): void
    {
        $intent = UploadIntent::query()->find($this->uploadId);

        if ($intent !== null && $intent->status === UploadStatus::Uploaded) {
            $this->reject($intent, 'upload_processing_failed');
        }
    }

    /** @throws UploadRejected */
    private function process(UploadIntent $intent, HeicConverter $heic, string $directory): void
    {
        $purpose = $intent->purpose;
        $disk = Storage::disk('s3');

        $path = $directory.'/source';
        $this->download($disk, $intent->object_key, $path);

        if (filesize($path) !== $intent->declared_size) {
            throw new UploadRejected('upload_size_mismatch');
        }

        $type = $this->sniff($intent, $path);

        $width = $height = null;

        if ($purpose->reencodes() && $type === 'heic') {
            $heic->toJpeg($intent->object_key, $this->convertedKey($intent));
            $path = $directory.'/converted';
            $this->download($disk, $this->convertedKey($intent), $path);
            $type = MagicBytes::detect($path) === 'jpeg' ? 'jpeg' : throw new UploadRejected('upload_corrupt');
        }

        if ($purpose->reencodes() && in_array($type, self::IMAGE_TYPES, true)) {
            ['path' => $path, 'width' => $width, 'height' => $height] = ImageSanitizer::sanitize($path, $type, $purpose->maxEdge(), $purpose->squares(), $directory);
        }

        $processedKey = sprintf('uploads/%s/%s/%s.%s', $purpose->value, now()->format('Y/m'), $intent->id, MagicBytes::extension($type));
        $stream = $this->open($path, 'rb');

        try {
            $disk->writeStream($processedKey, $stream);
        } finally {
            fclose($stream);
        }

        $intent->forceFill([
            'status' => UploadStatus::Ready,
            'processed_key' => $processedKey,
            'sniffed_mime' => MagicBytes::mime($type),
            'width' => $width,
            'height' => $height,
        ])->save();

        $this->deleteObjects($intent);
    }

    /**
     * The type of the bytes, which must be one the purpose takes, of the family that was declared, and (for the four
     * kinds libmagic knows) what `finfo` says too.
     *
     * @throws UploadRejected
     */
    private function sniff(UploadIntent $intent, string $path): string
    {
        $type = MagicBytes::detect($path);

        if ($type === 'dwg') {
            throw new UploadRejected('dwg_not_supported');
        }

        if ($type === null || ! in_array($type, $intent->purpose->allowedSniffedTypes(), true)) {
            // 06 §2.1 names the unknown types a blueprint can come as (TIFF, AVIF, GIF, BMP, SVG) `unsupported_type`.
            throw new UploadRejected($intent->purpose === UploadPurpose::BlueprintSource ? 'unsupported_type' : 'upload_type_not_allowed');
        }

        if ($this->declaredType($intent) !== $type) {
            throw new UploadRejected('upload_type_mismatch');
        }

        if (in_array($type, self::FINFO_TYPES, true) && (new finfo(FILEINFO_MIME_TYPE))->file($path) !== MagicBytes::mime($type)) {
            throw new UploadRejected('upload_type_mismatch');
        }

        return $type;
    }

    /** The type the browser declared; a generic MIME type (accepted at presign with `.dxf`/`.heic` only) goes by the extension. */
    private function declaredType(UploadIntent $intent): ?string
    {
        $mime = $intent->declared_mime;

        if (in_array($mime, MagicBytes::GENERIC_MIMES, true)) {
            return MagicBytes::typeOfExtension(pathinfo($intent->original_filename, PATHINFO_EXTENSION));
        }

        return MagicBytes::typeOfMime($mime);
    }

    private function download(Filesystem $disk, string $key, string $path): void
    {
        $source = $disk->readStream($key);

        if (! is_resource($source)) {
            throw new RuntimeException("The object [{$key}] cannot be read.");
        }

        try {
            $target = $this->open($path, 'wb');
        } catch (Throwable $exception) {
            fclose($source);

            throw $exception;
        }

        try {
            stream_copy_to_stream($source, $target);
        } finally {
            fclose($source);
            fclose($target);
        }
    }

    /** @return resource */
    private function open(string $path, string $mode)
    {
        return fopen($path, $mode) ?: throw new RuntimeException("The file [{$path}] cannot be opened.");
    }

    private function reject(UploadIntent $intent, string $reason): void
    {
        $intent->forceFill(['status' => UploadStatus::Rejected, 'reason_code' => $reason])->save();

        $this->deleteObjects($intent);
    }

    /** The temporary objects: what was uploaded, and what the vision service wrote from it. */
    private function deleteObjects(UploadIntent $intent): void
    {
        try {
            Storage::disk('s3')->delete([$intent->object_key, $this->convertedKey($intent)]);
        } catch (Throwable $exception) {
            // The upload is settled; the bucket's lifecycle rule on `tmp/` removes what is left (13 §11.5).
            report($exception);
        }
    }

    private function convertedKey(UploadIntent $intent): string
    {
        return $intent->object_key.'.jpg';
    }
}
