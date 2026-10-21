<?php

declare(strict_types=1);

use App\Support\Uploads\FileName;

it('keeps the last path segment', function (string $input, string $expected): void {
    expect(FileName::sanitize($input))->toBe($expected);
})->with([
    'traversal' => ['../../etc/passwd', 'passwd'],
    'windows path' => ['C:\\Users\\anna\\plan.pdf', 'plan.pdf'],
    'mixed separators' => ['..\\..//secret/notes.txt', 'notes.txt'],
]);

it('drops bidi and control characters and takes the canonical extension', function (): void {
    $name = FileName::sanitize("invoice\u{202E}gpj.exe", 'pdf');

    expect($name)->toBe('invoicegpj.pdf')
        ->and(preg_match('/[\p{C}]/u', $name))->toBe(0)
        ->and($name)->toEndWith('.pdf');
});

it('removes control characters inside the name', function (): void {
    expect(FileName::sanitize("a\x00b\x1Fc\u{200B}d.png"))->toBe('abcd.png');
});

it('cuts a 300 character name to 100 characters and keeps the extension', function (): void {
    $name = FileName::sanitize(str_repeat('a', 300).'.png');

    expect(mb_strlen($name))->toBeLessThanOrEqual(100)
        ->and($name)->toEndWith('.png')
        ->and($name)->toBe(str_repeat('a', 96).'.png');
});

it('cuts by characters, not bytes', function (): void {
    $name = FileName::sanitize(str_repeat('é', 200).'.pdf');

    expect(mb_strlen($name))->toBe(100)->and($name)->toEndWith('.pdf');
});

it('replaces emoji and symbols', function (): void {
    $name = FileName::sanitize('🛋️ sofa.png');

    expect($name)->toEndWith('sofa.png')
        ->and(preg_match('/[^\p{L}\p{N} ._()-]/u', $name))->toBe(0)
        ->and($name)->toBe('_sofa.png');
});

it('answers file for a name with nothing in it', function (string $input): void {
    expect(FileName::sanitize($input))->toBe('file');
})->with(['   ', '', '...', '../', "\u{202E}", ' . . ']);

it('adds the canonical extension to a name without one and to an empty name', function (): void {
    expect(FileName::sanitize('scan', 'pdf'))->toBe('scan.pdf')
        ->and(FileName::sanitize('   ', 'jpg'))->toBe('file.jpg');
});

it('replaces only the last extension by the canonical one', function (): void {
    expect(FileName::sanitize('photo.png', 'jpg'))->toBe('photo.jpg')
        ->and(FileName::sanitize('report.pdf.exe', 'pdf'))->toBe('report.pdf.pdf')
        ->and(FileName::sanitize('archive.tar.gz'))->toBe('archive.tar.gz');
});

it('normalises to NFC, trims dots and spaces and collapses runs', function (): void {
    expect(FileName::sanitize("cafe\u{301}.png"))->toBe("caf\u{E9}.png")
        ->and(FileName::sanitize('  .hidden  '))->toBe('hidden')
        ->and(FileName::sanitize('a   b.png'))->toBe('a b.png')
        ->and(FileName::sanitize('a<>:"|?*b.png'))->toBe('a_b.png')
        ->and(FileName::sanitize('plan (1)-final_v2.pdf'))->toBe('plan (1)-final_v2.pdf');
});

it('keeps letters and digits of every script', function (): void {
    expect(FileName::sanitize('Küche Entwurf №3 — 日本語.pdf'))->toBe('Küche Entwurf_3_日本語.pdf');
});
