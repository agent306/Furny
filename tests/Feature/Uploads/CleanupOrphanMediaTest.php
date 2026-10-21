<?php

declare(strict_types=1);

use App\Domain\Shared\Enums\UploadStatus;
use App\Domain\Shared\Models\UploadIntent;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Storage;

beforeEach(function (): void {
    $this->travelTo(CarbonImmutable::parse('2030-06-15 12:00:00', 'UTC'));
});

/** An intent created `$hoursAgo` hours ago, with its tmp object (and its processed object when it has a key). */
function orphanIntent(int $hoursAgo, string $state = 'pending'): UploadIntent
{
    $factory = match ($state) {
        'pending' => UploadIntent::factory(),
        'uploaded' => UploadIntent::factory()->uploaded(),
        'ready' => UploadIntent::factory()->ready(),
        'rejected' => UploadIntent::factory()->rejected(),
        'expired' => UploadIntent::factory()->expired(),
        'consumed' => UploadIntent::factory()->consumed(),
    };
    $intent = $factory->create(['created_at' => now()->subHours($hoursAgo), 'updated_at' => now()->subHours($hoursAgo)]);

    Storage::disk('s3')->put($intent->object_key, 'tmp');
    if ($intent->processed_key !== null) {
        Storage::disk('s3')->put($intent->processed_key, 'processed');
    }

    return $intent;
}

it('deletes a pending intent 25 hours old with its object', function (): void {
    $old = orphanIntent(25);

    $this->artisan('media:cleanup-orphans')->assertSuccessful();

    expect(UploadIntent::query()->whereKey($old->id)->exists())->toBeFalse();
    Storage::disk('s3')->assertMissing($old->object_key);
});

it('keeps consumed intents and intents under 24 hours old', function (): void {
    $consumed = orphanIntent(48, 'consumed');
    $young = orphanIntent(23);
    $ready = orphanIntent(23, 'ready');

    $this->artisan('media:cleanup-orphans')->assertSuccessful();

    expect(UploadIntent::query()->count())->toBe(3);
    Storage::disk('s3')->assertExists($consumed->object_key);
    Storage::disk('s3')->assertExists($consumed->processed_key);
    Storage::disk('s3')->assertExists($young->object_key);
    Storage::disk('s3')->assertExists($ready->processed_key);
});

it('deletes the processed object of an intent that was never consumed', function (string $state): void {
    $intent = orphanIntent(30, $state);

    $this->artisan('media:cleanup-orphans')->assertSuccessful();

    expect(UploadIntent::query()->whereKey($intent->id)->exists())->toBeFalse();
    Storage::disk('s3')->assertMissing($intent->object_key);
    if ($intent->processed_key !== null) {
        Storage::disk('s3')->assertMissing($intent->processed_key);
    }
})->with(['pending', 'uploaded', 'ready', 'rejected', 'expired']);

it('goes by the creation time, not by the last change', function (): void {
    $intent = orphanIntent(30);
    $intent->forceFill(['updated_at' => now()])->saveQuietly();

    $this->artisan('media:cleanup-orphans')->assertSuccessful();

    expect(UploadIntent::query()->count())->toBe(0);
});

it('still deletes the row when its object is already gone, and says how many it removed', function (): void {
    $gone = orphanIntent(26);
    Storage::disk('s3')->delete($gone->object_key);
    orphanIntent(27);
    orphanIntent(1);

    $this->artisan('media:cleanup-orphans')->expectsOutputToContain('Deleted 2 upload intents.')->assertSuccessful();

    expect(UploadIntent::query()->count())->toBe(1);
});

it('has nothing to say when there is nothing to delete', function (): void {
    $this->artisan('media:cleanup-orphans')->expectsOutputToContain('Deleted 0 upload intents.')->assertSuccessful();
});

it('handles more rows than one chunk', function (): void {
    UploadIntent::factory()->count(250)->create(['created_at' => now()->subHours(30)]);
    $keep = UploadIntent::factory()->consumed()->create(['created_at' => now()->subHours(30)]);

    $this->artisan('media:cleanup-orphans')->expectsOutputToContain('Deleted 250 upload intents.')->assertSuccessful();

    expect(UploadIntent::query()->pluck('id')->all())->toBe([$keep->id])
        ->and($keep->status)->toBe(UploadStatus::Consumed);
});
