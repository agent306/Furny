<?php

declare(strict_types=1);

use App\Domain\Identity\Models\User;
use App\Notifications\Auth\ResetPassword;
use Illuminate\Contracts\Queue\Queue as QueueContract;
use Illuminate\Contracts\Queue\ShouldBeEncrypted;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Notifications\ChannelManager;
use Illuminate\Queue\Connectors\ConnectorInterface;
use Illuminate\Queue\SyncQueue;
use Illuminate\Support\Facades\Exceptions;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Queue;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\Support\InertiaRequest;

beforeEach(function (): void {
    Notification::fake();
    $this->user = User::factory()->create(['email' => 'asha@example.com']);
    // The reset link request as the forgot-password page sends it.
    $this->send = fn (string $email, string $ip = '203.0.113.45', array $extra = []) => $this
        ->withServerVariables(['REMOTE_ADDR' => $ip])
        ->from(route('password.request'))
        ->post(route('password.email'), ['email' => $email, ...$extra]);
});

describe('the generic answer (13 section 5.5)', function (): void {
    it('answers an existing and an unknown email with the same status and redirect', function (): void {
        $known = ($this->send)('asha@example.com');
        $unknown = ($this->send)('nobody@example.com');

        $known->assertRedirect(route('password.request'))->assertSessionHas('status', trans('passwords.sent_generic'))->assertSessionHasNoErrors();
        $unknown->assertRedirect(route('password.request'))->assertSessionHas('status', trans('passwords.sent_generic'))->assertSessionHasNoErrors();

        expect($known->getStatusCode())->toBe($unknown->getStatusCode())
            ->and(trans('passwords.sent_generic'))->toBe("If an account exists for that email, we've sent a reset link.");
    });

    it('answers a JSON client the same way for an existing and an unknown email', function (): void {
        $known = $this->postJson(route('password.email'), ['email' => 'asha@example.com']);
        $unknown = $this->postJson(route('password.email'), ['email' => 'nobody@example.com']);

        $known->assertOk()->assertExactJson(['message' => trans('passwords.sent_generic')]);
        $unknown->assertOk()->assertExactJson(['message' => trans('passwords.sent_generic')]);
    });

    it('answers a second request within the broker\'s own wait with the same status', function (): void {
        ($this->send)('asha@example.com');

        ($this->send)('asha@example.com')->assertSessionHas('status', trans('passwords.sent_generic'))->assertSessionHasNoErrors();

        Notification::assertSentToTimes($this->user, ResetPassword::class, 1);
    });

    it('does not tell a deleted or an inactive account apart', function (): void {
        $deleted = User::factory()->create(['email' => 'gone@example.com']);
        $deleted->delete();

        ($this->send)('gone@example.com')->assertSessionHas('status', trans('passwords.sent_generic'))->assertSessionHasNoErrors();

        Notification::assertNotSentTo($deleted, ResetPassword::class);
    });

    it('still validates the email field', function (): void {
        ($this->send)('not an email')->assertSessionHasErrors('email');
        ($this->send)('')->assertSessionHasErrors('email');
    });

    it('shows the status on the forgot-password page', function (): void {
        ($this->send)('asha@example.com');

        $this->get(route('password.request'))->assertInertia(fn (Assert $page) => $page
            ->component('Auth/ForgotPassword')
            ->where('status', trans('passwords.sent_generic')));
    });
});

describe('who gets a link', function (): void {
    it('sends the reset notification to the existing user only', function (): void {
        ($this->send)('nobody@example.com');
        Notification::assertNothingSent();

        ($this->send)('asha@example.com');

        Notification::assertSentTo($this->user, ResetPassword::class);
        Notification::assertCount(1);
    });

    it('finds the user whatever the case of the typed email', function (): void {
        ($this->send)('ASHA@Example.COM');

        Notification::assertSentTo($this->user, ResetPassword::class);
    });

    it('sends a link to a passwordless user with an email, so they can create a password', function (): void {
        $passwordless = User::factory()->passwordless()->create(['email' => 'phone.first@example.com']);

        ($this->send)('phone.first@example.com');

        Notification::assertSentTo($passwordless, ResetPassword::class);
    });

    it('sends the link to staff as well', function (): void {
        $staff = User::factory()->owner()->create(['email' => 'owner@example.com']);

        ($this->send)('owner@example.com');

        Notification::assertSentTo($staff, ResetPassword::class);
    });

    it('builds the link from the token and the email, and the mail from the translations', function (): void {
        $notification = new ResetPassword('the-token');
        $mail = $notification->toMail($this->user);

        expect($notification->via($this->user))->toBe(['mail'])
            ->and($mail->subject)->toBe('Reset your '.config('app.name').' password')
            ->and($mail->greeting)->toBe('Reset your password')
            ->and($mail->actionText)->toBe('Choose a new password')
            ->and($mail->actionUrl)->toBe(route('password.reset', ['token' => 'the-token', 'email' => 'asha@example.com']))
            ->and(implode(' ', $mail->introLines))->toContain('60 minutes');
    });

    it('is queued and encrypted, so the token is not readable in the queue', function (): void {
        expect(new ResetPassword('t'))->toBeInstanceOf(ShouldQueue::class)->toBeInstanceOf(ShouldBeEncrypted::class);
    });
});

describe('a queue outage (13 section 5.5)', function (): void {
    beforeEach(function (): void {
        // The mail is queued; the connection refuses the job.
        Queue::extend('broken', fn (): ConnectorInterface => new class implements ConnectorInterface
        {
            public function connect(array $config): QueueContract
            {
                return new class extends SyncQueue
                {
                    public function push($job, $data = '', $queue = null): never
                    {
                        throw new RuntimeException('queue is down');
                    }
                };
            }
        });
        config(['queue.connections.broken' => ['driver' => 'broken'], 'queue.default' => 'broken']);
        // The real notification dispatcher instead of the fake of the other tests.
        Notification::swap(new ChannelManager(app()));
    });

    it('reports the failure and still gives the generic answer for a known address', function (): void {
        Exceptions::fake();

        $known = ($this->send)('asha@example.com');
        $unknown = ($this->send)('nobody@example.com');

        $known->assertRedirect(route('password.request'))->assertSessionHas('status', trans('passwords.sent_generic'))->assertSessionHasNoErrors();
        expect($known->getStatusCode())->toBe($unknown->getStatusCode());
        Exceptions::assertReported(fn (RuntimeException $exception): bool => $exception->getMessage() === 'queue is down');
    });

    it('answers a JSON client with the generic message as well', function (): void {
        Exceptions::fake();

        $this->postJson(route('password.email'), ['email' => 'asha@example.com'])->assertOk()->assertExactJson(['message' => trans('passwords.sent_generic')]);
    });

    it('lets any other sender of the notification see the failure', function (): void {
        expect(fn () => $this->user->sendPasswordResetNotification('a-token'))->toThrow(RuntimeException::class, 'queue is down');
    });
});

describe('the hourly limit stays silent (13 section 10, preflight C9)', function (): void {
    it('answers the 4th request for one email within an hour with the generic status, and sends nothing', function (): void {
        foreach (range(1, 3) as $_) {
            // Past the broker's own wait of 60 seconds between two links.
            $this->travel(61)->seconds();
            ($this->send)('asha@example.com')->assertSessionHas('status', trans('passwords.sent_generic'));
        }

        Notification::assertSentToTimes($this->user, ResetPassword::class, 3);

        $this->travel(61)->seconds();
        $fourth = ($this->send)('asha@example.com');

        $fourth->assertRedirect(route('password.request'))->assertSessionHas('status', trans('passwords.sent_generic'))->assertSessionHasNoErrors();
        expect($fourth->getStatusCode())->toBe(302);
        Notification::assertSentToTimes($this->user, ResetPassword::class, 3);
    });

    it('sends again when the hour is over', function (): void {
        foreach (range(1, 4) as $_) {
            $this->travel(61)->seconds();
            ($this->send)('asha@example.com');
        }

        Notification::assertSentToTimes($this->user, ResetPassword::class, 3);

        $this->travel(61)->minutes();
        ($this->send)('asha@example.com');

        Notification::assertSentToTimes($this->user, ResetPassword::class, 4);
    });

    it('limits one address (10 an hour) whatever the emails asked for', function (): void {
        foreach (range(1, 10) as $number) {
            ($this->send)("nobody{$number}@example.com");
        }

        ($this->send)('asha@example.com')->assertSessionHas('status', trans('passwords.sent_generic'));

        Notification::assertNothingSent();

        // Another address is not limited.
        ($this->send)('asha@example.com', '198.51.100.7');

        Notification::assertSentTo($this->user, ResetPassword::class);
    });

    it('does not turn a throttled request with a bad email into the generic answer', function (): void {
        foreach (range(1, 10) as $number) {
            ($this->send)("nobody{$number}@example.com");
        }

        ($this->send)('not an email')->assertSessionHasErrors('email');
    });

    it('answers a throttled Inertia visit with the same redirect, and no 429', function (): void {
        foreach (range(1, 10) as $number) {
            ($this->send)("nobody{$number}@example.com");
        }

        $this->withHeaders([...InertiaRequest::headers(), 'Referer' => route('password.request')])
            ->withServerVariables(['REMOTE_ADDR' => '203.0.113.45'])
            ->post(route('password.email'), ['email' => 'asha@example.com'])
            ->assertRedirect(route('password.request'))
            ->assertSessionHas('status', trans('passwords.sent_generic'));
    });
});

describe('the Turnstile check (fail open)', function (): void {
    beforeEach(function (): void {
        config(['services.turnstile.site_key' => '1x00000000000000000000AA', 'services.turnstile.secret_key' => 'secret-value']);
        $host = parse_url((string) config('app.url'), PHP_URL_HOST);
        $this->cloudflare = fn (array $answer) => Http::fake([
            'challenges.cloudflare.com/*' => Http::response(['success' => true, 'hostname' => $host, 'action' => 'password_reset', ...$answer]),
        ]);
    });

    it('lets a token for the password_reset form through', function (): void {
        ($this->cloudflare)([]);

        ($this->send)('asha@example.com', extra: ['cf_turnstile_response' => 'token'])->assertSessionHas('status')->assertSessionHasNoErrors();

        Notification::assertSentTo($this->user, ResetPassword::class);
    });

    it('refuses a token that was made for another form', function (): void {
        ($this->cloudflare)(['action' => 'register']);

        ($this->send)('asha@example.com', extra: ['cf_turnstile_response' => 'token'])
            ->assertSessionHasErrors(['cf_turnstile_response' => __('auth.captcha_failed')]);

        Notification::assertNothingSent();
    });

    it('refuses a missing token', function (): void {
        Http::fake();

        ($this->send)('asha@example.com')->assertSessionHasErrors(['cf_turnstile_response' => __('auth.captcha_failed')]);

        Notification::assertNothingSent();
    });

    it('lets the request through while Cloudflare cannot be reached', function (): void {
        Http::fake(fn () => throw new ConnectionException('timeout'));

        ($this->send)('asha@example.com', extra: ['cf_turnstile_response' => 'token'])->assertSessionHasNoErrors();

        Notification::assertSentTo($this->user, ResetPassword::class);
    });
});

it('hands the forgot-password page the status and the page props', function (): void {
    $this->get(route('password.request'))->assertInertia(fn (Assert $page) => $page
        ->component('Auth/ForgotPassword')
        ->where('status', null)
        ->has('features')
        ->where('turnstileSiteKey', null));
});

it('keeps the broker\'s lifetime and wait at an hour and a minute', function (): void {
    expect(config('auth.passwords.users.expire'))->toBe(60)
        ->and(config('auth.passwords.users.throttle'))->toBe(60)
        ->and(config('auth.verification.expire'))->toBe(60)
        ->and(config('auth.password_timeout'))->toBe(600);
});
