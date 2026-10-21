<?php

declare(strict_types=1);

use App\Domain\Identity\Models\User;
use App\Domain\Shared\Enums\UploadPurpose;
use App\Domain\Shared\Enums\UploadStatus;
use App\Domain\Shared\Models\UploadIntent;
use Illuminate\Support\Facades\Storage;
use Inertia\Testing\AssertableInertia as Assert;

/** A ready avatar intent of `$user` whose processed file is in storage, as `ProcessUpload` leaves it. */
function readyAvatarIntent(User $user, UploadPurpose $purpose = UploadPurpose::Avatar): UploadIntent
{
    $intent = UploadIntent::factory()->for($user)->purpose($purpose)->ready()->state(['original_filename' => 'Me.png'])->create();
    Storage::disk('s3')->put((string) $intent->processed_key, (string) file_get_contents(base_path('tests/fixtures/uploads/plain.png')));

    return $intent;
}

/** The `auth.user.avatarUrl` shared prop of the next page the user opens. */
function avatarUrlOf(User $user): ?string
{
    $url = null;

    test()->actingAs($user)
        ->get(route('customer.account.profile'))
        ->assertInertia(function (Assert $page) use (&$url): void {
            $url = $page->toArray()['props']['auth']['user']['avatarUrl'];
        });

    return $url;
}

it('sets the avatar from a ready upload, and the shared avatarUrl becomes the thumbnail', function (): void {
    expect(route('customer.account.avatar.update', absolute: false))->toBe('/account/avatar');

    $user = User::factory()->create();
    $intent = readyAvatarIntent($user);

    expect(avatarUrlOf($user))->toBeNull();

    $this->actingAs($user)
        ->from('/account/profile')
        ->put(route('customer.account.avatar.update'), ['uploadId' => $intent->id])
        ->assertRedirect('/account/profile')
        ->assertSessionHasNoErrors()
        ->assertInertiaFlash('success', trans_icu('account.toasts.avatar_updated'));

    $media = $user->refresh()->getFirstMedia('avatar');

    expect($media)->not->toBeNull()
        ->and($media->disk)->toBe('s3-public')
        ->and($intent->refresh()->status)->toBe(UploadStatus::Consumed);

    $url = avatarUrlOf($user);

    expect($url)->toBeString()->toBe($user->getFirstMediaUrl('avatar', 'thumb'))->toContain('conversions');
});

it('replaces the earlier avatar', function (): void {
    $user = User::factory()->create();
    $this->actingAs($user)->put(route('customer.account.avatar.update'), ['uploadId' => readyAvatarIntent($user)->id]);
    $first = $user->refresh()->getFirstMedia('avatar');

    $this->actingAs($user)->put(route('customer.account.avatar.update'), ['uploadId' => readyAvatarIntent($user)->id]);

    expect($user->refresh()->getMedia('avatar'))->toHaveCount(1)
        ->and($user->getFirstMedia('avatar')->id)->not->toBe($first->id);
});

it('removes the avatar with a null uploadId', function (): void {
    $user = User::factory()->create();
    $this->actingAs($user)->put(route('customer.account.avatar.update'), ['uploadId' => readyAvatarIntent($user)->id]);
    expect(avatarUrlOf($user))->toBeString();

    $this->actingAs($user)
        ->from('/account/profile')
        ->put(route('customer.account.avatar.update'), ['uploadId' => null])
        ->assertRedirect('/account/profile')
        ->assertSessionHasNoErrors()
        ->assertInertiaFlash('success', trans_icu('account.toasts.avatar_removed'));

    expect($user->refresh()->getMedia('avatar'))->toHaveCount(0)
        ->and(avatarUrlOf($user))->toBeNull();
});

it('refuses another user\'s upload with upload_invalid', function (): void {
    $owner = User::factory()->create();
    $intent = readyAvatarIntent($owner);
    $user = User::factory()->create();

    $this->actingAs($user)
        ->putJson(route('customer.account.avatar.update'), ['uploadId' => $intent->id])
        ->assertUnprocessable()
        ->assertJson(['code' => 'upload_invalid', 'uploadId' => $intent->id]);

    expect($user->refresh()->getMedia('avatar'))->toHaveCount(0)
        ->and($intent->refresh()->status)->toBe(UploadStatus::Ready);
});

it('refuses an upload made for another purpose, and an upload that is not ready', function (): void {
    $user = User::factory()->create();
    $wrongPurpose = readyAvatarIntent($user, UploadPurpose::BusinessLogo);
    $pending = UploadIntent::factory()->for($user)->purpose(UploadPurpose::Avatar)->create();

    foreach ([$wrongPurpose, $pending] as $intent) {
        $this->actingAs($user)
            ->putJson(route('customer.account.avatar.update'), ['uploadId' => $intent->id])
            ->assertUnprocessable()
            ->assertJson(['code' => 'upload_invalid']);
    }
});

it('shows the refusal under _error on a form post', function (): void {
    $user = User::factory()->create();
    $intent = readyAvatarIntent(User::factory()->create());

    $this->actingAs($user)
        ->put(route('customer.account.avatar.update'), ['uploadId' => $intent->id])
        ->assertSessionHasErrors(['_error' => trans_icu('uploads.errors.upload_invalid'), 'code' => 'upload_invalid']);
});

it('needs the key, and an id that looks like one', function (): void {
    $user = User::factory()->create();

    $this->actingAs($user)->put(route('customer.account.avatar.update'), [])->assertSessionHasErrors('uploadId');
    $this->actingAs($user)->put(route('customer.account.avatar.update'), ['uploadId' => 'not-a-ulid'])->assertSessionHasErrors('uploadId');
});

it('sets and removes the avatar of a staff member', function (): void {
    expect(route('admin.account.avatar.update', absolute: false))->toBe('/admin/account/avatar');

    $staff = User::factory()->estimator()->create();

    $this->actingAs($staff)
        ->from('/admin/account/profile')
        ->put(route('admin.account.avatar.update'), ['uploadId' => readyAvatarIntent($staff)->id])
        ->assertRedirect('/admin/account/profile')
        ->assertSessionHasNoErrors();

    expect($staff->refresh()->getMedia('avatar'))->toHaveCount(1);

    $this->actingAs($staff)->put(route('admin.account.avatar.update'), ['uploadId' => null])->assertSessionHasNoErrors();

    expect($staff->refresh()->getMedia('avatar'))->toHaveCount(0);
});

it('keeps each audience to its own route', function (): void {
    $this->actingAs(User::factory()->create())->put(route('admin.account.avatar.update'), ['uploadId' => null])->assertForbidden();
    $this->actingAs(User::factory()->estimator()->create())
        ->put(route('customer.account.avatar.update'), ['uploadId' => null])
        ->assertRedirectToRoute('admin.dashboard');
});
