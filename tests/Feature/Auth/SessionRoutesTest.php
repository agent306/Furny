<?php

declare(strict_types=1);

use App\Domain\Identity\Models\User;
use App\Support\Auth\SessionKey;
use App\Support\Auth\SessionRegistry;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Facades\Session;
use Illuminate\Support\Str;
use Spatie\Activitylog\Models\Activity;
use Tests\Support\SessionStamp;

/** Opens a session for `$user` in the handler and the registry and returns its id. */
function openSessionFor(User $user, string $ip = '203.0.113.45'): string
{
    $id = Str::random(40);
    Session::getHandler()->write($id, '[]');
    app(SessionRegistry::class)->register($user, $id, Request::create('/', server: ['REMOTE_ADDR' => $ip, 'HTTP_USER_AGENT' => 'Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0']), 'password', false);

    return $id;
}

/** Cleans the registry keys of `$users`: the sessions their requests registered as well. */
function forgetRegistryOf(User ...$users): void
{
    $redis = Redis::connection('sessions');

    foreach ($users as $user) {
        $key = 'sess:user:'.$user->getKey();

        foreach ($redis->zrange($key, 0, -1) as $id) {
            $redis->del('sess:meta:'.$id);
        }

        $redis->del($key);
    }
}

beforeEach(function (): void {
    $this->user = User::factory()->create();
    $this->current = openSessionFor($this->user);
    // The request arrives on the session `$this->current` (its cookie), and is recent.
    $this->asCurrent = fn () => $this->actingAs($this->user)
        ->withCookie((string) config('session.cookie'), $this->current)
        ->withSession(SessionStamp::loginHoursAgo(0));
});

afterEach(function (): void {
    forgetRegistryOf($this->user, ...($this->others ?? []));
});

it('keeps the remember cookie of the web guard for 14 days (13 section 6.1)', function (): void {
    $guard = Auth::guard('web');

    expect((fn () => $this->getRememberDuration())->call($guard))->toBe(20160);
});

describe('account.sessions.destroy-others', function (): void {
    it('asks for the password first when the sign-in is not recent', function (): void {
        $other = openSessionFor($this->user, '198.51.100.7');

        $this->actingAs($this->user)
            ->withCookie((string) config('session.cookie'), $this->current)
            ->withSession(SessionStamp::loginHoursAgo(1))
            ->delete(route('account.sessions.destroy-others'))
            ->assertRedirectToRoute('password.confirm');

        expect(Session::getHandler()->read($other))->not->toBe('')
            ->and(Activity::query()->where('event', 'auth.sessions_revoked')->count())->toBe(0);
    });

    it('signs out the other devices and writes the audit entry', function (): void {
        $other = openSessionFor($this->user, '198.51.100.7');
        $this->user->forceFill(['remember_token' => 'old-token'])->save();

        ($this->asCurrent)()
            ->from('/dashboard')
            ->delete(route('account.sessions.destroy-others'))
            ->assertRedirect('/dashboard');

        expect(Session::getHandler()->read($other))->toBe('')
            ->and(Session::getHandler()->read($this->current))->not->toBe('')
            ->and($this->user->fresh()->remember_token)->not->toBe('old-token');

        $activity = Activity::query()->where('event', 'auth.sessions_revoked')->sole();

        expect($activity->log_name)->toBe('security')
            ->and($activity->subject_id)->toBe($this->user->getKey())
            ->and($activity->causer_id)->toBe($this->user->getKey())
            ->and($activity->properties->all())->toBe(['count' => 1, 'reason' => 'signed_out_others']);
    });

    it('also accepts a confirmation of the password a few minutes ago', function (): void {
        $other = openSessionFor($this->user, '198.51.100.7');

        $this->actingAs($this->user)
            ->withCookie((string) config('session.cookie'), $this->current)
            ->withSession(['auth.login_at' => SessionStamp::hoursAgo(5), 'auth.password_confirmed_at' => SessionStamp::minutesAgo(3)])
            ->delete(route('account.sessions.destroy-others'))
            ->assertRedirect();

        expect(Session::getHandler()->read($other))->toBe('');
    });

    it('writes no audit entry when there was nothing to sign out', function (): void {
        ($this->asCurrent)()->delete(route('account.sessions.destroy-others'))->assertRedirect();

        expect(Activity::query()->where('event', 'auth.sessions_revoked')->count())->toBe(0);
    });

    it('leaves the sessions of other users alone', function (): void {
        $stranger = User::factory()->create();
        $this->others = [$stranger];
        $theirs = openSessionFor($stranger);

        ($this->asCurrent)()->delete(route('account.sessions.destroy-others'))->assertRedirect();

        expect(Session::getHandler()->read($theirs))->not->toBe('');
    });

    it('clears the history of the browser that stays', function (): void {
        openSessionFor($this->user, '198.51.100.7');

        ($this->asCurrent)()->delete(route('account.sessions.destroy-others'));

        expect(session('inertia.clear_history'))->toBeTrue();
    });

    it('gives a browser that came in on the remember cookie the rotated token back', function (): void {
        openSessionFor($this->user, '198.51.100.7');
        $this->user->forceFill(['remember_token' => 'old-token'])->save();
        $recaller = $this->user->getKey().'|old-token|'.$this->user->getAuthPassword();

        $response = $this->withCookie(Auth::guard('web')->getRecallerName(), $recaller)
            ->withSession(SessionStamp::loginHoursAgo(0))
            ->delete(route('account.sessions.destroy-others'));

        $cookie = collect($response->headers->getCookies())->first(fn ($cookie): bool => $cookie->getName() === Auth::guard('web')->getRecallerName());

        expect($cookie)->not->toBeNull()
            ->and($cookie->getExpiresTime())->toBeBetween(now()->addMinutes(20159)->getTimestamp(), now()->addMinutes(20161)->getTimestamp());

        $token = $this->user->fresh()->remember_token;

        expect($token)->not->toBe('old-token')
            ->and(decrypt($cookie->getValue(), false))->toContain('|'.$token.'|');
    });

    it('is for signed-in users only', function (): void {
        $this->delete(route('account.sessions.destroy-others'))->assertRedirectToRoute('login');
    });
});

describe('account.sessions.destroy', function (): void {
    it('signs out another device', function (): void {
        $other = openSessionFor($this->user, '198.51.100.7');

        ($this->asCurrent)()
            ->from('/dashboard')
            ->delete(route('account.sessions.destroy', SessionKey::for($other)))
            ->assertRedirect('/dashboard');

        expect(Session::getHandler()->read($other))->toBe('')
            ->and(Session::getHandler()->read($this->current))->not->toBe('');

        $activity = Activity::query()->where('event', 'auth.sessions_revoked')->sole();

        expect($activity->properties->all())->toBe(['count' => 1, 'reason' => 'signed_out_device']);
    });

    it('needs no recent sign-in', function (): void {
        $other = openSessionFor($this->user, '198.51.100.7');

        $this->actingAs($this->user)
            ->withCookie((string) config('session.cookie'), $this->current)
            ->withSession(SessionStamp::loginHoursAgo(30))
            ->delete(route('account.sessions.destroy', SessionKey::for($other)))
            ->assertRedirect();

        expect(Session::getHandler()->read($other))->toBe('');
    });

    it('signs the user out when the session in use is the one revoked', function (): void {
        ($this->asCurrent)()
            ->delete(route('account.sessions.destroy', SessionKey::for($this->current)))
            ->assertRedirectToRoute('login');

        $this->assertGuest();

        expect(Session::getHandler()->read($this->current))->toBe('')
            ->and(session('inertia.clear_history'))->toBeTrue()
            ->and(Activity::query()->where('event', 'auth.sessions_revoked')->sole()->properties['count'])->toBe(1);
    });

    it('answers 404 for the key of another user\'s session', function (): void {
        $stranger = User::factory()->create();
        $this->others = [$stranger];
        $theirs = openSessionFor($stranger);

        ($this->asCurrent)()
            ->delete(route('account.sessions.destroy', SessionKey::for($theirs)))
            ->assertNotFound();

        expect(Session::getHandler()->read($theirs))->not->toBe('')
            ->and(Activity::query()->where('event', 'auth.sessions_revoked')->count())->toBe(0);
    });

    it('answers 404 for a key that matches nothing', function (string $key): void {
        ($this->asCurrent)()->delete('/account/sessions/'.$key)->assertNotFound();
    })->with([
        'well-formed but unknown' => [str_repeat('a', 32)],
        'malformed' => ['not-a-session-key'],
        'the raw session id' => [str_repeat('b', 40)],
    ]);

    it('does not accept a raw session id in place of the key', function (): void {
        $other = openSessionFor($this->user, '198.51.100.7');

        ($this->asCurrent)()->delete('/account/sessions/'.$other)->assertNotFound();

        expect(Session::getHandler()->read($other))->not->toBe('');
    });

    it('is for signed-in users only', function (): void {
        $this->delete(route('account.sessions.destroy', str_repeat('a', 32)))->assertRedirectToRoute('login');
    });

    it('is not for a deactivated user', function (): void {
        $other = openSessionFor($this->user, '198.51.100.7');
        $this->user->forceFill(['is_active' => false])->save();

        ($this->asCurrent)()
            ->delete(route('account.sessions.destroy', SessionKey::for($other)))
            ->assertRedirectToRoute('login');

        expect(Session::getHandler()->read($other))->not->toBe('');
    });
});
