<?php

declare(strict_types=1);

use App\Domain\Identity\Models\User;
use App\Domain\Identity\Otp\OtpDelivery;
use App\Support\Auth\RecentAuthentication;
use Carbon\CarbonImmutable;
use Illuminate\Testing\TestResponse;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\Support\SessionStamp;

beforeEach(function (): void {
    $this->travelTo(CarbonImmutable::parse('2026-10-21 12:20:00', 'UTC'));
    $this->delivery = app(OtpDelivery::class);
    $this->user = User::factory()->phoneOnly()->create(['phone_e164' => '+919876543210']);

    // A session that signed in three hours ago, so `recent.auth` does not pass.
    $this->old = SessionStamp::loginHoursAgo(3);
    $this->store = fn (array $body, ?User $as = null): TestResponse => $this
        ->actingAs($as ?? $this->user)
        ->withSession([...$this->old, 'url.intended' => url('/account/security')])
        ->from(route('auth.reauthenticate'))
        ->post(route('auth.reauthenticate.store'), $body);
});

describe('the page (13 section 6.4)', function (): void {
    it('offers the code and Google to a user without a password', function (): void {
        config(['features.google_login' => true]);
        $user = $this->user;
        $user->forceFill(['google_id' => '1234567890'])->save();

        $this->actingAs($user)->get(route('auth.reauthenticate'))
            ->assertInertia(fn (Assert $page) => $page
                ->component('Auth/Reauthenticate')
                ->where('maskedPhone', '+91******3210')
                ->where('phoneAvailable', true)
                ->where('googleLinked', true)
                ->where('googleEnabled', true)
                ->has('features'));
    });

    it('says there is no phone to send to when none is verified, and no Google when it is off', function (): void {
        config(['features.google_login' => false]);
        $user = User::factory()->passwordless()->googleLinked()->create();

        $this->actingAs($user)->get(route('auth.reauthenticate'))
            ->assertInertia(fn (Assert $page) => $page
                ->where('maskedPhone', null)
                ->where('phoneAvailable', false)
                ->where('googleLinked', true)
                ->where('googleEnabled', false));
    });

    it('says the phone is not available while no channel can carry a code', function (): void {
        config(['features.sms' => false, 'features.whatsapp' => false]);

        $this->actingAs($this->user)->get(route('auth.reauthenticate'))
            ->assertInertia(fn (Assert $page) => $page->where('maskedPhone', '+91******3210')->where('phoneAvailable', false));
    });

    it('sends a user with a password to confirm it instead', function (): void {
        $this->actingAs(User::factory()->create())->get(route('auth.reauthenticate'))->assertRedirectToRoute('password.confirm');
    });

    it('is for signed-in users', function (): void {
        $this->get(route('auth.reauthenticate'))->assertRedirectToRoute('login');
        $this->post(route('auth.reauthenticate.store'), ['step' => 'send'])->assertRedirectToRoute('login');
    });

    it('is where recent.auth sends a passwordless user, and the code sends them back', function (): void {
        $this->actingAs($this->user)->withSession($this->old)
            ->put(route('user-profile-information.update'), ['name' => $this->user->name, 'email' => 'new@example.com'])
            ->assertRedirectToRoute('auth.reauthenticate');
    });
});

describe('sending the code', function (): void {
    it('sends a login code to the verified phone and says by which channel', function (): void {
        ($this->store)(['step' => 'send'])->assertRedirect(route('auth.reauthenticate'))->assertSessionHasNoErrors();

        expect($this->delivery->sent())->toHaveCount(1)
            ->and($this->delivery->sent()[0]['e164'])->toBe('+919876543210')
            ->and(session('otp.challenge.purpose'))->toBe('login')
            ->and(session('otp.challenge.intent'))->toBe('reauthenticate')
            ->and(session('inertia.flash_data.info'))->toBe(trans_icu('auth_ui.reauth.sent', ['channel' => 'sms', 'phone' => '+91******3210']))
            ->and(RecentAuthentication::passes(request()))->toBeFalse();
    });

    it('sends when no step is named and no code given', function (): void {
        ($this->store)([])->assertSessionHasNoErrors();

        expect($this->delivery->sent())->toHaveCount(1);
    });

    it('refuses a user without a verified phone', function (): void {
        $user = User::factory()->passwordless()->withPhone()->create(['phone_verified_at' => null]);

        ($this->store)(['step' => 'send'], $user)->assertSessionHasErrors('code');

        expect(session('errors')->get('code')[0])->toBe(__('auth.errors.reauth_no_phone'))->and($this->delivery->sent())->toBe([]);
    });

    it('answers the wait inside the cooldown', function (): void {
        ($this->store)(['step' => 'send']);

        ($this->store)(['step' => 'send'])->assertSessionHasErrors(['code', 'retryAfter']);
    });

    it('does not take a step it does not know', function (): void {
        ($this->store)(['step' => 'skip'])->assertSessionHasErrors('step');
    });
});

describe('verifying the code', function (): void {
    it('stamps the confirmation and returns to the intended page', function (): void {
        ($this->store)(['step' => 'send']);
        $code = $this->delivery->lastCode();

        $response = ($this->store)(['step' => 'verify', 'code' => $code]);

        $response->assertRedirect(url('/account/security'))->assertSessionHasNoErrors();
        expect(session(RecentAuthentication::CONFIRMED_KEY))->toBeInt()->toBe(now()->getTimestamp())
            ->and(session('otp.challenge'))->toBeNull();
    });

    it('infers the step from the code', function (): void {
        ($this->store)(['step' => 'send']);

        ($this->store)(['code' => $this->delivery->lastCode()])->assertRedirect(url('/account/security'));

        expect(session(RecentAuthentication::CONFIRMED_KEY))->toBe(now()->getTimestamp());
    });

    it('lets a sensitive action through afterwards', function (): void {
        ($this->store)(['step' => 'send']);
        ($this->store)(['step' => 'verify', 'code' => $this->delivery->lastCode()]);

        $this->put(route('user-profile-information.update'), ['name' => $this->user->name, 'email' => 'new@example.com'])
            ->assertSessionHasNoErrors();
        expect($this->user->refresh()->email)->toBe('new@example.com');
    });

    it('answers a wrong code with an error on the code field and the attempts left', function (): void {
        ($this->store)(['step' => 'send']);

        ($this->store)(['step' => 'verify', 'code' => '000000'])->assertSessionHasErrors('code');

        expect(session('errors')->get('code')[0])->toBe(trans_choice('auth.errors.otp_invalid', 4, ['attemptsLeft' => 4]))
            ->and(session(RecentAuthentication::CONFIRMED_KEY))->toBeNull();
    });

    it('needs a code that was sent in this session', function (): void {
        ($this->store)(['step' => 'verify', 'code' => '123456'])->assertSessionHasErrors('code');

        expect(session('errors')->get('code')[0])->toBe(__('auth.errors.otp_expired'));
    });

    it('does not take the challenge of a sign-in as a confirmation', function (): void {
        ($this->store)(['step' => 'send']);
        $code = $this->delivery->lastCode();
        $this->withSession(['otp.challenge.intent' => 'login']);

        ($this->store)(['step' => 'verify', 'code' => $code])->assertSessionHasErrors('code');

        expect(session(RecentAuthentication::CONFIRMED_KEY))->toBeNull();
    });

    it('does not confirm anybody else with the code of another user', function (): void {
        $other = User::factory()->phoneOnly()->create(['phone_e164' => '+919876543211']);
        ($this->store)(['step' => 'send'], $other);
        $code = $this->delivery->lastCode();

        // The code for the other phone is useless for this user, who has not asked for one.
        ($this->store)(['step' => 'verify', 'code' => $code])->assertSessionHasErrors('code');
    });

    it('answers machines with the code', function (): void {
        $this->actingAs($this->user)->withSession($this->old)
            ->postJson(route('auth.reauthenticate.store'), ['step' => 'verify', 'code' => '123456'])
            ->assertStatus(422)->assertExactJson(['code' => 'otp_expired']);
    });
});
