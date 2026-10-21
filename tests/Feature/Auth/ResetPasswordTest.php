<?php

declare(strict_types=1);

use App\Domain\Identity\Events\ContactVerified;
use App\Domain\Identity\Models\User;
use App\Support\Auth\SessionRegistry;
use Illuminate\Auth\Events\PasswordReset;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Password;
use Inertia\Testing\AssertableInertia as Assert;
use Spatie\Activitylog\Models\Activity;
use Tests\Support\RegistryFixtures;

beforeEach(function (): void {
    $this->user = User::factory()->unverified()->create(['email' => 'asha@example.com', 'remember_token' => 'old-remember-token']);
    $this->token = Password::broker()->createToken($this->user);
    $this->reset = fn (array $overrides = []) => $this
        ->from(route('password.reset', ['token' => $this->token, 'email' => 'asha@example.com']))
        ->post(route('password.update'), [
            'token' => $this->token,
            'email' => 'asha@example.com',
            'password' => 'a-brand-new-password',
            'password_confirmation' => 'a-brand-new-password',
            ...$overrides,
        ]);
});

afterEach(function (): void {
    RegistryFixtures::clean($this->user);
});

describe('a valid reset (13 section 5.5)', function (): void {
    it('sets the new password and sends the user to the login page with the status', function (): void {
        ($this->reset)()->assertRedirect(route('login'))->assertSessionHas('status', trans('passwords.reset'));

        expect(Hash::check('a-brand-new-password', $this->user->refresh()->password))->toBeTrue()
            ->and(Hash::check('password', $this->user->password))->toBeFalse();
        $this->assertGuest();
    });

    it('verifies the email when it was not, because the link proved the address is theirs', function (): void {
        ($this->reset)();

        expect($this->user->refresh()->email_verified_at)->not->toBeNull()
            ->and($this->user->email_verified_at->diffInSeconds(now()))->toBeLessThan(5);
    });

    it('keeps the date of an email that was verified already', function (): void {
        $verifiedAt = now()->subDays(40)->startOfSecond();
        $this->user->forceFill(['email_verified_at' => $verifiedAt])->save();

        ($this->reset)();

        expect($this->user->refresh()->email_verified_at->equalTo($verifiedAt))->toBeTrue();
    });

    it('dispatches ContactVerified when the reset verifies the first contact', function (): void {
        Event::fake([ContactVerified::class, PasswordReset::class]);

        ($this->reset)();

        Event::assertDispatchedTimes(ContactVerified::class, 1);
        Event::assertDispatched(PasswordReset::class);
    });

    it('does not dispatch ContactVerified when a contact was verified before', function (): void {
        $this->user->forceFill(['phone_e164' => '+919876543210', 'phone_verified_at' => now()->subDay(), 'first_contact_verified_at' => now()->subDay()])->save();
        Event::fake([ContactVerified::class]);

        ($this->reset)();

        Event::assertNotDispatched(ContactVerified::class);
        expect($this->user->refresh()->email_verified_at)->not->toBeNull();
    });

    it('rotates the remember token', function (): void {
        ($this->reset)();

        $token = $this->user->refresh()->remember_token;

        expect($token)->not->toBe('old-remember-token')->and(strlen((string) $token))->toBe(60);
    });

    it('signs the user out of every registered session', function (): void {
        $first = RegistryFixtures::open($this->user);
        $second = RegistryFixtures::open($this->user);

        ($this->reset)();

        expect(RegistryFixtures::alive($first))->toBeFalse()
            ->and(RegistryFixtures::alive($second))->toBeFalse()
            ->and(app(SessionRegistry::class)->list($this->user, null))->toBe([])
            ->and(app(SessionRegistry::class)->isRevoked($first))->toBeTrue();
    });

    it('leaves the sessions of another user alone', function (): void {
        $other = User::factory()->create();
        $theirs = RegistryFixtures::open($other);

        ($this->reset)();

        expect(RegistryFixtures::alive($theirs))->toBeTrue();

        RegistryFixtures::clean($other);
    });

    it('writes auth.password_reset and the sessions audit, with the user as subject and causer', function (): void {
        RegistryFixtures::open($this->user);

        ($this->reset)();

        $reset = Activity::query()->where('event', 'auth.password_reset')->sole();
        $revoked = Activity::query()->where('event', 'auth.sessions_revoked')->sole();

        expect($reset->log_name)->toBe('security')
            ->and($reset->subject_id)->toBe($this->user->getKey())
            ->and($reset->causer_id)->toBe($this->user->getKey())
            ->and($reset->properties->all())->toBe([])
            ->and($revoked->properties->all())->toBe(['count' => 1, 'reason' => 'password_reset']);
    });

    it('writes the audit entry without the password or the token', function (): void {
        ($this->reset)();

        $json = (string) json_encode(Activity::query()->get()->map->toArray()->all());

        expect($json)->not->toContain('a-brand-new-password')->and($json)->not->toContain($this->token);
    });

    it('lets a passwordless user create a password with the link', function (): void {
        $user = User::factory()->passwordless()->create(['email' => 'phone.first@example.com']);
        $token = Password::broker()->createToken($user);

        $this->post(route('password.update'), [
            'token' => $token,
            'email' => 'phone.first@example.com',
            'password' => 'a-brand-new-password',
            'password_confirmation' => 'a-brand-new-password',
        ])->assertRedirect(route('login'));

        expect(Hash::check('a-brand-new-password', $user->refresh()->password))->toBeTrue();
    });

    it('answers a JSON client with 200 and the message', function (): void {
        $this->postJson(route('password.update'), [
            'token' => $this->token,
            'email' => 'asha@example.com',
            'password' => 'a-brand-new-password',
            'password_confirmation' => 'a-brand-new-password',
        ])->assertOk()->assertExactJson(['message' => trans('passwords.reset')]);
    });

    it('accepts the email in any case', function (): void {
        ($this->reset)(['email' => 'ASHA@Example.com'])->assertRedirect(route('login'));
    });
});

describe('the token', function (): void {
    it('works once', function (): void {
        ($this->reset)()->assertRedirect(route('login'));

        ($this->reset)(['password' => 'another-new-password', 'password_confirmation' => 'another-new-password'])
            ->assertSessionHasErrors(['email' => trans('passwords.token')]);

        expect(Hash::check('a-brand-new-password', $this->user->refresh()->password))->toBeTrue();
    });

    it('is accepted 59 minutes after it was made and rejected after 61', function (): void {
        $this->travel(59)->minutes();
        ($this->reset)()->assertRedirect(route('login'));

        $user = User::factory()->create(['email' => 'late@example.com']);
        $token = Password::broker()->createToken($user);
        $this->travel(61)->minutes();

        $this->from(route('password.request'))->post(route('password.update'), [
            'token' => $token,
            'email' => 'late@example.com',
            'password' => 'a-brand-new-password',
            'password_confirmation' => 'a-brand-new-password',
        ])->assertSessionHasErrors(['email' => trans('passwords.token')]);

        expect(Hash::check('a-brand-new-password', $user->refresh()->password))->toBeFalse();
    });

    it('is refused for another email', function (): void {
        User::factory()->create(['email' => 'other@example.com']);

        ($this->reset)(['email' => 'other@example.com'])->assertSessionHasErrors('email');

        expect(Hash::check('a-brand-new-password', $this->user->refresh()->password))->toBeFalse();
    });

    it('is refused when it is made up', function (): void {
        ($this->reset)(['token' => str_repeat('a', 64)])->assertSessionHasErrors(['email' => trans('passwords.token')]);
    });

    it('changes nothing when the new password is refused, and can be used again', function (): void {
        ($this->reset)(['password_confirmation' => 'something-else'])->assertSessionHasErrors('password');

        $this->user->refresh();

        expect(Hash::check('password', $this->user->password))->toBeTrue()
            ->and($this->user->email_verified_at)->toBeNull()
            ->and($this->user->remember_token)->toBe('old-remember-token')
            ->and(Activity::query()->count())->toBe(0);

        ($this->reset)()->assertRedirect(route('login'));
    });

    it('does not keep the token in the session as old input when the new password is refused', function (): void {
        ($this->reset)(['password_confirmation' => 'something-else'])->assertSessionHasErrors('password');

        $this->assertNull(session('_old_input.token'));
        $this->assertNull(session('_old_input.password'));
    });

    it('is refused for a password that is too short', function (): void {
        ($this->reset)(['password' => 'short', 'password_confirmation' => 'short'])->assertSessionHasErrors('password');
    });
});

describe('the page', function (): void {
    it('hands the reset page the token, the email and the password rules', function (): void {
        $this->get(route('password.reset', ['token' => $this->token, 'email' => 'asha@example.com']))
            ->assertInertia(fn (Assert $page) => $page
                ->component('Auth/ResetPassword')
                ->where('token', $this->token)
                ->where('email', 'asha@example.com')
                ->has('passwordRules')
                ->has('features'));
    });

    it('keeps a signed-in user away from the reset page', function (): void {
        $this->actingAs(User::factory()->create())
            ->get(route('password.reset', ['token' => $this->token]))
            ->assertRedirect();
    });
});
