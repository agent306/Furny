<?php

declare(strict_types=1);

use App\Domain\Settings\Models\AppSetting;
use App\Support\Numbers\NumberSequence;
use App\Support\Numbers\OrderNumber;
use App\Support\Numbers\QuoteNumber;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

it('counts from 1 per key', function (): void {
    expect(NumberSequence::next('order:2026'))->toBe(1)
        ->and(NumberSequence::next('order:2026'))->toBe(2)
        ->and(NumberSequence::next('order:2027'))->toBe(1)
        ->and(NumberSequence::next('order:2026'))->toBe(3)
        ->and(DB::table('number_sequences')->where('key', 'order:2026')->value('last_value'))->toBe(3);
});

it('keeps the sequence when the caller transaction commits and rolls it back with the caller', function (): void {
    NumberSequence::next('order:2026');

    try {
        DB::transaction(function (): void {
            NumberSequence::next('order:2026');

            throw new RuntimeException('abort');
        });
    } catch (RuntimeException) {
    }

    expect(NumberSequence::next('order:2026'))->toBe(2);
});

it('formats order numbers with the year in the business time zone', function (): void {
    AppSetting::query()->delete();

    expect(OrderNumber::next(CarbonImmutable::parse('2026-03-01 10:00', 'UTC')))->toBe('ORD-2026-00001')
        ->and(OrderNumber::next(CarbonImmutable::parse('2026-12-31 19:00', 'UTC')))->toBe('ORD-2027-00001')
        ->and(OrderNumber::next(CarbonImmutable::parse('2026-12-31 18:29', 'UTC')))->toBe('ORD-2026-00002')
        ->and(OrderNumber::next(CarbonImmutable::parse('2026-12-31 18:30', 'UTC')))->toBe('ORD-2027-00002');
});

it('uses the configured business time zone and does not mutate the given time', function (): void {
    AppSetting::query()->delete();
    AppSetting::query()->create(['key' => 'business', 'value' => ['timezone' => 'America/Los_Angeles']]);
    $at = CarbonImmutable::parse('2027-01-01 03:00', 'UTC');

    expect(OrderNumber::next($at))->toBe('ORD-2026-00001')
        ->and($at->timezoneName)->toBe('UTC');
});

it('defaults to the current time', function (): void {
    AppSetting::query()->delete();
    $this->travelTo(CarbonImmutable::parse('2030-06-15 12:00', 'UTC'));

    expect(OrderNumber::next())->toBe('ORD-2030-00001');
});

it('builds draft and quote numbers', function (): void {
    expect(OrderNumber::draft(str_repeat('0', 18).'ABCDEFGH'))->toBe('DRAFT-ABCDEFGH')
        ->and(QuoteNumber::for('ORD-2026-00042', 3))->toBe('ORD-2026-00042-Q3');
});
