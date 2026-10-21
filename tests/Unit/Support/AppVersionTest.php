<?php

declare(strict_types=1);

use App\Support\AppVersion;

it('uses the first seven characters of the source commit when no version is set', function (): void {
    expect(AppVersion::resolve(null, 'abcdef1234'))->toBe('abcdef1');
});

it('prefers an explicit version over the source commit', function (): void {
    expect(AppVersion::resolve('1.4.0', 'abc'))->toBe('1.4.0');
});

it('falls back to dev when neither is known', function (): void {
    expect(AppVersion::resolve(null, null))->toBe('dev')
        ->and(AppVersion::resolve('', ''))->toBe('dev');
});

it('treats an empty version as unset', function (): void {
    expect(AppVersion::resolve('', 'abcdef1234'))->toBe('abcdef1');
});
