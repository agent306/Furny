<?php

declare(strict_types=1);

use App\Domain\Shared\Enums\UploadPurpose;
use App\Domain\Shared\Enums\UploadStatus;
use App\Domain\Shared\Jobs\ProcessUpload;
use App\Domain\Shared\Models\UploadIntent;
use App\Support\Uploads\HeicConverter;
use App\Support\Uploads\UploadPresigner;
use App\Support\Uploads\UploadRejected;
use App\Support\Uploads\VisionHeicConverter;
use Carbon\CarbonImmutable;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Tests\Support\Uploads\FakeUploadPresigner;

beforeEach(function (): void {
    $this->travelTo(CarbonImmutable::parse('2030-06-15 12:00:00', 'UTC'));
});

function uploadFixture(string $name): string
{
    return (string) file_get_contents(base_path('tests/fixtures/uploads/'.$name));
}

/** A pending upload whose object holds `$bytes`, as `ConfirmUploadIntent` leaves it: status `uploaded`. */
function uploadedIntent(string $bytes, UploadPurpose $purpose, string $declaredMime, string $filename = 'upload.bin'): UploadIntent
{
    $intent = UploadIntent::factory()->purpose($purpose)->uploaded()->create([
        'declared_mime' => $declaredMime,
        'declared_size' => strlen($bytes),
        'original_filename' => $filename,
        'sniffed_mime' => null,
    ]);
    Storage::disk('s3')->put($intent->object_key, $bytes);

    return $intent;
}

/** The job's handler, called the way a worker's first try calls it: the sync queue would also run `failed()` at once. */
function runProcessUpload(string $uploadId): void
{
    app()->call([new ProcessUpload($uploadId), 'handle']);
}

function processUpload(UploadIntent $intent): UploadIntent
{
    runProcessUpload($intent->id);

    return $intent->refresh();
}

function tempFiles(): array
{
    return glob(storage_path('app/tmp/*')) ?: [];
}

/** @return list<string> */
function leftoverObjects(): array
{
    return array_values(array_filter(Storage::disk('s3')->allFiles(), static fn (string $key): bool => str_starts_with($key, 'tmp/')));
}

it('rejects PNG bytes declared as JPEG with upload_type_mismatch', function (): void {
    $intent = processUpload(uploadedIntent(uploadFixture('png-as-jpg.jpg'), UploadPurpose::Avatar, 'image/jpeg', 'me.jpg'));

    expect($intent->status)->toBe(UploadStatus::Rejected)->and($intent->reason_code)->toBe('upload_type_mismatch')
        ->and($intent->processed_key)->toBeNull();
    Storage::disk('s3')->assertMissing($intent->object_key);
});

it('rejects an SVG declared as PNG with upload_type_not_allowed', function (): void {
    $intent = processUpload(uploadedIntent(uploadFixture('vector.svg'), UploadPurpose::Avatar, 'image/png', 'logo.png'));

    expect($intent->status)->toBe(UploadStatus::Rejected)->and($intent->reason_code)->toBe('upload_type_not_allowed');
    Storage::disk('s3')->assertMissing($intent->object_key);
});

it('rejects a type the purpose does not take, however well declared', function (string $fixture, string $mime, UploadPurpose $purpose): void {
    $intent = processUpload(uploadedIntent(uploadFixture($fixture), $purpose, $mime, $fixture));

    expect($intent->status)->toBe(UploadStatus::Rejected)->and($intent->reason_code)->toBe('upload_type_not_allowed');
})->with([
    'pdf as avatar' => ['doc.pdf', 'application/pdf', UploadPurpose::Avatar],
    'webp as thumbnail' => ['plain.webp', 'image/webp', UploadPurpose::PlanThumbnail],
    'png as texture' => ['plain.png', 'image/png', UploadPurpose::MaterialTexture],
    'dxf as message attachment' => ['plan.dxf', 'image/vnd.dxf', UploadPurpose::MessageAttachment],
    'heic as avatar' => ['minimal.heic', 'image/heic', UploadPurpose::Avatar],
]);

it('rejects a DWG drawing named .dxf with dwg_not_supported', function (): void {
    $intent = processUpload(uploadedIntent(uploadFixture('drawing-as-dxf.dxf'), UploadPurpose::BlueprintSource, 'application/octet-stream', 'drawing.dxf'));

    expect($intent->status)->toBe(UploadStatus::Rejected)->and($intent->reason_code)->toBe('dwg_not_supported');
});

it('rejects an image of 50 megapixels before it decodes it', function (): void {
    $before = memory_get_peak_usage(true);

    $intent = processUpload(uploadedIntent(uploadFixture('bomb-50mp.png'), UploadPurpose::ProductionPhoto, 'image/png', 'big.png'));

    expect($intent->status)->toBe(UploadStatus::Rejected)->and($intent->reason_code)->toBe('upload_image_too_large')
        ->and(memory_get_peak_usage(true) - $before)->toBeLessThan(50 * 1024 * 1024);
    Storage::disk('s3')->assertMissing($intent->object_key);
});

it('rejects an animated WebP whose first frame is a bomb under a small canvas, without decoding it', function (string $fixture): void {
    $before = memory_get_peak_usage(true);
    $scratch = glob(sys_get_temp_dir().'/{sanitized,frame}-*', GLOB_BRACE);

    $intent = processUpload(uploadedIntent(uploadFixture($fixture), UploadPurpose::Avatar, 'image/webp', 'me.webp'));

    expect($intent->status)->toBe(UploadStatus::Rejected)->and($intent->reason_code)->toBe('upload_image_too_large')
        ->and(memory_get_peak_usage(true) - $before)->toBeLessThan(50 * 1024 * 1024)
        ->and(glob(sys_get_temp_dir().'/{sanitized,frame}-*', GLOB_BRACE))->toBe($scratch);
})->with(['animated-frame-bomb-121mp.webp', 'animated-frame-bomb-48mp.webp']);

it('rejects a blueprint of a type the system does not know with unsupported_type (06 §2.1)', function (string $fixture): void {
    $intent = processUpload(uploadedIntent(uploadFixture($fixture), UploadPurpose::BlueprintSource, 'image/png', 'plan.png'));

    expect($intent->status)->toBe(UploadStatus::Rejected)->and($intent->reason_code)->toBe('unsupported_type');
})->with(['vector.svg']);

it('rejects an image that cannot be decoded', function (): void {
    $intent = processUpload(uploadedIntent("\xFF\xD8\xFF\xE0\0\x10JFIF\0".str_repeat('x', 40), UploadPurpose::ProductionPhoto, 'image/jpeg', 'bad.jpg'));

    expect($intent->status)->toBe(UploadStatus::Rejected)->and($intent->reason_code)->toBe('upload_corrupt');
});

it('turns a photo upright, strips its GPS data and stores it under the sniffed extension', function (): void {
    $intent = processUpload(uploadedIntent(uploadFixture('exif-gps-rotated.jpg'), UploadPurpose::ProductionPhoto, 'image/jpeg', 'IMG_0001.JPG'));

    expect($intent->status)->toBe(UploadStatus::Ready)
        ->and($intent->reason_code)->toBeNull()
        ->and($intent->processed_key)->toBe('uploads/production_photo/2030/06/'.$intent->id.'.jpg')
        ->and($intent->sniffed_mime)->toBe('image/jpeg')
        ->and($intent->width)->toBe(300)
        ->and($intent->height)->toBe(400);

    Storage::disk('s3')->assertExists($intent->processed_key);
    Storage::disk('s3')->assertMissing($intent->object_key);

    $output = tempnam(sys_get_temp_dir(), 'out');
    file_put_contents($output, Storage::disk('s3')->get($intent->processed_key));
    $exif = @exif_read_data($output, null, true);
    $image = imagecreatefromjpeg($output);
    unlink($output);

    expect(is_array($exif) && array_key_exists('GPS', $exif))->toBeFalse()
        ->and([imagesx($image), imagesy($image)])->toBe([300, 400]);

    // Stored orientation 6: the red block at the top left of the stored picture ends at the top right.
    $topRight = imagecolorat($image, 295, 4);
    $topLeft = imagecolorat($image, 4, 4);
    expect(($topRight >> 16) & 0xFF)->toBeGreaterThan(200)
        ->and(($topRight >> 8) & 0xFF)->toBeLessThan(60)
        ->and($topLeft & 0xFF)->toBeGreaterThan(200);
});

it('keeps a PDF blueprint byte for byte', function (): void {
    $bytes = uploadFixture('doc.pdf');
    $intent = processUpload(uploadedIntent($bytes, UploadPurpose::BlueprintSource, 'application/pdf', 'plan.pdf'));

    expect($intent->status)->toBe(UploadStatus::Ready)
        ->and($intent->processed_key)->toBe('uploads/blueprint_source/2030/06/'.$intent->id.'.pdf')
        ->and($intent->sniffed_mime)->toBe('application/pdf')
        ->and($intent->width)->toBeNull()->and($intent->height)->toBeNull();
    expect(Storage::disk('s3')->get($intent->processed_key))->toBe($bytes);
    Storage::disk('s3')->assertMissing($intent->object_key);
});

it('keeps a PDF message attachment as it is', function (): void {
    $bytes = uploadFixture('doc.pdf');
    $intent = processUpload(uploadedIntent($bytes, UploadPurpose::MessageAttachment, 'application/pdf', 'quote.pdf'));

    expect($intent->status)->toBe(UploadStatus::Ready);
    expect(Storage::disk('s3')->get($intent->processed_key))->toBe($bytes);
});

it('keeps DXF blueprints as they are, ASCII and binary, whatever MIME type they were declared with', function (string $fixture, string $declared): void {
    $bytes = uploadFixture($fixture);
    $intent = processUpload(uploadedIntent($bytes, UploadPurpose::BlueprintSource, $declared, $fixture));

    expect($intent->status)->toBe(UploadStatus::Ready)
        ->and($intent->processed_key)->toEndWith('.dxf')
        ->and($intent->sniffed_mime)->toBe('image/vnd.dxf');
    expect(Storage::disk('s3')->get($intent->processed_key))->toBe($bytes);
})->with([
    ['plan.dxf', 'application/octet-stream'],
    ['plan.dxf', 'image/vnd.dxf'],
    ['plan.dxf', 'text/plain'],
    ['binary.dxf', 'application/dxf'],
]);

it('does not touch the pixels of a blueprint image', function (): void {
    $bytes = uploadFixture('exif-gps-rotated.jpg');
    $intent = processUpload(uploadedIntent($bytes, UploadPurpose::BlueprintSource, 'image/jpeg', 'photo.jpg'));

    expect($intent->status)->toBe(UploadStatus::Ready)->and($intent->width)->toBeNull();
    expect(Storage::disk('s3')->get($intent->processed_key))->toBe($bytes);
});

it('keeps a HEIC blueprint as it is and never calls the vision service', function (): void {
    Http::fake();
    $bytes = uploadFixture('minimal.heic');
    $intent = processUpload(uploadedIntent($bytes, UploadPurpose::BlueprintSource, 'application/octet-stream', 'IMG_1.heic'));

    expect($intent->status)->toBe(UploadStatus::Ready)->and($intent->processed_key)->toEndWith('.heic')->and($intent->sniffed_mime)->toBe('image/heic');
    expect(Storage::disk('s3')->get($intent->processed_key))->toBe($bytes);
    Http::assertNothingSent();
});

it('re-encodes PNG and WebP and keeps their type', function (string $fixture, string $mime, string $extension): void {
    $intent = processUpload(uploadedIntent(uploadFixture($fixture), UploadPurpose::ProjectCover, $mime, $fixture));

    expect($intent->status)->toBe(UploadStatus::Ready)
        ->and($intent->processed_key)->toEndWith('.'.$extension)
        ->and([$intent->width, $intent->height])->toBe([64, 48])
        ->and($intent->sniffed_mime)->toBe($mime);
    expect(Storage::disk('s3')->get($intent->processed_key))->not->toBe(uploadFixture($fixture));
})->with([['plain.png', 'image/png', 'png'], ['plain.webp', 'image/webp', 'webp']]);

it('resizes an avatar to 512 pixels and a texture to a 1024 pixel square', function (): void {
    $big = tempnam(sys_get_temp_dir(), 'big');
    imagejpeg(imagecreatetruecolor(1400, 700), $big, 80);
    $bytes = (string) file_get_contents($big);
    unlink($big);

    $avatar = processUpload(uploadedIntent($bytes, UploadPurpose::Avatar, 'image/jpeg', 'me.jpg'));
    $texture = processUpload(uploadedIntent($bytes, UploadPurpose::MaterialTexture, 'image/jpeg', 'oak.jpg'));

    expect([$avatar->width, $avatar->height])->toBe([512, 256])
        ->and([$texture->width, $texture->height])->toBe([1024, 1024]);
});

it('lets the declared family of a generic MIME type follow the extension', function (): void {
    $intent = processUpload(uploadedIntent(uploadFixture('plan.dxf'), UploadPurpose::BlueprintSource, 'application/octet-stream', 'plan.pdf'));

    expect($intent->status)->toBe(UploadStatus::Rejected)->and($intent->reason_code)->toBe('upload_type_mismatch');
});

it('accepts a PDF that starts with a preamble, as long as the marker is in the first KiB', function (): void {
    $bytes = str_repeat('x', 900).uploadFixture('doc.pdf');
    $intent = processUpload(uploadedIntent($bytes, UploadPurpose::BlueprintSource, 'application/pdf', 'plan.pdf'));

    expect($intent->status)->toBe(UploadStatus::Ready);
    expect(Storage::disk('s3')->get($intent->processed_key))->toBe($bytes);
});

it('rejects a file whose first bytes look like an image that libmagic does not recognise', function (): void {
    // The PNG signature and nothing a PNG has after it: `MagicBytes` says png, `finfo` says octet-stream.
    $intent = processUpload(uploadedIntent("\x89PNG\r\n\x1a\n".str_repeat('x', 24), UploadPurpose::Avatar, 'image/png', 'me.png'));

    expect($intent->status)->toBe(UploadStatus::Rejected)->and($intent->reason_code)->toBe('upload_type_mismatch');
});

it('leaves no temporary file behind, on success, on rejection and on error', function (): void {
    $before = tempFiles();
    $scratch = glob(sys_get_temp_dir().'/{sanitized,frame}-*', GLOB_BRACE);

    processUpload(uploadedIntent(uploadFixture('exif-gps-rotated.jpg'), UploadPurpose::ProductionPhoto, 'image/jpeg', 'a.jpg'));
    processUpload(uploadedIntent(uploadFixture('vector.svg'), UploadPurpose::Avatar, 'image/png', 'a.png'));
    processUpload(uploadedIntent(uploadFixture('bomb-50mp.png'), UploadPurpose::ProductionPhoto, 'image/png', 'a.png'));

    expect(tempFiles())->toBe($before)->and(leftoverObjects())->toBe([])
        ->and(glob(sys_get_temp_dir().'/{sanitized,frame}-*', GLOB_BRACE))->toBe($scratch);
});

it('does nothing for an intent that is not in the uploaded state', function (UploadStatus $status): void {
    $intent = uploadedIntent(uploadFixture('plain.png'), UploadPurpose::Avatar, 'image/png');
    $intent->forceFill(['status' => $status])->save();

    processUpload($intent);

    expect($intent->refresh()->status)->toBe($status)->and($intent->processed_key)->toBeNull();
    Storage::disk('s3')->assertExists($intent->object_key);
})->with([UploadStatus::Pending, UploadStatus::Ready, UploadStatus::Rejected, UploadStatus::Consumed]);

it('does nothing for an intent that no longer exists', function (): void {
    runProcessUpload('01J0000000000000000000000X');

    expect(UploadIntent::query()->count())->toBe(0);
});

describe('HEIC photos', function (): void {
    beforeEach(function (): void {
        config(['imports.vision.url' => 'http://vision.test:8000', 'imports.vision.token' => 'vision-secret']);
    });

    /** A plain JPEG, as the vision service would have written it. */
    function heicNormalisedJpeg(): string
    {
        $path = tempnam(sys_get_temp_dir(), 'jpg');
        imagejpeg(imagecreatetruecolor(120, 80), $path, 90);
        $bytes = (string) file_get_contents($path);
        unlink($path);

        return $bytes;
    }

    it('converts through the vision service, then runs the JPEG path on the result', function (): void {
        $sent = [];
        Http::fake(function (Request $request) use (&$sent) {
            $sent[] = $request;
            Storage::disk('s3')->put(FakeUploadPresigner::keyOf($request['targetUrl']), heicNormalisedJpeg());

            return Http::response(['width' => 120, 'height' => 80, 'bytes' => 1234]);
        });

        $intent = uploadedIntent(uploadFixture('minimal.heic'), UploadPurpose::ProductionPhoto, 'image/heic', 'IMG_1.HEIC');
        $intent = processUpload($intent);

        expect($sent)->toHaveCount(1);
        $request = $sent[0];
        expect($request->url())->toBe('http://vision.test:8000/v1/images/normalize')
            ->and($request->method())->toBe('POST')
            ->and($request->hasHeader('Authorization', 'Bearer vision-secret'))->toBeTrue()
            ->and($request->data())->toBe([
                'sourceUrl' => FakeUploadPresigner::HOST.'/'.$intent->object_key.'?op=get&expires='.now()->addMinutes(15)->getTimestamp(),
                'targetUrl' => $request['targetUrl'],
                'format' => 'jpeg',
                'quality' => 85,
                'maxEdge' => 4096,
                'applyOrientation' => true,
            ])
            ->and(FakeUploadPresigner::keyOf($request['targetUrl']))->toStartWith('tmp/production_photo/2030/06/');

        $presigner = app(UploadPresigner::class);
        expect($presigner->puts)->toHaveCount(1)
            ->and($presigner->puts[0]['contentType'])->toBe('image/jpeg')
            ->and($presigner->puts[0]['size'])->toBeNull()
            ->and($presigner->puts[0]['expiresAt']->equalTo(now()->addMinutes(15)))->toBeTrue();

        expect($intent->status)->toBe(UploadStatus::Ready)
            ->and($intent->processed_key)->toBe('uploads/production_photo/2030/06/'.$intent->id.'.jpg')
            ->and($intent->sniffed_mime)->toBe('image/jpeg')
            ->and([$intent->width, $intent->height])->toBe([120, 80]);
        expect(substr(Storage::disk('s3')->get($intent->processed_key), 0, 3))->toBe("\xFF\xD8\xFF");

        // Both temporary objects, the HEIC original and the converted copy, are gone.
        expect(leftoverObjects())->toBe([]);
    });

    it('takes the timeouts from the import settings, but never lets the call outlast the job', function (int $configured, int $expected): void {
        config(['imports.vision.normalize_timeout_s' => $configured]);
        $timeouts = null;
        Http::fake(function (Request $request, array $options) use (&$timeouts) {
            $timeouts = [$options['timeout'] ?? null, $options['connect_timeout'] ?? null];
            Storage::disk('s3')->put(FakeUploadPresigner::keyOf($request['targetUrl']), heicNormalisedJpeg());

            return Http::response(['width' => 120, 'height' => 80, 'bytes' => 1]);
        });

        processUpload(uploadedIntent(uploadFixture('minimal.heic'), UploadPurpose::IssuePhoto, 'image/heif', 'IMG_1.heif'));

        expect($timeouts)->toBe([$expected, 5]);
    })->with([[30, 30], [120, 50], [60, 50]]);

    it('rejects a HEIC file the vision service cannot decode', function (int $status): void {
        Http::fake(['*' => Http::response(['error' => ['code' => 'decode_failed', 'message' => 'x', 'retryable' => false]], $status)]);

        $intent = processUpload(uploadedIntent(uploadFixture('minimal.heic'), UploadPurpose::DeliveryPhoto, 'image/heic', 'IMG_1.heic'));

        expect($intent->status)->toBe(UploadStatus::Rejected)->and($intent->reason_code)->toBe('upload_corrupt');
        expect(leftoverObjects())->toBe([]);
    })->with([422, 413, 415]);

    it('keeps the upload for the next try when the vision service fails, and rejects it when the tries are used up', function (): void {
        Http::fake(['*' => Http::response(['error' => ['code' => 'upload_failed', 'message' => 'x', 'retryable' => true]], 502)]);
        $intent = uploadedIntent(uploadFixture('minimal.heic'), UploadPurpose::ProductionPhoto, 'image/heic', 'IMG_1.heic');

        expect(fn () => runProcessUpload($intent->id))->toThrow(RuntimeException::class);
        expect($intent->refresh()->status)->toBe(UploadStatus::Uploaded);
        Storage::disk('s3')->assertExists($intent->object_key);

        (new ProcessUpload($intent->id))->failed(new RuntimeException('gave up'));

        expect($intent->refresh()->status)->toBe(UploadStatus::Rejected)->and($intent->reason_code)->toBe('upload_processing_failed');
        expect(leftoverObjects())->toBe([]);
    });

    it('treats a vision service that cannot be reached like a failure to retry', function (): void {
        Http::fake(fn () => throw new ConnectionException('refused'));
        $intent = uploadedIntent(uploadFixture('minimal.heic'), UploadPurpose::ProductionPhoto, 'image/heic', 'IMG_1.heic');

        expect(fn () => runProcessUpload($intent->id))->toThrow(ConnectionException::class);
        expect($intent->refresh()->status)->toBe(UploadStatus::Uploaded);
    });

    it('rejects a conversion that did not produce a JPEG', function (): void {
        Http::fake(function (Request $request) {
            Storage::disk('s3')->put(FakeUploadPresigner::keyOf($request['targetUrl']), uploadFixture('vector.svg'));

            return Http::response(['width' => 1, 'height' => 1, 'bytes' => 1]);
        });

        $intent = processUpload(uploadedIntent(uploadFixture('minimal.heic'), UploadPurpose::ProductionPhoto, 'image/heic', 'IMG_1.heic'));

        expect($intent->status)->toBe(UploadStatus::Rejected)->and($intent->reason_code)->toBe('upload_corrupt');
        expect(leftoverObjects())->toBe([]);
    });

    it('is the converter the application binds', function (): void {
        expect(app(HeicConverter::class))->toBeInstanceOf(VisionHeicConverter::class);
    });
});

it('carries the reason of a rejection', function (): void {
    expect((new UploadRejected('upload_corrupt'))->reason)->toBe('upload_corrupt');
});
