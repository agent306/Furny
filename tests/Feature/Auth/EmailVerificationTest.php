<?php

declare(strict_types=1);

use App\Domain\Identity\Events\ContactVerified;
use App\Domain\Identity\Models\User;
use App\Notifications\Auth\VerifyEmail;
use App\Support\Http\RateLimitedResponse;
use Illuminate\Auth\Events\Registered;
use Illuminate\Auth\Events\Verified;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\URL;
use Inertia\Testing\AssertableInertia as Assert;
use Spatie\Activitylog\Models\Activity;
use Tests\Support\InertiaRequest;
use Tests\Support\RegistryFixtures;

/** The signed link the verification mail carries, made for `$user` as the notification makes it. */
function verificationLink(User $user, int $minutes = 60): string
{
    return URL::temporarySignedRoute('verification.verify', now()->addMinutes($minutes), [
        'id' => $user->getKey(),
        'hash' => sha1((string) $user->email),
    ]);
}

beforeEach(function (): void {
    $this->user = User::factory()->unverified()->create(['email' => 'asha@example.com']);
});

afterEach(function (): void {
    RegistryFixtures::clean($this->user);
});

describe('the signed link (13 section 5.6)', function (): void {
    it('verifies the email, writes account.email_verified and lands on the dashboard with a toast', function (): void {
        $this->actingAs($this->user)
            ->get(verificationLink($this->user))
            ->assertRedirect(route('customer.dashboard'))
            ->assertInertiaFlash('success', trans_icu('account.toasts.email_verified'));

        $activity = Activity::query()->where('event', 'account.email_verified')->sole();

        expect($this->user->refresh()->email_verified_at)->not->toBeNull()
            ->and($this->user->email_verified_at->diffInSeconds(now()))->toBeLessThan(5)
            ->and($activity->log_name)->toBe('security')
            ->and($activity->subject_id)->toBe($this->user->getKey())
            ->and($activity->causer_id)->toBe($this->user->getKey())
            ->and($activity->properties->all())->toBe(['email' => 'a**a@e******.com']);
    });

    it('sends staff to the admin dashboard', function (): void {
        $staff = User::factory()->owner()->unverified()->create();

        $this->actingAs($staff)->get(verificationLink($staff))->assertRedirect(route('admin.dashboard'));

        expect($staff->refresh()->email_verified_at)->not->toBeNull();
    });

    it('dispatches Verified once and ContactVerified once', function (): void {
        Event::fake([Verified::class, ContactVerified::class]);

        $this->actingAs($this->user)->get(verificationLink($this->user));

        Event::assertDispatchedTimes(Verified::class, 1);
        Event::assertDispatchedTimes(ContactVerified::class, 1);
    });

    it('does nothing the second time the link is opened', function (): void {
        $link = verificationLink($this->user);

        $this->actingAs($this->user)->get($link);
        $verifiedAt = $this->user->refresh()->email_verified_at;

        $this->travel(5)->minutes();
        $this->actingAs($this->user)->get($link)->assertRedirect();

        expect($this->user->refresh()->email_verified_at->equalTo($verifiedAt))->toBeTrue()
            ->and(Activity::query()->where('event', 'account.email_verified')->count())->toBe(1);
    });

    it('is accepted 59 minutes after it was made and rejected 61 minutes after', function (): void {
        $link = verificationLink($this->user);

        $this->travel(61)->minutes();
        $this->actingAs($this->user)->get($link)->assertForbidden();
        expect($this->user->refresh()->email_verified_at)->toBeNull();

        $this->travelBack();
        $this->travel(59)->minutes();
        $this->actingAs($this->user)->get($link)->assertRedirect();
        expect($this->user->refresh()->email_verified_at)->not->toBeNull();
    });

    it('is rejected when the signature is altered', function (): void {
        $this->actingAs($this->user)->get(verificationLink($this->user).'0')->assertForbidden();

        expect($this->user->refresh()->email_verified_at)->toBeNull();
    });

    it('is rejected for another user, who is signed in', function (): void {
        $other = User::factory()->unverified()->create();

        $this->actingAs($other)->get(verificationLink($this->user))->assertForbidden();

        expect($this->user->refresh()->email_verified_at)->toBeNull()->and($other->refresh()->email_verified_at)->toBeNull();
    });

    it('is rejected once the email was changed after the link was sent', function (): void {
        $link = verificationLink($this->user);
        $this->user->forceFill(['email' => 'new@example.com'])->save();

        $this->actingAs($this->user)->get($link)->assertForbidden();

        expect($this->user->refresh()->email_verified_at)->toBeNull();
    });

    it('sends a logged-out click to the login page and brings the user back to the link after sign-in', function (): void {
        $link = verificationLink($this->user);

        $this->get($link)->assertRedirect(route('login'));
        expect($this->user->refresh()->email_verified_at)->toBeNull();

        $this->post(route('login.store'), ['email' => 'asha@example.com', 'password' => 'password'])
            ->assertRedirect($link);

        $this->get($link)->assertRedirect(route('customer.dashboard'));

        expect($this->user->refresh()->email_verified_at)->not->toBeNull();
    });
});

describe('the notification', function (): void {
    it('is the temporary signed verification route for 60 minutes', function (): void {
        $notification = new VerifyEmail;
        $mail = $notification->toMail($this->user);
        $parts = parse_url((string) $mail->actionUrl);
        parse_str($parts['query'] ?? '', $query);

        expect($notification->via($this->user))->toBe(['mail'])
            ->and($mail->actionUrl)->toStartWith(route('verification.verify', ['id' => $this->user->getKey(), 'hash' => sha1('asha@example.com')]))
            ->and((int) $query['expires'])->toBe(now()->addMinutes(60)->getTimestamp())
            ->and(URL::hasValidSignature(Request::create((string) $mail->actionUrl)))->toBeTrue()
            ->and($mail->subject)->toBe('Verify your email for '.config('app.name'))
            ->and($mail->greeting)->toBe('Verify your email address')
            ->and($mail->actionText)->toBe('Verify email')
            ->and(implode(' ', $mail->introLines))->toContain('60 minutes');
    });

    it('is sent to the user by sendEmailVerificationNotification', function (): void {
        Notification::fake();

        $this->user->sendEmailVerificationNotification();

        Notification::assertSentTo($this->user, VerifyEmail::class);
    });

    it('sends nothing to a phone-only user', function (): void {
        Notification::fake();
        $phoneOnly = User::factory()->phoneOnly()->create();

        $phoneOnly->sendEmailVerificationNotification();

        Notification::assertNothingSent();
    });

    it('is sent when a customer registers', function (): void {
        Notification::fake();

        $this->post(route('register.store'), [
            'name' => 'Ravi Menon',
            'email' => 'ravi@example.com',
            'password' => 'a-long-enough-password',
            'password_confirmation' => 'a-long-enough-password',
            'terms' => 'on',
        ])->assertRedirect();

        Notification::assertSentTo(User::query()->where('email', 'ravi@example.com')->sole(), VerifyEmail::class);
    });

    it('is sent by the Registered event only to a user with an email', function (): void {
        Notification::fake();

        event(new Registered(User::factory()->phoneOnly()->create()));

        Notification::assertNothingSent();
    });
});

describe('resending (verification.send)', function (): void {
    it('sends a fresh link and flashes the status', function (): void {
        Notification::fake();

        $this->actingAs($this->user)->from(route('verification.notice'))
            ->post(route('verification.send'))
            ->assertRedirect(route('verification.notice'))
            ->assertSessionHas('status', 'verification-link-sent');

        Notification::assertSentTo($this->user, VerifyEmail::class);
    });

    it('sends nothing to a user whose email is verified', function (): void {
        Notification::fake();

        $this->actingAs(User::factory()->create())->post(route('verification.send'));

        Notification::assertNothingSent();
    });

    it('allows 3 in 10 minutes per user and answers the 4th with 429 and the wait', function (): void {
        Notification::fake();
        $this->actingAs($this->user);

        foreach (range(1, 3) as $_) {
            $this->post(route('verification.send'))->assertRedirect();
        }

        $this->postJson(route('verification.send'))->assertStatus(429)->assertJsonPath('code', 'rate_limited');
        Notification::assertSentToTimes($this->user, VerifyEmail::class, 3);

        $this->travel(11)->minutes();
        $this->post(route('verification.send'))->assertRedirect();
        Notification::assertSentToTimes($this->user, VerifyEmail::class, 4);
    });

    it('counts per user, not per address', function (): void {
        Notification::fake();
        $other = User::factory()->unverified()->create();

        foreach (range(1, 3) as $_) {
            $this->actingAs($this->user)->post(route('verification.send'));
        }

        $this->actingAs($other)->post(route('verification.send'))->assertRedirect();
        Notification::assertSentTo($other, VerifyEmail::class);
    });

    it('shows the wait on the verify page itself, not as a toast', function (): void {
        Notification::fake();
        $headers = [...InertiaRequest::headers(), 'Referer' => route('verification.notice')];
        $this->actingAs($this->user);

        foreach (range(1, 3) as $_) {
            $this->post(route('verification.send'));
        }

        $this->withHeaders($headers)->post(route('verification.send'))->assertRedirect(route('verification.notice'));

        $page = $this->withHeaders(InertiaRequest::headers())->get(route('verification.notice'))->assertOk();

        expect((int) $page->json('props.errors.rate_limited'))->toBeGreaterThan(0)->toBeLessThanOrEqual(600)
            ->and($page->json())->not->toHaveKey('flash');
    });

    describe('from the banner (10 section 1.1)', function (): void {
        // The banner posts to the same route as the verify page, but sits on any customer page: it has no countdown
        // to show the wait in, so it asks for the toast with a header. The verify page sends nothing and keeps the
        // inline countdown.
        beforeEach(function (): void {
            Notification::fake();
            $this->actingAs($this->user);

            foreach (range(1, 3) as $_) {
                $this->post(route('verification.send'));
            }

            $this->banner = fn (string $from = 'customer.dashboard') => $this
                ->withHeaders([...InertiaRequest::headers(), 'Referer' => route($from), RateLimitedResponse::TOAST_HEADER => '1'])
                ->post(route('verification.send'));
        });

        it('shows the wait as a toast, with the seconds', function (): void {
            ($this->banner)()->assertRedirect(route('customer.dashboard'));

            $page = $this->withHeaders(InertiaRequest::headers())->get(route('customer.dashboard'))->assertOk();

            $seconds = (int) preg_replace('/\D+/', '', (string) $page->json('flash.error'));
            expect($seconds)->toBeGreaterThan(0)->toBeLessThanOrEqual(600)
                ->and($page->json('flash.error'))->toBe(trans_icu('errors.rate_limited', ['seconds' => $seconds]))
                ->and($page->json('props.errors'))->not->toHaveKey('rate_limited');
        });

        it('is the header that decides, not the page it was posted from', function (): void {
            // Even from the verify page: a banner on a page of its own kind would still ask for the toast.
            ($this->banner)('verification.notice')->assertRedirect(route('verification.notice'));

            $page = $this->withHeaders(InertiaRequest::headers())->get(route('verification.notice'))->assertOk();

            expect($page->json('flash.error'))->toBeString()->and($page->json('props.errors'))->not->toHaveKey('rate_limited');
        });

        it('leaves the verify page its inline countdown when it does not send the header', function (): void {
            $this->withHeaders([...InertiaRequest::headers(), 'Referer' => route('verification.notice')])
                ->post(route('verification.send'))->assertRedirect(route('verification.notice'));

            $page = $this->withHeaders(InertiaRequest::headers())->get(route('verification.notice'))->assertOk();

            expect((int) $page->json('props.errors.rate_limited'))->toBeGreaterThan(0)->and($page->json())->not->toHaveKey('flash');
        });

        it('answers machines the same either way', function (): void {
            $this->withHeaders([RateLimitedResponse::TOAST_HEADER => '1'])->postJson(route('verification.send'))
                ->assertStatus(429)->assertJsonPath('code', 'rate_limited');
        });
    });

    it('keeps a guest out', function (): void {
        $this->post(route('verification.send'))->assertRedirect(route('login'));
    });
});

describe('the notice page (10 section 4.6)', function (): void {
    it('hands the page the status and the email', function (): void {
        $this->actingAs($this->user)->withSession(['status' => 'verification-link-sent'])
            ->get(route('verification.notice'))
            ->assertInertia(fn (Assert $page) => $page
                ->component('Auth/VerifyEmail')
                ->where('status', 'verification-link-sent')
                ->where('email', 'asha@example.com')
                ->has('features'));
    });

    it('sends a user whose email is verified on to the app', function (): void {
        $this->actingAs(User::factory()->create())->get(route('verification.notice'))->assertRedirect();
    });

    it('does not show a phone-only user a page about an email they do not have', function (): void {
        $this->actingAs(User::factory()->phoneOnly()->create())
            ->get(route('verification.notice'))
            ->assertRedirect(route('customer.dashboard'));
    });
});
