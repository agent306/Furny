<?php

declare(strict_types=1);

use Illuminate\Support\Facades\Log;

it('renders simple placeholders', function (): void {
    expect(trans_icu('common.photo_n', ['n' => 3]))->toBe('Photo 3');
});

it('renders ICU plurals with the number sign', function (): void {
    expect(trans_icu('common.counts.items', ['count' => 1]))->toBe('1 item')
        ->and(trans_icu('common.counts.items', ['count' => 4]))->toBe('4 items');
});

it('returns the key and logs one warning when the key is missing', function (): void {
    Log::shouldReceive('warning')->once();

    expect(trans_icu('common.does_not_exist'))->toBe('common.does_not_exist');
});

it('treats a key that names a group of messages as missing', function (): void {
    Log::shouldReceive('warning')->once();

    expect(trans_icu('common.counts'))->toBe('common.counts');
});

it('uses the given locale instead of the application locale', function (): void {
    expect(trans_icu('common.counts.items', ['count' => 2], 'en'))->toBe('2 items');
});
