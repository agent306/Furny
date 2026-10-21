<?php

declare(strict_types=1);

use App\Support\Uploads\ImageSanitizer;
use App\Support\Uploads\UploadRejected;

/** Corner colours of the stored picture: top left, top right, bottom left, bottom right. */
const SANITIZER_CORNERS = ['red' => [255, 0, 0], 'green' => [0, 255, 0], 'blue' => [0, 0, 255], 'yellow' => [255, 255, 0]];

function sanitizerQuadrants(int $width = 40, int $height = 24): GdImage
{
    $image = imagecreatetruecolor($width, $height);
    $halfW = intdiv($width, 2);
    $halfH = intdiv($height, 2);
    $fill = static function (int $x, int $y, array $rgb) use ($image, $halfW, $halfH, $width, $height): void {
        imagefilledrectangle($image, $x, $y, $x === 0 ? $halfW - 1 : $width - 1, $y === 0 ? $halfH - 1 : $height - 1, imagecolorallocate($image, ...$rgb));
    };
    $fill(0, 0, SANITIZER_CORNERS['red']);
    $fill($halfW, 0, SANITIZER_CORNERS['green']);
    $fill(0, $halfH, SANITIZER_CORNERS['blue']);
    $fill($halfW, $halfH, SANITIZER_CORNERS['yellow']);

    return $image;
}

/** Sanitises and removes the output when the test process ends. @return array{path: string, width: int, height: int} */
function sanitizerRun(string $path, string $type, ?int $maxEdge, bool $square = false): array
{
    $result = ImageSanitizer::sanitize($path, $type, $maxEdge, $square);
    register_shutdown_function(static fn () => @unlink($result['path']));

    return $result;
}

function sanitizerTemp(string $suffix = ''): string
{
    $base = (string) tempnam(sys_get_temp_dir(), 'sanitize');
    $path = $base.$suffix;
    register_shutdown_function(static function () use ($base, $path): void {
        @unlink($base);
        @unlink($path);
    });

    return $path;
}

/** A JPEG of the four quadrants with an EXIF APP1 segment that holds only the Orientation tag. */
function sanitizerJpegWithOrientation(int $orientation): string
{
    $plain = sanitizerTemp();
    imagejpeg(sanitizerQuadrants(), $plain, 100);

    $tiff = "II*\0".pack('V', 8).pack('v', 1).pack('vvV', 0x0112, 3, 1).pack('vv', $orientation, 0).pack('V', 0);
    $app1 = "\xFF\xE1".pack('n', 2 + 6 + strlen($tiff))."Exif\0\0".$tiff;
    $bytes = file_get_contents($plain);
    $path = sanitizerTemp('.jpg');
    file_put_contents($path, substr($bytes, 0, 2).$app1.substr($bytes, 2));

    return $path;
}

function sanitizerColourName(GdImage $image, int $x, int $y): string
{
    $rgb = imagecolorat($image, $x, $y);
    $sample = [($rgb >> 16) & 0xFF, ($rgb >> 8) & 0xFF, $rgb & 0xFF];
    $best = null;
    $bestDistance = PHP_INT_MAX;

    foreach (SANITIZER_CORNERS as $name => $reference) {
        $distance = array_sum(array_map(static fn (int $a, int $b): int => ($a - $b) ** 2, $sample, $reference));
        if ($distance < $bestDistance) {
            [$best, $bestDistance] = [$name, $distance];
        }
    }

    return (string) $best;
}

/** @return list<string> the colour at the top left, top right, bottom left and bottom right of the image */
function sanitizerCorners(string $path): array
{
    $image = imagecreatefromjpeg($path);
    $width = imagesx($image);
    $height = imagesy($image);

    return [
        sanitizerColourName($image, 2, 2),
        sanitizerColourName($image, $width - 3, 2),
        sanitizerColourName($image, 2, $height - 3),
        sanitizerColourName($image, $width - 3, $height - 3),
    ];
}

function sanitizerPngHeader(int $width, int $height): string
{
    $chunk = static fn (string $kind, string $payload): string => pack('N', strlen($payload)).$kind.$payload.pack('N', crc32($kind.$payload));
    $path = sanitizerTemp('.png');
    file_put_contents($path, "\x89PNG\r\n\x1a\n".$chunk('IHDR', pack('NNCCCCC', $width, $height, 8, 2, 0, 0, 0)).$chunk('IDAT', gzcompress(str_repeat("\0", 16))).$chunk('IEND', ''));

    return $path;
}

it('applies the EXIF orientation to the pixels and keeps no orientation tag', function (int $orientation, array $expectedCorners, bool $swapsSides): void {
    $result = sanitizerRun(sanitizerJpegWithOrientation($orientation), 'jpeg', null);

    expect($result['width'])->toBe($swapsSides ? 24 : 40)
        ->and($result['height'])->toBe($swapsSides ? 40 : 24)
        ->and(sanitizerCorners($result['path']))->toBe($expectedCorners);

    $exif = @exif_read_data($result['path']);
    expect($exif === false || ! isset($exif['Orientation']))->toBeTrue();
})->with([
    'normal' => [1, ['red', 'green', 'blue', 'yellow'], false],
    'mirrored' => [2, ['green', 'red', 'yellow', 'blue'], false],
    'upside down' => [3, ['yellow', 'blue', 'green', 'red'], false],
    'flipped' => [4, ['blue', 'yellow', 'red', 'green'], false],
    'transposed' => [5, ['red', 'blue', 'green', 'yellow'], true],
    'rotate clockwise' => [6, ['blue', 'red', 'yellow', 'green'], true],
    'transversed' => [7, ['yellow', 'green', 'blue', 'red'], true],
    'rotate counter-clockwise' => [8, ['green', 'yellow', 'red', 'blue'], true],
]);

it('writes a progressive JPEG', function (): void {
    $result = sanitizerRun(sanitizerJpegWithOrientation(1), 'jpeg', null);

    // SOF2 (progressive DCT) instead of SOF0 (baseline).
    expect(file_get_contents($result['path']))->toContain("\xFF\xC2")->not->toContain("\xFF\xC0");
});

it('drops the metadata of the fixture with GPS data', function (): void {
    $fixture = base_path('tests/fixtures/uploads/exif-gps-rotated.jpg');
    expect(@exif_read_data($fixture, null, true))->toHaveKey('GPS');

    $result = sanitizerRun($fixture, 'jpeg', null);
    $exif = @exif_read_data($result['path'], null, true);

    expect($result['width'])->toBe(300)->and($result['height'])->toBe(400)
        ->and(is_array($exif) && array_key_exists('GPS', $exif))->toBeFalse()
        ->and(file_get_contents($result['path']))->not->toContain('Exif')->not->toContain('Furny Test Camera');
});

it('keeps the alpha channel of a PNG', function (): void {
    $result = sanitizerRun(base_path('tests/fixtures/uploads/plain.png'), 'png', null);
    $image = imagecreatefrompng($result['path']);

    // The fixture is transparent in its middle band and opaque in the corners.
    expect([$result['width'], $result['height']])->toBe([64, 48])
        ->and((imagecolorat($image, 30, 24) >> 24) & 0x7F)->toBe(127)
        ->and((imagecolorat($image, 2, 2) >> 24) & 0x7F)->toBe(0);
});

it('re-encodes a WebP and writes a WebP', function (): void {
    $result = sanitizerRun(base_path('tests/fixtures/uploads/plain.webp'), 'webp', null);

    expect([$result['width'], $result['height']])->toBe([64, 48])
        ->and(substr(file_get_contents($result['path']), 8, 4))->toBe('WEBP');
});

it('keeps the first frame of an animated WebP', function (): void {
    $result = sanitizerRun(base_path('tests/fixtures/uploads/animated.webp'), 'webp', null);
    $bytes = file_get_contents($result['path']);
    $image = imagecreatefromwebp($result['path']);

    // The first frame has a red corner block on grey; the second frame is solid cyan.
    expect([$result['width'], $result['height']])->toBe([32, 32])
        ->and(str_contains($bytes, 'ANIM'))->toBeFalse()
        ->and(sanitizerColourName($image, 1, 1))->toBe('red');
});

it('shrinks to the longer edge and never enlarges', function (): void {
    $source = sanitizerTemp('.jpg');
    imagejpeg(sanitizerQuadrants(200, 100), $source, 90);

    $smaller = sanitizerRun($source, 'jpeg', 50);
    $same = sanitizerRun($source, 'jpeg', 512);

    expect([$smaller['width'], $smaller['height']])->toBe([50, 25])
        ->and([$same['width'], $same['height']])->toBe([200, 100]);
});

it('cuts the middle square and resizes it to the edge when asked for a square', function (): void {
    $source = sanitizerTemp('.png');
    imagepng(sanitizerQuadrants(200, 100), $source);

    $result = sanitizerRun($source, 'png', 64, square: true);
    $image = imagecreatefrompng($result['path']);

    // The 100 x 100 middle of 200 x 100 holds the right half of the red/blue quadrants and the left half of green/yellow.
    expect([$result['width'], $result['height']])->toBe([64, 64])
        ->and([imagesx($image), imagesy($image)])->toBe([64, 64])
        ->and(sanitizerColourName($image, 2, 2))->toBe('red')
        ->and(sanitizerColourName($image, 61, 2))->toBe('green')
        ->and(sanitizerColourName($image, 2, 61))->toBe('blue')
        ->and(sanitizerColourName($image, 61, 61))->toBe('yellow');
});

it('enlarges a small square texture to the edge', function (): void {
    $source = sanitizerTemp('.jpg');
    imagejpeg(sanitizerQuadrants(30, 30), $source, 90);

    $result = sanitizerRun($source, 'jpeg', 100, square: true);

    expect([$result['width'], $result['height']])->toBe([100, 100]);
});

it('refuses an image over 40 megapixels from its header, before it decodes anything', function (): void {
    $before = memory_get_peak_usage(true);

    expect(fn () => sanitizerRun(base_path('tests/fixtures/uploads/bomb-50mp.png'), 'png', null))
        ->toThrow(fn (UploadRejected $e) => expect($e->reason)->toBe('upload_image_too_large'));

    // 50 megapixels would need 200 MB as a GD true colour image.
    expect(memory_get_peak_usage(true) - $before)->toBeLessThan(50 * 1024 * 1024);
});

it('refuses a side over 12000 pixels, and accepts 12000', function (): void {
    expect(fn () => sanitizerRun(sanitizerPngHeader(12_001, 1), 'png', null))
        ->toThrow(fn (UploadRejected $e) => expect($e->reason)->toBe('upload_image_too_large'));

    // 12000 x 1 passes the header check; the pixel data is not there, so decoding fails.
    expect(fn () => sanitizerRun(sanitizerPngHeader(12_000, 1), 'png', null))
        ->toThrow(fn (UploadRejected $e) => expect($e->reason)->toBe('upload_corrupt'));
});

it('refuses a file that is not a decodable image of the declared kind', function (string $type, string $contents): void {
    $path = sanitizerTemp();
    file_put_contents($path, $contents);

    expect(fn () => sanitizerRun($path, $type, null))
        ->toThrow(fn (UploadRejected $e) => expect($e->reason)->toBe('upload_corrupt'));
})->with([
    'truncated jpeg' => ['jpeg', "\xFF\xD8\xFF\xE0\0\x10JFIF\0"],
    'garbage as png' => ['png', 'not a png at all'],
    'empty webp' => ['webp', ''],
]);

it('writes its output to the temporary directory, never next to the input', function (): void {
    $directory = base_path('tests/fixtures/uploads');
    $before = glob($directory.'/*');

    $result = sanitizerRun($directory.'/plain.png', 'png', null);

    expect(dirname($result['path']))->toBe(rtrim(sys_get_temp_dir(), '/'))
        ->and(glob($directory.'/*'))->toBe($before);
});

it('writes its output where it is told to', function (): void {
    $directory = sys_get_temp_dir().'/sanitize-dir-'.uniqid();
    mkdir($directory);

    $result = ImageSanitizer::sanitize(base_path('tests/fixtures/uploads/plain.png'), 'png', null, directory: $directory);

    // PHP on Windows joins with a backslash; the directory is the same either way.
    expect(str_replace('\\', '/', dirname($result['path'])))->toBe(str_replace('\\', '/', $directory));
    unlink($result['path']);
    rmdir($directory);
});

it('refuses an animated WebP whose first frame is a bomb, though its canvas is small', function (string $fixture): void {
    // The canvas says 64 x 64; the frame's own bitstream says 121 or 48 megapixels.
    $before = memory_get_peak_usage(true);

    expect(fn () => ImageSanitizer::sanitize(base_path('tests/fixtures/uploads/'.$fixture), 'webp', 4096))
        ->toThrow(fn (UploadRejected $e) => expect($e->reason)->toBe('upload_image_too_large'));

    expect(memory_get_peak_usage(true) - $before)->toBeLessThan(50 * 1024 * 1024)
        ->and(glob(sys_get_temp_dir().'/frame-*'))->toBe([]);
})->with(['animated-frame-bomb-121mp.webp', 'animated-frame-bomb-48mp.webp']);

it('refuses an animated WebP whose first frame is larger than its canvas', function (): void {
    expect(fn () => ImageSanitizer::sanitize(base_path('tests/fixtures/uploads/animated-frame-over-canvas.webp'), 'webp', null))
        ->toThrow(fn (UploadRejected $e) => expect($e->reason)->toBe('upload_corrupt'));
});
