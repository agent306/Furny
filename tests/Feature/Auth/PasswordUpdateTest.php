<?php

declare(strict_types=1);

use App\Domain\Identity\Models\User;
use App\Support\Auth\SessionRegistry;
use Illuminate\Auth\Events\Login;
use Illuminate\Cookie\CookieValuePrefix;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Hash;
use Spatie\Activitylog\Models\Activity;
use Tests\Support\RegistryFixtures;
use Tests\Support\SessionStamp;

beforeEach(function (): void {
    $this->user = User::factory()->create(['remember_token' => 'old-remember-token']);
    $this->current = RegistryFixtures::open($this->user);
    // The request arrives on the session `$this->current`; the user has used the app for a while (no recent sign-in is needed).
    $this->update = fn (array $input, ?User $user = null) => $this
        ->actingAs($user ?? $this->user)
        ->withCookie((string) config('session.cookie'), $this->current)
        ->withSession(SessionStamp::loginHoursAgo(30))
        ->from('/account/security')
        ->put(route('user-password.update'), $input);
    $this->valid = [
        'current_password' => 'password',
        'password' => 'a-brand-new-password',
        'password_confirmation' => 'a-brand-new-password',
    ];
});

afterEach(function (): void {
    RegistryFixtures::clean($this->user);
});

describe('a user with a password', function (): void {
    it('changes it, goes back and flashes the toast', function (): void {
        ($this->update)($this->valid)
            ->assertRedirect('/account/security')
            ->assertSessionHasNoErrors()
            ->assertInertiaFlash('success', trans_icu('account.toasts.password_updated'));

        expect(Hash::check('a-brand-new-password', $this->user->refresh()->password))->toBeTrue()
            ->and(trans_icu('account.toasts.password_updated'))->toBe('Password updated.');
    });

    it('refuses a wrong current password and changes nothing', function (): void {
        ($this->update)([...$this->valid, 'current_password' => 'not-my-password'])
            ->assertSessionHasErrors(['current_password' => __('validation.current_password')]);

        expect(Hash::check('password', $this->user->refresh()->password))->toBeTrue()
            ->and(Activity::query()->count())->toBe(0)
            ->and(RegistryFixtures::alive($this->current))->toBeTrue();
    });

    it('refuses a missing current password', function (): void {
        ($this->update)(['password' => 'a-brand-new-password', 'password_confirmation' => 'a-brand-new-password'])
            ->assertSessionHasErrors('current_password');

        expect(Hash::check('password', $this->user->refresh()->password))->toBeTrue();
    });

    it('refuses a new password that is not confirmed or too short', function (): void {
        ($this->update)([...$this->valid, 'password_confirmation' => 'something-else'])->assertSessionHasErrors('password');
        ($this->update)([...$this->valid, 'password' => 'short', 'password_confirmation' => 'short'])->assertSessionHasErrors('password');

        expect(Hash::check('password', $this->user->refresh()->password))->toBeTrue();
    });

    it('answers a JSON client with 200, or 422 for a wrong current password', function (): void {
        $this->actingAs($this->user)->putJson(route('user-password.update'), [...$this->valid, 'current_password' => 'wrong'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('current_password');

        $this->actingAs($this->user)->putJson(route('user-password.update'), $this->valid)->assertOk();
    });

    it('keeps a guest out', function (): void {
        $this->put(route('user-password.update'), $this->valid)->assertRedirect(route('login'));
    });
});

describe('the other sessions', function (): void {
    it('are destroyed, the one in use stays', function (): void {
        $phone = RegistryFixtures::open($this->user);
        $laptop = RegistryFixtures::open($this->user);

        ($this->update)($this->valid)->assertSessionHasNoErrors()->assertRedirect();

        expect(RegistryFixtures::alive($phone))->toBeFalse()
            ->and(RegistryFixtures::alive($laptop))->toBeFalse()
            ->and(RegistryFixtures::alive($this->current))->toBeTrue()
            ->and(app(SessionRegistry::class)->list($this->user, $this->current))->toHaveCount(1)
            ->and(app(SessionRegistry::class)->isRevoked($phone))->toBeTrue();
        $this->assertAuthenticatedAs($this->user);
    });

    it('rotates the remember token, so the remember cookies of the other devices stop working', function (): void {
        RegistryFixtures::open($this->user);

        ($this->update)($this->valid);

        expect($this->user->refresh()->remember_token)->not->toBe('old-remember-token');
    });

    it('leaves the sessions of other users alone', function (): void {
        $stranger = User::factory()->create();
        $theirs = RegistryFixtures::open($stranger);

        ($this->update)($this->valid);

        expect(RegistryFixtures::alive($theirs))->toBeTrue();

        RegistryFixtures::clean($stranger);
    });

    it('go through RevokeSessions: audited with the reason password_changed, history cleared', function (): void {
        RegistryFixtures::open($this->user);

        ($this->update)($this->valid);

        $revoked = Activity::query()->where('event', 'auth.sessions_revoked')->sole();

        expect($revoked->properties->all())->toBe(['count' => 1, 'reason' => 'password_changed'])
            ->and($revoked->subject_id)->toBe($this->user->getKey())
            ->and($revoked->causer_id)->toBe($this->user->getKey())
            ->and(session('inertia.clear_history'))->toBeTrue();
    });

    it('give a browser that carries the remember cookie the rotated token and the new password, without signing in again', function (): void {
        Event::fake([Login::class]);
        RegistryFixtures::open($this->user);
        $name = Auth::guard('web')->getRecallerName();

        $response = $this->actingAs($this->user)
            ->withCookie((string) config('session.cookie'), $this->current)
            ->withCookie($name, $this->user->getKey().'|old-remember-token|'.Auth::guard('web')->hashPasswordForCookie($this->user->getAuthPassword()))
            ->withSession(SessionStamp::loginHoursAgo(30))
            ->put(route('user-password.update'), $this->valid);

        $cookie = collect($response->headers->getCookies())->first(fn ($cookie): bool => $cookie->getName() === $name);
        $user = $this->user->fresh();

        expect($cookie)->not->toBeNull()
            ->and(CookieValuePrefix::remove(decrypt($cookie->getValue(), false)))->toBe(
                $user->getKey().'|'.$user->remember_token.'|'.Auth::guard('web')->hashPasswordForCookie($user->getAuthPassword()),
            );

        Event::assertNotDispatched(Login::class);
    });

    it('queue no remember cookie for a browser that has none', function (): void {
        $response = ($this->update)($this->valid);

        expect(collect($response->headers->getCookies())->map(fn ($cookie): string => $cookie->getName())->all())
            ->not->toContain(Auth::guard('web')->getRecallerName());
    });
});

describe('the audit entry', function (): void {
    it('is auth.password_changed in the security log, with the user as subject and causer and no properties', function (): void {
        ($this->update)($this->valid);

        $activity = Activity::query()->where('event', 'auth.password_changed')->sole();

        expect($activity->log_name)->toBe('security')
            ->and($activity->subject_id)->toBe($this->user->getKey())
            ->and($activity->causer_id)->toBe($this->user->getKey())
            ->and($activity->properties->all())->toBe([]);
    });

    it('does not hold the password', function (): void {
        ($this->update)($this->valid);

        $json = (string) json_encode(Activity::query()->get()->map->toArray()->all());

        expect($json)->not->toContain('a-brand-new-password');
    });

    it('is not written twice for a second change by the same user', function (): void {
        ($this->update)($this->valid);
        ($this->update)(['current_password' => 'a-brand-new-password', 'password' => 'yet-another-password', 'password_confirmation' => 'yet-another-password']);

        expect(Activity::query()->where('event', 'auth.password_changed')->count())->toBe(2);
    });
});

describe('a user without a password', function (): void {
    beforeEach(function (): void {
        $this->phoneUser = User::factory()->passwordless()->create(['email' => 'phone.first@example.com']);
        $this->phoneSession = RegistryFixtures::open($this->phoneUser);
    });

    afterEach(function (): void {
        RegistryFixtures::clean($this->phoneUser);
    });

    it('sets a first password without a current one', function (): void {
        $this->actingAs($this->phoneUser)
            ->withCookie((string) config('session.cookie'), $this->phoneSession)
            ->withSession(SessionStamp::loginHoursAgo(0))
            ->from('/account/security')
            ->put(route('user-password.update'), ['password' => 'a-brand-new-password', 'password_confirmation' => 'a-brand-new-password'])
            ->assertRedirect('/account/security')
            ->assertSessionHasNoErrors();

        expect(Hash::check('a-brand-new-password', $this->phoneUser->refresh()->password))->toBeTrue()
            ->and($this->phoneUser->hasPassword())->toBeTrue();
        $this->assertAuthenticatedAs($this->phoneUser);
        expect(Activity::query()->where('event', 'auth.password_changed')->count())->toBe(1);
    });

    it('still needs the new password to be valid', function (): void {
        $this->actingAs($this->phoneUser)
            ->put(route('user-password.update'), ['password' => 'short', 'password_confirmation' => 'short'])
            ->assertSessionHasErrors('password');

        expect($this->phoneUser->refresh()->hasPassword())->toBeFalse();
    });

    it('does not need a current password even when one is sent', function (): void {
        $this->actingAs($this->phoneUser)
            ->put(route('user-password.update'), ['current_password' => 'whatever', 'password' => 'a-brand-new-password', 'password_confirmation' => 'a-brand-new-password'])
            ->assertSessionHasNoErrors()->assertRedirect();

        expect($this->phoneUser->refresh()->hasPassword())->toBeTrue();
    });

    it('signs out the other devices of the user as well', function (): void {
        $other = RegistryFixtures::open($this->phoneUser);

        $this->actingAs($this->phoneUser)
            ->withCookie((string) config('session.cookie'), $this->phoneSession)
            ->put(route('user-password.update'), ['password' => 'a-brand-new-password', 'password_confirmation' => 'a-brand-new-password']);

        expect(RegistryFixtures::alive($other))->toBeFalse()->and(RegistryFixtures::alive($this->phoneSession))->toBeTrue();
    });
});
