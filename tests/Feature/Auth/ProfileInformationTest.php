<?php

declare(strict_types=1);

use App\Domain\Identity\Models\User;
use App\Exceptions\RecentAuthenticationRequired;
use App\Notifications\Auth\VerifyEmail;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Route;
use Spatie\Activitylog\Models\Activity;
use Tests\Support\InertiaRequest;
use Tests\Support\SessionStamp;

beforeEach(function (): void {
    Notification::fake();
    $this->user = User::factory()->create(['name' => 'Asha Kapoor', 'email' => 'asha@example.com']);
    // A request from the profile page, signed in and recently so (the sign-in was a minute ago).
    $this->update = fn (array $input, ?User $user = null, array $session = []) => $this
        ->actingAs($user ?? $this->user)
        ->withSession([...SessionStamp::loginHoursAgo(0), ...$session])
        ->from('/account/profile')
        ->put(route('user-profile-information.update'), $input);
});

describe('the name and the marketing choice', function (): void {
    it('saves them, flashes the toast and goes back', function (): void {
        ($this->update)(['name' => '  Asha K  ', 'email' => 'asha@example.com', 'marketing_opt_in' => 'on'])
            ->assertRedirect('/account/profile')
            ->assertSessionHasNoErrors()
            ->assertInertiaFlash('success', trans_icu('account.toasts.profile_updated'));

        $this->user->refresh();

        expect($this->user->name)->toBe('Asha K')
            ->and($this->user->marketing_opt_in)->toBeTrue()
            ->and($this->user->email)->toBe('asha@example.com');
    });

    it('saves marketing_opt_in on its own and turns it off when the box is not sent', function (): void {
        ($this->update)(['name' => 'Asha Kapoor', 'email' => 'asha@example.com', 'marketing_opt_in' => '1']);
        expect($this->user->refresh()->marketing_opt_in)->toBeTrue();

        ($this->update)(['name' => 'Asha Kapoor', 'email' => 'asha@example.com']);
        expect($this->user->refresh()->marketing_opt_in)->toBeFalse();
    });

    it('needs no recent authentication while the email stays', function (): void {
        ($this->update)(['name' => 'New Name', 'email' => 'ASHA@example.com '], session: [])
            ->assertSessionHasNoErrors()->assertRedirect();

        $this->actingAs($this->user)->withSession(SessionStamp::loginHoursAgo(30))->put(route('user-profile-information.update'), ['name' => 'Older Name', 'email' => 'asha@example.com'])
            ->assertRedirect();

        expect($this->user->refresh()->name)->toBe('Older Name');
        Notification::assertNothingSent();
        expect(Activity::query()->where('event', 'account.email_changed')->count())->toBe(0);
    });

    it('does not change the email when the field is not sent', function (): void {
        ($this->update)(['name' => 'Only A Name'])->assertSessionHasNoErrors()->assertRedirect();

        expect($this->user->refresh()->email)->toBe('asha@example.com')->and($this->user->name)->toBe('Only A Name');
    });

    it('keeps the verified state when the same email comes back in another case', function (): void {
        ($this->update)(['name' => 'Asha Kapoor', 'email' => 'Asha@Example.com']);

        expect($this->user->refresh()->email_verified_at)->not->toBeNull();
    });

    it('rejects a name that is too short or missing', function (): void {
        ($this->update)(['name' => 'A', 'email' => 'asha@example.com'])->assertSessionHasErrors('name');
        ($this->update)(['email' => 'asha@example.com'])->assertSessionHasErrors('name');

        expect($this->user->refresh()->name)->toBe('Asha Kapoor');
    });

    it('does not let staff set the marketing choice', function (): void {
        $staff = User::factory()->owner()->create();

        ($this->update)(['name' => 'Owner Person', 'email' => $staff->email, 'marketing_opt_in' => 'on'], $staff);

        expect($staff->refresh()->marketing_opt_in)->toBeFalse()->and($staff->name)->toBe('Owner Person');
    });

    it('keeps a guest out', function (): void {
        $this->put(route('user-profile-information.update'), ['name' => 'Asha Kapoor', 'email' => 'x@example.com'])
            ->assertRedirect(route('login'));
    });

    it('answers a JSON client with 200', function (): void {
        $this->actingAs($this->user)->putJson(route('user-profile-information.update'), ['name' => 'Asha Kapoor', 'email' => 'asha@example.com'])->assertOk();
    });
});

describe('changing the email (13 section 5.8)', function (): void {
    it('sends a user without a recent sign-in or confirmation to confirm the password', function (): void {
        $this->actingAs($this->user)
            ->withSession(SessionStamp::loginHoursAgo(3))
            ->from('/account/profile')
            ->put(route('user-profile-information.update'), ['name' => 'Asha Kapoor', 'email' => 'new@example.com'])
            ->assertRedirectToRoute('password.confirm');

        expect($this->user->refresh()->email)->toBe('asha@example.com');
        Notification::assertNothingSent();
    });

    it('comes back to the profile page after the confirmation', function (): void {
        $this->actingAs($this->user)
            ->withSession(SessionStamp::loginHoursAgo(3))
            ->withHeaders(['Referer' => url('/account/profile')])
            ->put(route('user-profile-information.update'), ['name' => 'Asha Kapoor', 'email' => 'new@example.com']);

        $this->post(route('password.confirm.store'), ['password' => 'password'])->assertRedirect('/account/profile');
    });

    it('answers a JSON client with 403 recent_auth_required', function (): void {
        $this->actingAs($this->user)
            ->withSession(SessionStamp::loginHoursAgo(3))
            ->putJson(route('user-profile-information.update'), ['name' => 'Asha Kapoor', 'email' => 'new@example.com'])
            ->assertForbidden()
            ->assertJsonPath('code', 'recent_auth_required');
    });

    it('asks for the confirmation before it validates, so a taken address is not told to someone without it', function (): void {
        User::factory()->create(['email' => 'taken@example.com']);

        $this->actingAs($this->user)
            ->withSession(SessionStamp::loginHoursAgo(3))
            ->put(route('user-profile-information.update'), ['name' => 'Asha Kapoor', 'email' => 'taken@example.com'])
            ->assertRedirectToRoute('password.confirm')
            ->assertSessionHasNoErrors();
    });

    it('accepts a password confirmation 5 minutes ago in place of a sign-in', function (): void {
        $this->actingAs($this->user)
            ->withSession([...SessionStamp::loginHoursAgo(5), 'auth.password_confirmed_at' => SessionStamp::minutesAgo(5)])
            ->put(route('user-profile-information.update'), ['name' => 'Asha Kapoor', 'email' => 'new@example.com'])
            ->assertSessionHasNoErrors()->assertRedirect();

        expect($this->user->refresh()->email)->toBe('new@example.com');
    });

    it('is satisfied by what Fortify\'s own confirmation writes', function (): void {
        $this->actingAs($this->user)->withSession(SessionStamp::loginHoursAgo(5))->post(route('password.confirm.store'), ['password' => 'password']);

        expect(session('auth.password_confirmed_at'))->toBeInt();

        $this->put(route('user-profile-information.update'), ['name' => 'Asha Kapoor', 'email' => 'new@example.com'])->assertSessionHasNoErrors()->assertRedirect();

        expect($this->user->refresh()->email)->toBe('new@example.com');
    });

    it('updates the email, clears the verification, sends the link to the new address and audits masked values', function (): void {
        ($this->update)(['name' => 'Asha Kapoor', 'email' => ' New.Address@Example.com '])
            ->assertRedirect('/account/profile')
            ->assertSessionHasNoErrors();

        $this->user->refresh();
        $activity = Activity::query()->where('event', 'account.email_changed')->sole();

        expect($this->user->email)->toBe('new.address@example.com')
            ->and($this->user->email_verified_at)->toBeNull()
            ->and($activity->log_name)->toBe('security')
            ->and($activity->subject_id)->toBe($this->user->getKey())
            ->and($activity->causer_id)->toBe($this->user->getKey())
            ->and($activity->properties->all())->toBe(['from' => 'a**a@e******.com', 'to' => 'n*********s@e******.com']);
        Notification::assertSentToTimes($this->user, VerifyEmail::class, 1);
        Notification::assertSentTo($this->user, VerifyEmail::class, fn (VerifyEmail $notification, array $channels, object $notifiable): bool => $notifiable->email === 'new.address@example.com');
    });

    it('does not put an address in the audit entry', function (): void {
        ($this->update)(['name' => 'Asha Kapoor', 'email' => 'new@example.com']);

        $json = (string) json_encode(Activity::query()->get()->map->toArray()->all());

        expect($json)->not->toContain('asha@example.com')->and($json)->not->toContain('new@example.com');
    });

    it('lets sign-in with the old email stay as it is: the account is not blocked, only unverified', function (): void {
        ($this->update)(['name' => 'Asha Kapoor', 'email' => 'new@example.com']);
        auth()->logout();

        $this->post(route('login.store'), ['email' => 'new@example.com', 'password' => 'password'])->assertRedirect();
        $this->assertAuthenticatedAs($this->user->refresh());
        expect($this->user->hasVerifiedContact())->toBeFalse();
    });

    it('is refused with email_unavailable for an address of another user', function (): void {
        User::factory()->create(['email' => 'taken@example.com']);

        ($this->update)(['name' => 'Asha Kapoor', 'email' => 'Taken@Example.com'])
            ->assertSessionHasErrors(['email' => __('auth.email_unavailable')]);

        expect($this->user->refresh()->email)->toBe('asha@example.com');
        Notification::assertNothingSent();
    });

    it('is refused with email_unavailable for an address of a soft-deleted user', function (): void {
        $gone = User::factory()->create(['email' => 'gone@example.com']);
        $gone->delete();

        ($this->update)(['name' => 'Asha Kapoor', 'email' => 'gone@example.com'])
            ->assertSessionHasErrors(['email' => __('auth.email_unavailable')]);

        expect($this->user->refresh()->email)->toBe('asha@example.com');
    });

    it('is refused for something that is not an address', function (): void {
        ($this->update)(['name' => 'Asha Kapoor', 'email' => 'not-an-address'])->assertSessionHasErrors('email');
    });

    it('answers the 422 of a JSON client with the message', function (): void {
        User::factory()->create(['email' => 'taken@example.com']);

        $this->actingAs($this->user)->withSession(SessionStamp::loginHoursAgo(0))
            ->putJson(route('user-profile-information.update'), ['name' => 'Asha Kapoor', 'email' => 'taken@example.com'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['email' => __('auth.email_unavailable')]);
    });

    it('lets a phone-only customer add an email, unverified', function (): void {
        $phoneOnly = User::factory()->phoneOnly()->create();

        ($this->update)(['name' => $phoneOnly->name, 'email' => 'added@example.com'], $phoneOnly)->assertSessionHasNoErrors()->assertRedirect();

        expect($phoneOnly->refresh()->email)->toBe('added@example.com')->and($phoneOnly->email_verified_at)->toBeNull();
        Notification::assertSentTo($phoneOnly, VerifyEmail::class);
    });

    it('requires the staff email', function (): void {
        $staff = User::factory()->owner()->create();

        ($this->update)(['name' => $staff->name, 'email' => ''], $staff)->assertSessionHasErrors('email');

        expect($staff->refresh()->email)->not->toBeNull();
    });
});

describe('clearing the email', function (): void {
    it('is refused when it would leave no way to sign in', function (): void {
        ($this->update)(['name' => 'Asha Kapoor', 'email' => ''])
            ->assertSessionHasErrors(['email' => __('auth.errors.last_login_method')]);

        expect($this->user->refresh()->email)->toBe('asha@example.com')
            ->and(__('auth.errors.last_login_method'))->toBe('You need at least one way to sign in.');
    });

    it('is refused as a 422 for a JSON client', function (): void {
        $this->actingAs($this->user)->withSession(SessionStamp::loginHoursAgo(0))
            ->putJson(route('user-profile-information.update'), ['name' => 'Asha Kapoor', 'email' => null])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['email' => __('auth.errors.last_login_method')]);
    });

    it('is refused when only an unverified phone would be left', function (): void {
        $this->user->forceFill(['phone_e164' => '+919876543210', 'phone_verified_at' => null])->save();

        ($this->update)(['name' => 'Asha Kapoor', 'email' => ''])
            ->assertSessionHasErrors(['email' => __('auth.errors.last_login_method')]);
    });

    it('is allowed when a verified phone is left', function (): void {
        $this->user->forceFill(['phone_e164' => '+919876543210', 'phone_verified_at' => now()])->save();

        ($this->update)(['name' => 'Asha Kapoor', 'email' => ''])->assertSessionHasNoErrors()->assertRedirect();

        $this->user->refresh();
        $activity = Activity::query()->where('event', 'account.email_changed')->sole();

        expect($this->user->email)->toBeNull()
            ->and($this->user->email_verified_at)->toBeNull()
            ->and($activity->properties->all())->toBe(['from' => 'a**a@e******.com', 'to' => null]);
        Notification::assertNothingSent();
    });

    it('is allowed when a Google account and a phone number are left', function (): void {
        $this->user->forceFill(['google_id' => '1234567890', 'phone_e164' => '+919876543210', 'phone_verified_at' => null])->save();

        ($this->update)(['name' => 'Asha Kapoor', 'email' => ''])->assertSessionHasNoErrors()->assertRedirect();

        expect($this->user->refresh()->email)->toBeNull();
    });

    it('is refused for a Google account without a phone number, because the account needs an email or a phone number', function (): void {
        $this->user->forceFill(['google_id' => '1234567890'])->save();

        ($this->update)(['name' => 'Asha Kapoor', 'email' => ''])
            ->assertSessionHasErrors(['email' => __('auth.errors.last_login_method')]);

        expect($this->user->refresh()->email)->toBe('asha@example.com');
    });

    it('still needs a recent sign-in', function (): void {
        $this->user->forceFill(['google_id' => '1234567890', 'phone_e164' => '+919876543210'])->save();

        $this->actingAs($this->user)->withSession(SessionStamp::loginHoursAgo(4))
            ->put(route('user-profile-information.update'), ['name' => 'Asha Kapoor', 'email' => ''])
            ->assertRedirectToRoute('password.confirm');
    });
});

describe('a user without a password (13 section 6.4)', function (): void {
    it('is sent to re-authenticate, not to confirm a password they do not have', function (): void {
        $passwordless = User::factory()->phoneOnly()->create();

        if (! Route::has('auth.reauthenticate')) {
            // The OTP/Google task adds `auth.reauthenticate`; the exception names it, and until it exists there is
            // no URL to redirect to.
            $this->markTestSkipped('auth.reauthenticate does not exist yet (phone OTP task); the redirect for passwordless users cannot be asserted.');
        }

        $this->actingAs($passwordless)
            ->withSession(SessionStamp::loginHoursAgo(4))
            ->put(route('user-profile-information.update'), ['name' => $passwordless->name, 'email' => 'new@example.com'])
            ->assertRedirectToRoute('auth.reauthenticate');
    });

    it('throws the recent-authentication exception for them rather than saving the email', function (): void {
        $passwordless = User::factory()->phoneOnly()->create();
        $this->withoutExceptionHandling();

        expect(fn () => $this->actingAs($passwordless)
            ->withSession(SessionStamp::loginHoursAgo(4))
            ->put(route('user-profile-information.update'), ['name' => $passwordless->name, 'email' => 'new@example.com'])
        )->toThrow(RecentAuthenticationRequired::class);

        expect($passwordless->refresh()->email)->toBeNull();
    });
});

it('is on the route list with the app Action behind it', function (): void {
    expect(Route::has('user-profile-information.update'))->toBeTrue()
        ->and(Route::getRoutes()->getByName('user-profile-information.update')->uri())->toBe('user/profile-information');
});

it('hands an Inertia visit the same redirect', function (): void {
    $this->actingAs($this->user)
        ->withSession(SessionStamp::loginHoursAgo(0))
        ->withHeaders([...InertiaRequest::headers(), 'Referer' => url('/account/profile')])
        ->put(route('user-profile-information.update'), ['name' => 'Asha Kapoor', 'email' => 'asha@example.com'])
        ->assertRedirect('/account/profile');
});
