<?php

declare(strict_types=1);

use App\Domain\Identity\Events\ContactVerified;
use App\Domain\Identity\Models\OtpCode;
use App\Domain\Identity\Models\User;
use App\Domain\Identity\Otp\OtpDelivery;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Event;
use Illuminate\Testing\TestResponse;
use Spatie\Activitylog\Models\Activity;
use Tests\Support\InertiaRequest;
use Tests\Support\SessionStamp;

const ACCOUNT_PHONE = '98765 43210';
const ACCOUNT_E164 = '+919876543210';

beforeEach(function (): void {
    $this->travelTo(CarbonImmutable::parse('2026-10-21 12:20:00', 'UTC'));
    $this->delivery = app(OtpDelivery::class);
    $this->user = User::factory()->create();

    // Signed in just now, so `recent.auth` passes; the tests of the rule start the session older.
    $this->recent = fn (): array => ['auth.login_at' => now()->getTimestamp()];
    $this->sendCode = fn (string $phone = ACCOUNT_PHONE, ?User $as = null): TestResponse => $this
        ->actingAs($as ?? $this->user)
        ->withSession(($this->recent)())
        ->from('/account/profile')
        ->post(route('account.phone.send'), ['phone' => $phone]);
    $this->verifyCode = fn (?string $code = null, ?User $as = null): TestResponse => $this
        ->actingAs($as ?? $this->user)
        ->withSession(($this->recent)())
        ->from('/account/profile')
        ->post(route('account.phone.verify'), ['code' => $code ?? $this->delivery->lastCode()]);
});

describe('sending the code (13 section 5.7)', function (): void {
    it('sends a code by the purpose verify_phone, keeps the challenge and tells the channel and the masked number', function (): void {
        ($this->sendCode)()->assertRedirect('/account/profile')->assertSessionHasNoErrors();

        $otp = OtpCode::query()->sole();
        expect($otp->purpose->value)->toBe('verify_phone')
            ->and($this->delivery->sent())->toHaveCount(1)
            ->and($this->delivery->sent()[0]['e164'])->toBe(ACCOUNT_E164)
            ->and(session('otp.challenge'))->toBe([
                'e164' => ACCOUNT_E164,
                'purpose' => 'verify_phone',
                'intent' => 'verify_phone',
                'channel' => 'sms',
                'otpId' => $otp->id,
                'expiresAt' => $otp->expires_at->getTimestamp(),
            ])
            ->and(session('inertia.flash_data.info'))->toBe(trans_icu('account.otp_sent', ['channel' => 'sms', 'phone' => '+91******3210']))
            // For the dialog, which says "Sent via SMS" and shows the number.
            ->and(session('inertia.flash_data.channel'))->toBe('sms')
            ->and(session('inertia.flash_data.maskedPhone'))->toBe('+91******3210');
    });

    it('does not say whether somebody else has the number: the code goes out and the answer is the same', function (): void {
        User::factory()->withPhone(ACCOUNT_E164)->create();

        ($this->sendCode)()->assertRedirect('/account/profile')->assertSessionHasNoErrors();

        expect($this->delivery->sent())->toHaveCount(1);
    });

    it('refuses a number that is not one', function (): void {
        ($this->sendCode)('abc')->assertSessionHasErrors(['phone', 'code']);

        expect(session('errors')->get('code')[0])->toBe('phone_invalid')->and($this->delivery->sent())->toBe([]);
    });

    it('answers the wait inside the cooldown', function (): void {
        ($this->sendCode)();

        ($this->sendCode)()->assertSessionHasErrors(['phone', 'code', 'retryAfter']);

        expect(session('errors')->get('code')[0])->toBe('otp_cooldown');
    });

    it('answers machines with the code and its status', function (): void {
        $this->actingAs($this->user)->withSession(($this->recent)())->postJson(route('account.phone.send'), ['phone' => 'abc'])
            ->assertStatus(422)->assertExactJson(['code' => 'phone_invalid']);
    });

    it('is for signed-in users', function (): void {
        $this->post(route('account.phone.send'), ['phone' => ACCOUNT_PHONE])->assertRedirectToRoute('login');
        $this->post(route('account.phone.verify'), ['code' => '123456'])->assertRedirectToRoute('login');
        expect($this->delivery->sent())->toBe([]);
    });
});

describe('verifying the code (13 section 5.7)', function (): void {
    it('sets the number and when it was verified, flashes the toast and audits it with masked numbers', function (): void {
        ($this->sendCode)();

        ($this->verifyCode)()->assertRedirect('/account/profile')->assertSessionHasNoErrors();

        $this->user->refresh();
        expect($this->user->phone_e164)->toBe(ACCOUNT_E164)
            ->and($this->user->phone_verified_at->equalTo(now()))->toBeTrue()
            ->and(session('otp.challenge'))->toBeNull()
            ->and(session('inertia.flash_data.success'))->toBe(trans_icu('account.toasts.phone_verified'));

        $audit = Activity::query()->where('event', 'account.phone_verified')->sole();
        expect($audit->causer_id)->toBe($this->user->getKey())
            ->and($audit->subject_id)->toBe($this->user->getKey())
            ->and($audit->properties->all())->toBe(['from' => null, 'to' => '+91******3210'])
            ->and(json_encode($audit->properties))->not->toContain('9876543210');
    });

    it('audits the old number masked as well when it is changed', function (): void {
        $user = User::factory()->withPhone('+919123456789')->create();
        ($this->sendCode)(as: $user);

        ($this->verifyCode)(as: $user);

        expect($user->refresh()->phone_e164)->toBe(ACCOUNT_E164)
            ->and(Activity::query()->where('event', 'account.phone_verified')->sole()->properties->all())
            ->toBe(['from' => '+91******6789', 'to' => '+91******3210']);
    });

    it('announces the first verified contact, and only that', function (): void {
        Event::fake([ContactVerified::class]);
        $phoneOnlyToBe = User::factory()->unverified()->create();
        ($this->sendCode)(as: $phoneOnlyToBe);

        ($this->verifyCode)(as: $phoneOnlyToBe);

        Event::assertDispatchedTimes(ContactVerified::class, 1);

        // The second contact of a user whose email was verified at once: nothing to announce.
        ($this->sendCode)('98765 43211', $this->user);
        ($this->verifyCode)(as: $this->user);
        Event::assertDispatchedTimes(ContactVerified::class, 1);
    });

    it('lets staff add a phone the same way', function (): void {
        $staff = User::factory()->support()->create();
        ($this->sendCode)(as: $staff);

        ($this->verifyCode)(as: $staff)->assertSessionHasNoErrors();

        expect($staff->refresh()->phone_e164)->toBe(ACCOUNT_E164)->and($staff->phone_verified_at)->not->toBeNull();
    });

    it('refuses a number somebody else has, whatever the state of their account', function (string $state): void {
        $holder = User::factory()->withPhone(ACCOUNT_E164);
        $holder = ($state === 'deleted' ? $holder->pendingDeletion() : $holder)->create();
        ($this->sendCode)();

        ($this->verifyCode)()->assertSessionHasErrors('code');

        expect(session('errors')->get('code')[0])->toBe(__('auth.errors.phone_unavailable'))
            ->and($this->user->refresh()->phone_e164)->toBeNull()
            ->and($holder->refresh()->phone_e164)->toBe(ACCOUNT_E164)
            ->and(Activity::query()->where('event', 'account.phone_verified')->count())->toBe(0);
    })->with(['an active user' => 'active', 'a user pending deletion' => 'deleted']);

    it('answers machines with the code', function (): void {
        User::factory()->withPhone(ACCOUNT_E164)->pendingDeletion()->create();
        ($this->sendCode)();

        $this->actingAs($this->user)->withSession(($this->recent)())->postJson(route('account.phone.verify'), ['code' => $this->delivery->lastCode()])
            ->assertStatus(422)->assertExactJson(['code' => 'phone_unavailable']);
    });

    it('lets a user verify their own number again', function (): void {
        $user = User::factory()->withPhone(ACCOUNT_E164)->create(['phone_verified_at' => now()->subYear()]);
        ($this->sendCode)(as: $user);

        ($this->verifyCode)(as: $user)->assertSessionHasNoErrors();

        expect($user->refresh()->phone_verified_at->equalTo(now()))->toBeTrue();
    });

    it('says how many attempts are left after a wrong code', function (): void {
        ($this->sendCode)();

        ($this->verifyCode)('000000')->assertSessionHasErrors('code');

        expect(session('errors')->get('code')[0])->toBe(trans_choice('auth.errors.otp_invalid', 4, ['attemptsLeft' => 4]))
            ->and(session('errors')->get('attemptsLeft')[0])->toBe('4')
            ->and(session('errors')->get('reason')[0])->toBe('otp_invalid')
            ->and($this->user->refresh()->phone_e164)->toBeNull();
    });

    it('needs a challenge of its own purpose', function (): void {
        ($this->verifyCode)('123456')->assertSessionHasErrors('code');
        expect(session('errors')->get('code')[0])->toBe(__('auth.errors.otp_expired'));

        // The sign-in flow's challenge does not do.
        $this->withSession(['otp.challenge' => [
            'e164' => ACCOUNT_E164, 'purpose' => 'login', 'intent' => 'login', 'channel' => 'sms',
            'otpId' => '01JA0000000000000000000000', 'expiresAt' => now()->addMinutes(10)->getTimestamp(),
        ]]);
        ($this->verifyCode)('123456')->assertSessionHasErrors('code');
        expect($this->user->refresh()->phone_e164)->toBeNull();
    });

    it('does not take an expired challenge', function (): void {
        ($this->sendCode)();
        $code = $this->delivery->lastCode();
        $this->travel(11)->minutes();

        ($this->verifyCode)($code)->assertSessionHasErrors('code');

        expect($this->user->refresh()->phone_e164)->toBeNull();
    });
});

describe('sending the code again', function (): void {
    it('is the same route with the number the challenge holds, once the wait is over', function (): void {
        ($this->sendCode)();
        $this->travel(61)->seconds();

        ($this->sendCode)()->assertSessionHasNoErrors();

        expect($this->delivery->sent())->toHaveCount(2);
    });
});

describe('recent authentication (a ruling beyond 13 section 5.7, 13 section 6.4)', function (): void {
    // The number is where re-authentication codes go. Without this a stolen session could put in its own number and
    // confirm itself with a code sent there.
    beforeEach(function (): void {
        $this->old = SessionStamp::loginHoursAgo(3);
        $this->aged = fn (string $route, array $body, User $as) => $this->actingAs($as)->withSession($this->old)->from('/account/profile')->post(route($route), $body);
    });

    it('is asked of a user with a password, who is sent to confirm it', function (): void {
        ($this->aged)('account.phone.send', ['phone' => ACCOUNT_PHONE], $this->user)->assertRedirectToRoute('password.confirm');
        ($this->aged)('account.phone.verify', ['code' => '123456'], $this->user)->assertRedirectToRoute('password.confirm');

        expect($this->delivery->sent())->toBe([])->and($this->user->refresh()->phone_e164)->toBeNull();
    });

    it('sends an Inertia visit to confirm and remembers the page it came from, which is what the dialog leaves for', function (): void {
        $headers = [...InertiaRequest::headers(), 'Referer' => url('/account/profile')];

        $this->actingAs($this->user)->withSession($this->old)->withHeaders($headers)
            ->post(route('account.phone.verify'), ['code' => '123456'])->assertRedirectToRoute('password.confirm');

        expect(session('url.intended'))->toBe('/account/profile');
    });

    it('is asked of a user with a verified phone and no password, who is sent to re-authenticate', function (): void {
        $user = User::factory()->phoneOnly()->create();

        ($this->aged)('account.phone.send', ['phone' => ACCOUNT_PHONE], $user)->assertRedirectToRoute('auth.reauthenticate');

        expect($this->delivery->sent())->toBe([]);
    });

    it('is asked of a user whose only way in is Google', function (): void {
        $user = User::factory()->passwordless()->googleLinked()->create();

        ($this->aged)('account.phone.send', ['phone' => ACCOUNT_PHONE], $user)->assertRedirectToRoute('auth.reauthenticate');
    });

    it('is asked of staff, who have a password', function (): void {
        ($this->aged)('account.phone.send', ['phone' => ACCOUNT_PHONE], User::factory()->support()->create())->assertRedirectToRoute('password.confirm');
    });

    it('is not asked of a user who has no way to prove who they are yet', function (): void {
        $user = User::factory()->passwordless()->unverified()->create();

        ($this->aged)('account.phone.send', ['phone' => ACCOUNT_PHONE], $user)->assertSessionHasNoErrors();
        expect($this->delivery->sent())->toHaveCount(1);

        ($this->aged)('account.phone.verify', ['code' => $this->delivery->lastCode()], $user)->assertSessionHasNoErrors();
        expect($user->refresh()->phone_e164)->toBe(ACCOUNT_E164);
    });

    it('answers machines with 403 recent_auth_required', function (): void {
        $this->actingAs($this->user)->withSession($this->old)->postJson(route('account.phone.send'), ['phone' => ACCOUNT_PHONE])
            ->assertStatus(403)->assertJsonPath('code', 'recent_auth_required');
    });

    it('lets a session confirmed in the last ten minutes through', function (): void {
        $this->actingAs($this->user)->withSession([...$this->old, 'auth.password_confirmed_at' => now()->subMinutes(5)->getTimestamp()])
            ->post(route('account.phone.send'), ['phone' => ACCOUNT_PHONE])->assertSessionHasNoErrors();

        expect($this->delivery->sent())->toHaveCount(1);
    });
});

describe('too many tries', function (): void {
    it('comes back to the page with the wait as an error, so that the dialog does not take it for a success', function (): void {
        ($this->sendCode)();
        foreach (range(1, 10) as $_) {
            ($this->verifyCode)('12 34');
        }

        $headers = [...InertiaRequest::headers(), 'Referer' => url('/account/profile')];
        $this->actingAs($this->user)->withSession(($this->recent)())->withHeaders($headers)
            ->post(route('account.phone.verify'), ['code' => '123456'])->assertRedirect(url('/account/profile'));

        expect((int) session('errors.default.messages.rate_limited.0'))->toBeGreaterThan(0)
            ->and(session('inertia.flash_data.error'))->toBeNull()
            ->and($this->user->refresh()->phone_e164)->toBeNull();
    });
});
