<?php

declare(strict_types=1);

use App\Domain\Identity\Models\User;
use App\Domain\Projects\Models\Project;
use App\Domain\Shared\Actions\ConsumeUploadIntent;
use App\Domain\Shared\Enums\UploadPurpose;
use App\Domain\Shared\Enums\UploadStatus;
use App\Domain\Shared\Models\UploadIntent;
use App\Support\Http\CodedValidationException;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\Storage;

beforeEach(function (): void {
    $this->travelTo(CarbonImmutable::parse('2030-06-15 12:00:00', 'UTC'));
});

function consumeFixture(string $name): string
{
    return (string) file_get_contents(base_path('tests/fixtures/uploads/'.$name));
}

/** A ready intent whose processed file is the PNG fixture, as `ProcessUpload` leaves it. */
function readyIntent(User $user, UploadPurpose $purpose = UploadPurpose::Avatar, ?Model $target = null): UploadIntent
{
    $factory = UploadIntent::factory()->for($user)->purpose($purpose)->ready()->state(['original_filename' => 'My Face.png']);
    $intent = ($target === null ? $factory : $factory->forTarget($target))->create();
    Storage::disk('s3')->put($intent->processed_key, consumeFixture('plain.png'));

    return $intent;
}

/** @return array{string, string|null} the code of the refusal and the upload it names */
function consumeRefusal(callable $consume): array
{
    try {
        $consume();
    } catch (CodedValidationException $e) {
        return [$e->errorCode, $e->context['uploadId'] ?? null];
    }

    return ['none', null];
}

it('attaches the processed file to the collection and marks the intent consumed', function (): void {
    $user = User::factory()->create();
    $intent = readyIntent($user);

    $media = app(ConsumeUploadIntent::class)->handle($user, $intent->id, UploadPurpose::Avatar, null, $user, 'avatar');

    expect($media->collection_name)->toBe('avatar')
        ->and($media->disk)->toBe('s3-public')
        ->and($media->name)->toBe('My Face.png')
        ->and($media->file_name)->toBe(basename($intent->processed_key))
        ->and($media->mime_type)->toBe('image/png')
        ->and($media->model_id)->toBe($user->id)
        ->and($user->getMedia('avatar'))->toHaveCount(1);
    Storage::disk('s3-public')->assertExists($media->getPathRelativeToRoot());

    $intent->refresh();
    expect($intent->status)->toBe(UploadStatus::Consumed)
        ->and($intent->consumed_at->equalTo(now()))->toBeTrue();
});

it('names the media after the intent\'s display name with the extension of what was stored', function (): void {
    $user = User::factory()->create();
    $intent = readyIntent($user);
    $intent->forceFill(['original_filename' => 'IMG_0001.HEIC'])->save();

    $media = app(ConsumeUploadIntent::class)->handle($user, $intent->id, UploadPurpose::Avatar, null, $user, 'avatar');

    expect($media->name)->toBe('IMG_0001.png');
});

it('refuses a second consumption with upload_invalid and the id of the upload', function (): void {
    $user = User::factory()->create();
    $intent = readyIntent($user);
    $consume = fn () => app(ConsumeUploadIntent::class)->handle($user, $intent->id, UploadPurpose::Avatar, null, $user, 'avatar');

    $consume();

    expect(consumeRefusal($consume))->toBe(['upload_invalid', $intent->id])
        ->and($user->getMedia('avatar'))->toHaveCount(1);
});

it('refuses an intent that is not the user\'s, the purpose\'s, ready or there at all', function (string $case): void {
    $user = User::factory()->create();
    $intent = match ($case) {
        'other user' => readyIntent(User::factory()->create()),
        'wrong purpose' => readyIntent($user, UploadPurpose::BusinessLogo),
        'pending' => UploadIntent::factory()->for($user)->create(),
        'uploaded' => UploadIntent::factory()->for($user)->uploaded()->create(),
        'rejected' => UploadIntent::factory()->for($user)->rejected()->create(),
        'expired' => UploadIntent::factory()->for($user)->expired()->create(),
        'consumed' => UploadIntent::factory()->for($user)->consumed()->create(),
        'unknown' => null,
    };
    $id = $intent?->id ?? '01J0000000000000000000000X';

    expect(consumeRefusal(fn () => app(ConsumeUploadIntent::class)->handle($user, $id, UploadPurpose::Avatar, null, $user, 'avatar')))
        ->toBe(['upload_invalid', $id]);
    expect($user->getMedia('avatar'))->toHaveCount(0);
})->with(['other user', 'wrong purpose', 'pending', 'uploaded', 'rejected', 'expired', 'consumed', 'unknown']);

it('leaves another user\'s intent untouched', function (): void {
    $owner = User::factory()->create();
    $intent = readyIntent($owner);
    $thief = User::factory()->create();

    consumeRefusal(fn () => app(ConsumeUploadIntent::class)->handle($thief, $intent->id, UploadPurpose::Avatar, null, $thief, 'avatar'));

    expect($intent->refresh()->status)->toBe(UploadStatus::Ready)->and($intent->consumed_at)->toBeNull();
});

it('requires the same target as the presign had', function (): void {
    $customer = User::factory()->create();
    $project = Project::factory()->forCustomer($customer)->create();
    $other = Project::factory()->forCustomer($customer)->create();
    $intent = readyIntent($customer, UploadPurpose::ProjectCover, $project);
    $consume = fn (?Project $target, Project $model) => app(ConsumeUploadIntent::class)->handle($customer, $intent->id, UploadPurpose::ProjectCover, $target, $model, 'cover');

    expect(consumeRefusal(fn () => $consume($other, $other)))->toBe(['upload_invalid', $intent->id])
        ->and(consumeRefusal(fn () => $consume(null, $project)))->toBe(['upload_invalid', $intent->id])
        ->and($intent->refresh()->status)->toBe(UploadStatus::Ready);

    $media = $consume($project, $project);

    expect($media->collection_name)->toBe('cover')->and($intent->refresh()->status)->toBe(UploadStatus::Consumed);
});

it('refuses a target for an intent that was made without one', function (): void {
    $customer = User::factory()->create();
    $project = Project::factory()->forCustomer($customer)->create();
    $intent = readyIntent($customer);

    expect(consumeRefusal(fn () => app(ConsumeUploadIntent::class)->handle($customer, $intent->id, UploadPurpose::Avatar, $project, $customer, 'avatar')))
        ->toBe(['upload_invalid', $intent->id]);
});

it('leaves the intent ready when the media cannot be attached', function (): void {
    $user = User::factory()->create();
    $intent = readyIntent($user);
    Storage::disk('s3')->delete($intent->processed_key);

    expect(fn () => app(ConsumeUploadIntent::class)->handle($user, $intent->id, UploadPurpose::Avatar, null, $user, 'avatar'))->toThrow(Exception::class);

    expect($intent->refresh()->status)->toBe(UploadStatus::Ready)->and($intent->consumed_at)->toBeNull();
});

it('answers a JSON client with the code, the message and the upload id', function (): void {
    $user = User::factory()->create();
    $intent = UploadIntent::factory()->for($user)->create();
    Route::middleware(['web', 'auth'])->post('/_probe/consume', fn () => app(ConsumeUploadIntent::class)->handle($user, $intent->id, UploadPurpose::Avatar, null, $user, 'avatar'));

    $this->actingAs($user)->postJson('/_probe/consume')
        ->assertUnprocessable()
        ->assertExactJson([
            'code' => 'upload_invalid',
            'message' => trans_icu('uploads.errors.upload_invalid'),
            'errors' => ['_error' => [trans_icu('uploads.errors.upload_invalid')]],
            'uploadId' => $intent->id,
        ]);
});
