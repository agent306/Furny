<?php

declare(strict_types=1);

use App\Domain\Identity\Models\User;
use App\Domain\Shared\Enums\UploadPurpose;
use App\Domain\Shared\Enums\UploadStatus;
use App\Domain\Shared\Jobs\ProcessUpload;
use App\Domain\Shared\Models\UploadIntent;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Illuminate\Testing\TestResponse;

beforeEach(function (): void {
    $this->travelTo(CarbonImmutable::parse('2030-06-15 12:00:00', 'UTC'));
    Queue::fake();
});

/** A pending intent for a PNG of the given declared size, with the object at its key when `$stored` is not null. */
function confirmIntent(User $user, int $declared = 1000, ?int $stored = 1000, array $state = []): UploadIntent
{
    $intent = UploadIntent::factory()->for($user)->create(['declared_size' => $declared] + $state);

    if ($stored !== null) {
        Storage::disk('s3')->put($intent->object_key, str_repeat('x', $stored));
    }

    return $intent;
}

function confirm(User $user, UploadIntent $intent): TestResponse
{
    return test()->actingAs($user)->postJson(route('api.uploads.confirm', $intent));
}

it('accepts an object of the declared size, marks the intent uploaded and queues the processing', function (): void {
    $user = User::factory()->create();
    $intent = confirmIntent($user);

    confirm($user, $intent)->assertStatus(202)->assertExactJson(['uploadId' => $intent->id, 'status' => 'processing']);

    expect($intent->refresh()->status)->toBe(UploadStatus::Uploaded);
    Storage::disk('s3')->assertExists($intent->object_key);
    Queue::assertPushed(ProcessUpload::class, 1);
    Queue::assertPushedOn('default', ProcessUpload::class, fn (ProcessUpload $job): bool => $job->uploadId === $intent->id);
});

it('queues a job with a 60 second timeout and two tries', function (): void {
    $job = new ProcessUpload('01J0000000000000000000000X');

    expect($job->timeout)->toBe(60)->and($job->tries)->toBe(2)->and($job->queue)->toBe('default');
});

it('rejects an object of another size, deletes it and answers 422', function (int $stored): void {
    $user = User::factory()->create();
    $intent = confirmIntent($user, 1000, $stored);

    confirm($user, $intent)
        ->assertUnprocessable()
        ->assertJsonPath('code', 'upload_size_mismatch')
        ->assertJsonPath('message', trans_icu('uploads.errors.upload_size_mismatch'));

    $intent->refresh();
    expect($intent->status)->toBe(UploadStatus::Rejected)->and($intent->reason_code)->toBe('upload_size_mismatch');
    Storage::disk('s3')->assertMissing($intent->object_key);
    Queue::assertNothingPushed();
})->with([999, 1001, 0, 5_000_000]);

it('leaves the intent pending when the object is not there yet', function (): void {
    $user = User::factory()->create();
    $intent = confirmIntent($user, stored: null);

    confirm($user, $intent)->assertUnprocessable()->assertJsonPath('code', 'upload_missing');

    expect($intent->refresh()->status)->toBe(UploadStatus::Pending);
    Queue::assertNothingPushed();

    Storage::disk('s3')->put($intent->object_key, str_repeat('x', 1000));
    confirm($user, $intent)->assertStatus(202);
});

it('refuses an intent that ran out, marks it expired and removes the object', function (): void {
    $user = User::factory()->create();
    $intent = confirmIntent($user, state: ['expires_at' => now()->subSecond()]);

    confirm($user, $intent)->assertUnprocessable()->assertJsonPath('code', 'upload_expired');

    expect($intent->refresh()->status)->toBe(UploadStatus::Expired);
    Storage::disk('s3')->assertMissing($intent->object_key);
    Queue::assertNothingPushed();
});

it('answers 404 for another user\'s intent and leaves it alone', function (): void {
    $intent = confirmIntent(User::factory()->create());

    confirm(User::factory()->create(), $intent)->assertNotFound();

    expect($intent->refresh()->status)->toBe(UploadStatus::Pending);
    Queue::assertNothingPushed();
});

it('answers 404 for an id that is not an upload', function (): void {
    $this->actingAs(User::factory()->create())->postJson('/api/uploads/not-an-id/confirm')->assertNotFound();
    $this->actingAs(User::factory()->create())->postJson('/api/uploads/01J0000000000000000000000X/confirm')->assertNotFound();
});

it('needs a signed-in user', function (): void {
    $intent = confirmIntent(User::factory()->create());

    $this->postJson(route('api.uploads.confirm', $intent))->assertUnauthorized();
});

it('does not queue the processing twice for a second confirmation', function (): void {
    $user = User::factory()->create();
    $intent = confirmIntent($user);

    confirm($user, $intent)->assertStatus(202);
    confirm($user, $intent)->assertStatus(202)->assertJsonPath('status', 'processing');

    Queue::assertPushed(ProcessUpload::class, 1);
});

it('refuses an intent that is not pending any more', function (UploadStatus $status): void {
    $user = User::factory()->create();
    $intent = confirmIntent($user, state: ['status' => $status]);

    confirm($user, $intent)->assertUnprocessable()->assertJsonPath('code', 'upload_invalid')->assertJsonPath('uploadId', $intent->id);

    expect($intent->refresh()->status)->toBe($status);
    Queue::assertNothingPushed();
})->with([UploadStatus::Rejected, UploadStatus::Expired, UploadStatus::Consumed]);

describe('api.uploads.show', function (): void {
    it('reports a pending upload', function (): void {
        $user = User::factory()->create();
        $intent = confirmIntent($user);

        $this->actingAs($user)->getJson(route('api.uploads.show', $intent))
            ->assertOk()
            ->assertExactJson(['status' => 'pending', 'reasonCode' => null, 'previewUrl' => null]);
    });

    it('reports the reason of a rejection', function (): void {
        $user = User::factory()->create();
        $intent = UploadIntent::factory()->for($user)->rejected('upload_type_mismatch')->create();

        $this->actingAs($user)->getJson(route('api.uploads.show', $intent))
            ->assertOk()
            ->assertExactJson(['status' => 'rejected', 'reasonCode' => 'upload_type_mismatch', 'previewUrl' => null]);
    });

    it('gives a ready image a preview URL that expires in 15 minutes', function (): void {
        Storage::disk('s3')->buildTemporaryUrlsUsing(
            fn (string $path, DateTimeInterface $expiration): string => 'https://s3.test/'.$path.'?until='.$expiration->getTimestamp(),
        );
        $user = User::factory()->create();
        $intent = UploadIntent::factory()->for($user)->ready()->create();

        $this->actingAs($user)->getJson(route('api.uploads.show', $intent))
            ->assertOk()
            ->assertExactJson([
                'status' => 'ready',
                'reasonCode' => null,
                'previewUrl' => 'https://s3.test/'.$intent->processed_key.'?until='.now()->addMinutes(15)->getTimestamp(),
            ]);
    });

    it('gives no preview for a ready file that is not an image', function (string $mime): void {
        $user = User::factory()->create();
        $intent = UploadIntent::factory()->for($user)->purpose(UploadPurpose::BlueprintSource)->ready()->create(['sniffed_mime' => $mime]);

        $this->actingAs($user)->getJson(route('api.uploads.show', $intent))->assertOk()->assertJsonPath('status', 'ready')->assertJsonPath('previewUrl', null);
    })->with(['application/pdf', 'image/vnd.dxf', 'image/heic']);

    it('answers 404 for another user\'s intent and needs a signed-in user', function (): void {
        $intent = UploadIntent::factory()->ready()->create();

        $this->actingAs(User::factory()->create())->getJson(route('api.uploads.show', $intent))->assertNotFound();
        auth()->logout();
        $this->getJson(route('api.uploads.show', $intent))->assertUnauthorized();
    });
});
