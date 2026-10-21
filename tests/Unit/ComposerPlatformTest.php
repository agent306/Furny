<?php

declare(strict_types=1);

/**
 * @return array<string, mixed>
 */
function composerManifest(): array
{
    /** @var array<string, mixed> $manifest */
    $manifest = json_decode((string) file_get_contents(base_path('composer.json')), true, flags: JSON_THROW_ON_ERROR);

    return $manifest;
}

it('requires PHP 8.4', function (): void {
    expect(composerManifest()['require']['php'])->toBe('^8.4');
});

it('declares exactly the required PHP extensions', function (): void {
    $extensions = array_values(array_filter(
        array_keys(composerManifest()['require']),
        fn (string $package): bool => str_starts_with($package, 'ext-'),
    ));
    sort($extensions);

    expect($extensions)->toBe([
        'ext-bcmath', 'ext-exif', 'ext-fileinfo', 'ext-gd', 'ext-intl', 'ext-pcntl',
        'ext-pdo_pgsql', 'ext-posix', 'ext-redis', 'ext-sodium', 'ext-zip',
    ]);
});

it('pins laravel/wayfinder exactly', function (): void {
    expect(composerManifest()['require']['laravel/wayfinder'])->toBe('0.1.23');
});

it('keeps Telescope out of package discovery', function (): void {
    expect(composerManifest()['extra']['laravel']['dont-discover'])->toContain('laravel/telescope');
});
