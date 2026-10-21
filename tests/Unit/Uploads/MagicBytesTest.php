<?php

declare(strict_types=1);

use App\Support\Uploads\MagicBytes;

/** The bytes of a fixture of `tests/fixtures/uploads` as a temporary file (the tests never modify the fixtures). */
function magicBytesFile(string $contents): string
{
    $path = tempnam(sys_get_temp_dir(), 'magic');
    file_put_contents($path, $contents);
    register_shutdown_function(static fn () => @unlink($path));

    return $path;
}

it('detects the type of every fixture', function (string $fixture, ?string $expected): void {
    expect(MagicBytes::detect(base_path('tests/fixtures/uploads/'.$fixture)))->toBe($expected);
})->with([
    'jpeg with EXIF' => ['exif-gps-rotated.jpg', 'jpeg'],
    'png' => ['plain.png', 'png'],
    'webp' => ['plain.webp', 'webp'],
    'animated webp' => ['animated.webp', 'webp'],
    'png named .jpg' => ['png-as-jpg.jpg', 'png'],
    'pdf' => ['doc.pdf', 'pdf'],
    'ascii dxf' => ['plan.dxf', 'dxf'],
    'binary dxf' => ['binary.dxf', 'dxf'],
    'dwg named .dxf' => ['drawing-as-dxf.dxf', 'dwg'],
    'svg' => ['vector.svg', null],
    'png header of 50 megapixels' => ['bomb-50mp.png', 'png'],
    'heic' => ['minimal.heic', 'heic'],
]);

it('finds the PDF marker anywhere in the first 1024 bytes', function (): void {
    $path = magicBytesFile(str_repeat('x', 900)."%PDF-1.7\n".str_repeat('y', 200));

    expect(MagicBytes::detect($path))->toBe('pdf');
});

it('does not look for the PDF marker beyond the first 1024 bytes', function (): void {
    expect(MagicBytes::detect(magicBytesFile(str_repeat('x', 1100).'%PDF-1.7')))->toBeNull();
});

it('detects an ASCII DXF after blank lines, with CRLF, with spaces around the group codes and after a byte order mark', function (string $contents): void {
    expect(MagicBytes::detect(magicBytesFile($contents)))->toBe('dxf');
})->with([
    'blank lines' => ["\n\n\n  0\nSECTION\n  2\nHEADER\n"],
    'CRLF' => ["0\r\nSECTION\r\n2\r\nENTITIES\r\n"],
    'padded group code' => ["  0 \nSECTION\n"],
    'byte order mark' => ["\xEF\xBB\xBF0\nSECTION\n2\nHEADER\n"],
]);

it('does not take other text for a DXF', function (string $contents): void {
    expect(MagicBytes::detect(magicBytesFile($contents)))->toBeNull();
})->with([
    'a different section word' => ["0\nSECTIONS\n"],
    'a different group code' => ["10\nSECTION\n"],
    'prose' => ["0 is a number\nSECTION is a word\n"],
    'empty' => [''],
    'text' => ["hello world\n"],
]);

it('detects every HEIC brand and nothing else of the ftyp family', function (string $brand, ?string $expected): void {
    $contents = pack('N', 24).'ftyp'.$brand.str_repeat("\0", 16);

    expect(MagicBytes::detect(magicBytesFile($contents)))->toBe($expected);
})->with([
    ['heic', 'heic'], ['heix', 'heic'], ['hevc', 'heic'], ['heim', 'heic'], ['heis', 'heic'], ['mif1', 'heic'], ['msf1', 'heic'],
    'mp4' => ['isom', null],
    'avif' => ['avif', null],
]);

it('detects DWG headers from AC1000 on, including the sample versions', function (string $version): void {
    expect(MagicBytes::detect(magicBytesFile($version.str_repeat("\0", 40))))->toBe('dwg');
})->with(['AC1012', 'AC1014', 'AC1015', 'AC1018', 'AC1021', 'AC1024', 'AC1027', 'AC1032']);

it('tells a RIFF file that is not WebP from a WebP', function (): void {
    expect(MagicBytes::detect(magicBytesFile('RIFF'."\x10\0\0\0".'WAVEfmt ')))->toBeNull();
});

it('returns null for a missing file', function (): void {
    expect(MagicBytes::detect(sys_get_temp_dir().'/does-not-exist-'.uniqid()))->toBeNull();
});

it('knows the canonical extension and MIME type of each type', function (): void {
    expect(MagicBytes::extension('jpeg'))->toBe('jpg')
        ->and(MagicBytes::extension('heic'))->toBe('heic')
        ->and(MagicBytes::mime('dxf'))->toBe('image/vnd.dxf')
        ->and(MagicBytes::mime('webp'))->toBe('image/webp')
        ->and(MagicBytes::typeOfMime('image/heif'))->toBe('heic')
        ->and(MagicBytes::typeOfMime('application/octet-stream'))->toBeNull()
        ->and(MagicBytes::typeOfExtension('JPEG'))->toBe('jpeg')
        ->and(MagicBytes::typeOfExtension('heif'))->toBe('heic')
        ->and(MagicBytes::typeOfExtension('dwg'))->toBeNull()
        ->and(MagicBytes::typeOfExtension('bmp'))->toBeNull();
});

it('lets a generic MIME type go with the extensions of its kind only', function (string $mime, string $extension, bool $expected): void {
    expect(MagicBytes::genericMimeFits($mime, $extension))->toBe($expected);
})->with([
    ['application/octet-stream', 'dxf', true],
    ['application/octet-stream', 'heic', true],
    ['application/octet-stream', 'heif', true],
    ['application/octet-stream', 'jpg', false],
    ['text/plain', 'dxf', true],
    ['text/plain', 'heic', false],
    ['image/png', 'png', false],
]);

it('knows which MIME types are generic', function (): void {
    expect(MagicBytes::GENERIC_MIMES)->toBe(['application/octet-stream', 'text/plain']);
});
