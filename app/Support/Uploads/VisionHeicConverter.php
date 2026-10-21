<?php

declare(strict_types=1);

namespace App\Support\Uploads;

use App\Domain\Shared\Jobs\ProcessUpload;
use Illuminate\Support\Facades\Http;
use RuntimeException;

/**
 * The vision service does the decoding (Pillow with pi-heif, 06 §5.8): it fetches the HEIC through a presigned GET,
 * applies the orientation, drops the metadata, shrinks to 4096 px and PUTs the JPEG through a presigned PUT. These are the
 * server-side presigns of 06 §4.7, not upload intents, and never reach a browser.
 */
final class VisionHeicConverter implements HeicConverter
{
    private const int QUALITY = 85;

    private const int MAX_EDGE = 4096;

    /** Seconds the call ends before the queue would kill the job (13 §11.3: 60 s), so the job can clean up. */
    private const int JOB_MARGIN = 10;

    /** The vision service answers these for a file it cannot use: nothing a second try would change. */
    private const array UNUSABLE_FILE = [413, 415, 422];

    public function __construct(private readonly UploadPresigner $presigner) {}

    public function toJpeg(string $sourceKey, string $targetKey): void
    {
        $expiresAt = now()->addMinutes((int) config('imports.vision_presign_ttl_minutes'));

        $response = Http::withToken((string) config('imports.vision.token'))
            ->acceptJson()
            ->asJson()
            ->connectTimeout((int) config('imports.vision.connect_timeout_s'))
            ->timeout(min((int) config('imports.vision.normalize_timeout_s'), ProcessUpload::TIMEOUT_SECONDS - self::JOB_MARGIN))
            ->post(rtrim((string) config('imports.vision.url'), '/').'/v1/images/normalize', [
                'sourceUrl' => $this->presigner->presignGet($sourceKey, $expiresAt),
                'targetUrl' => $this->presigner->presignPut($targetKey, 'image/jpeg', null, $expiresAt)->url,
                'format' => 'jpeg',
                'quality' => self::QUALITY,
                'maxEdge' => self::MAX_EDGE,
                'applyOrientation' => true,
            ]);

        if ($response->successful()) {
            return;
        }

        if (in_array($response->status(), self::UNUSABLE_FILE, true)) {
            throw new UploadRejected('upload_corrupt');
        }

        // Anything else (a 5xx, a 401 from a wrong token) is not the file's fault: the job tries again, then gives up.
        throw new RuntimeException("The vision service answered HTTP {$response->status()} to the image normalisation.");
    }
}
