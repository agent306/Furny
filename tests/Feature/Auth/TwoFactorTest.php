<?php

declare(strict_types=1);

use App\Domain\Identity\Models\User;
use App\Http\Middleware\PreventCustomerTwoFactor;
use App\Http\Middleware\PreventRequiredTwoFactorDisable;
use App\Support\Auth\SessionRegistry;
use App\Support\Http\RateLimitedResponse;
use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Facades\Session;
use Illuminate\Support\Str;
use Inertia\Testing\AssertableInertia as Assert;
use PragmaRX\Google2FA\Google2FA;
use Spatie\Activitylog\Models\Activity;
use Tests\Support\InertiaRequest;

/*
|--------------------------------------------------------------------------
| Two-factor authentication (13 section 5.10, 14 section 3.1)
|--------------------------------------------------------------------------
*/

const TWO_FACTOR_TEST_SECRET = 'JBSWY3DPEHPK3PXP';

/** The code an authenticator shows right now for `$secret`. */
function currentCode(string $secret = TWO_FACTOR_TEST_SECRET): string
{
    return app(Google2FA::class)->getCurrentOtp($secret);
}

beforeEach(function (): void {
    // The password was confirmed a moment ago, as the Fortify routes behind `password.confirm` need.
    $this->confirmed = fn () => [
        'auth.login_at' => now()->getTimestamp(),
        'auth.password_confirmed_at' => now()->getTimestamp(),
    ];
    $this->as = fn (User $user) => $this->actingAs($user)->withSession(($this->confirmed)());
});

afterEach(function (): void {
    $redis = Redis::connection('sessions');

    foreach (User::withTrashed()->get() as $user) {
        $key = 'sess:user:'.$user->getKey();

        foreach ($redis->zrange($key, 0, -1) as $id) {
            $redis->del('sess:meta:'.$id, 'sess:revoked:'.$id);
        }

        $redis->del($key);
    }
});

describe('the enrolment every owner and admin has to complete', function (): void {
    it('sends an owner without a confirmed second factor from the admin area to the page', function (): void {
        $owner = User::factory()->owner()->withoutTwoFactor()->create();

        $this->actingAs($owner)->get(route('admin.dashboard'))->assertRedirectToRoute('admin.security.two-factor');
    });

    it('lets the page itself, and what it needs, through', function (): void {
        $owner = User::factory()->owner()->withoutTwoFactor()->create();

        $this->actingAs($owner)->get(route('admin.security.two-factor'))->assertOk();
        expect(route('admin.security.two-factor', absolute: false))->toBe('/admin/account/two-factor');
    });

    it('renders Admin/Account/TwoFactor with what the page needs, and the banner flag while it is enforced', function (): void {
        $owner = User::factory()->owner()->withoutTwoFactor()->create();

        $this->actingAs($owner)->get(route('admin.security.two-factor'))
            ->assertInertia(fn (Assert $page) => $page
                ->component('Admin/Account/TwoFactor')
                ->where('enabled', false)
                ->where('confirmed', false)
                ->where('required', true)
                ->where('enforced', true));
    });

    it('says the setup is under way once the secret exists and not confirmed', function (): void {
        $owner = User::factory()->admin()->withoutTwoFactor()->create();
        $owner->forceFill(['two_factor_secret' => encrypt(TWO_FACTOR_TEST_SECRET), 'two_factor_recovery_codes' => encrypt('[]')])->save();

        $this->actingAs($owner)->get(route('admin.security.two-factor'))
            ->assertInertia(fn (Assert $page) => $page->where('enabled', true)->where('confirmed', false)->where('required', true)->where('enforced', true));
    });

    it('is not enforced for a role that does not need it, or once confirmed', function (): void {
        $this->actingAs(User::factory()->estimator()->withoutTwoFactor()->create())->get(route('admin.security.two-factor'))
            ->assertInertia(fn (Assert $page) => $page->where('enabled', false)->where('confirmed', false)->where('required', false)->where('enforced', false));

        $this->actingAs(User::factory()->owner()->create())->get(route('admin.security.two-factor'))
            ->assertInertia(fn (Assert $page) => $page->where('enabled', true)->where('confirmed', true)->where('required', true)->where('enforced', false));
    });

    it('is for staff only', function (): void {
        $this->actingAs(User::factory()->create())->get(route('admin.security.two-factor'))->assertForbidden();
    });

    it('is for signed-in visitors only', function (): void {
        $this->get(route('admin.security.two-factor'))->assertRedirectToRoute('login');
    });

    it('opens the admin area once a valid code confirms the secret', function (): void {
        $owner = User::factory()->owner()->withoutTwoFactor()->create();

        ($this->as)($owner)->postJson(route('two-factor.enable'))->assertOk();

        $owner->refresh();
        expect($owner->two_factor_secret)->not->toBeNull()
            ->and($owner->two_factor_confirmed_at)->toBeNull();
        $this->get(route('admin.dashboard'))->assertRedirectToRoute('admin.security.two-factor');

        $secret = decrypt($owner->two_factor_secret);

        $this->postJson(route('two-factor.confirm'), ['code' => currentCode($secret)])->assertOk();

        expect($owner->refresh()->two_factor_confirmed_at)->not->toBeNull();
        $this->get(route('admin.dashboard'))->assertOk();
    });

    it('does not confirm with a wrong code, and the admin area stays shut', function (): void {
        $owner = User::factory()->admin()->withoutTwoFactor()->create();

        ($this->as)($owner)->postJson(route('two-factor.enable'))->assertOk();
        $this->postJson(route('two-factor.confirm'), ['code' => '000000'])->assertUnprocessable();

        expect($owner->refresh()->two_factor_confirmed_at)->toBeNull();
        $this->get(route('admin.dashboard'))->assertRedirectToRoute('admin.security.two-factor');
    });

    it('shows the QR code, the setup key and the eight recovery codes of the setup', function (): void {
        $owner = User::factory()->owner()->withoutTwoFactor()->create();

        ($this->as)($owner)->postJson(route('two-factor.enable'))->assertOk();
        $secret = decrypt($owner->refresh()->two_factor_secret);

        $this->getJson(route('two-factor.qr-code'))->assertOk()
            ->assertJsonStructure(['svg', 'url'])
            ->assertJsonPath('url', fn (string $url): bool => str_contains($url, $secret));
        $this->getJson(route('two-factor.secret-key'))->assertOk()->assertJsonPath('secretKey', $secret);
        expect($this->getJson(route('two-factor.recovery-codes'))->assertOk()->json())->toHaveCount(8);
    });

    it('asks for the password first: the Fortify routes are behind password.confirm', function (): void {
        $owner = User::factory()->owner()->withoutTwoFactor()->create();

        $this->actingAs($owner)->withSession(['auth.login_at' => now()->getTimestamp()])->post(route('two-factor.enable'))
            ->assertRedirectToRoute('password.confirm');
        $this->postJson(route('two-factor.enable'))->assertStatus(423);

        expect($owner->refresh()->two_factor_secret)->toBeNull();
    });

    it('brings the person back to the page once the password is confirmed', function (): void {
        $owner = User::factory()->owner()->withoutTwoFactor()->create();

        $this->actingAs($owner)->withSession(['auth.login_at' => now()->getTimestamp()])
            ->from(route('admin.security.two-factor'))
            ->post(route('two-factor.enable'))
            ->assertRedirectToRoute('password.confirm');

        $this->post(route('password.confirm.store'), ['password' => 'password'])
            ->assertRedirect(route('admin.security.two-factor'));
    });

    it('answers a wrong code of a page visit in the error bag Fortify names', function (): void {
        $owner = User::factory()->owner()->withoutTwoFactor()->create();

        ($this->as)($owner)->postJson(route('two-factor.enable'))->assertOk();

        $this->post(route('two-factor.confirm'), ['code' => '000000'], InertiaRequest::headers())
            ->assertRedirect()
            ->assertSessionHasErrorsIn('confirmTwoFactorAuthentication', ['code']);
    });

    it('regenerates the recovery codes, also for owners and admins', function (string $role): void {
        $user = User::factory()->{$role}()->create();
        $before = json_decode(decrypt($user->two_factor_recovery_codes), true);

        ($this->as)($user)->postJson(route('two-factor.regenerate-recovery-codes'))->assertOk();

        $after = json_decode(decrypt($user->refresh()->two_factor_recovery_codes), true);
        expect($after)->toHaveCount(8)->and($after)->not->toBe($before);
    })->with(['owner', 'admin']);
});

describe('disabling (PreventRequiredTwoFactorDisable)', function (): void {
    it('is refused for an owner or an admin with 403 and the reason', function (string $role): void {
        $user = User::factory()->{$role}()->create();

        ($this->as)($user)->deleteJson(route('two-factor.disable'))
            ->assertForbidden()
            ->assertJsonPath('message', trans('auth.errors.2fa_required'));

        expect($user->refresh()->two_factor_secret)->not->toBeNull()
            ->and($user->two_factor_confirmed_at)->not->toBeNull()
            ->and(Activity::query()->where('event', 'auth.2fa_disabled')->count())->toBe(0);
    })->with(['owner', 'admin']);

    it('is refused on the page of an owner too, whatever the client', function (): void {
        $owner = User::factory()->owner()->create();

        ($this->as)($owner)->delete(route('two-factor.disable'))->assertForbidden();
        expect($owner->refresh()->two_factor_confirmed_at)->not->toBeNull();
    });

    it('is refused for an owner who is not enrolled yet either', function (): void {
        $owner = User::factory()->owner()->withoutTwoFactor()->create();

        ($this->as)($owner)->deleteJson(route('two-factor.disable'))->assertForbidden();
    });

    it('is allowed for a role that does not need it, and audited', function (string $role): void {
        $user = User::factory()->{$role}()->withTwoFactor()->create();

        ($this->as)($user)->deleteJson(route('two-factor.disable'))->assertOk();

        $user->refresh();
        expect($user->two_factor_secret)->toBeNull()
            ->and($user->two_factor_confirmed_at)->toBeNull();

        $audit = Activity::query()->where('event', 'auth.2fa_disabled')->sole();
        expect($audit->log_name)->toBe('security')
            ->and($audit->subject_id)->toBe($user->id)
            ->and($audit->causer_id)->toBe($user->id);
    })->with(['estimator', 'production', 'support']);

    it('applies at once when a role change makes the second factor required', function (): void {
        $user = User::factory()->estimator()->withTwoFactor()->create();
        $user->syncRoles('admin');

        ($this->as)($user->fresh())->deleteJson(route('two-factor.disable'))->assertForbidden();
    });
});

describe('customers (PreventCustomerTwoFactor)', function (): void {
    it('get 403 on every two-factor route, before the password is asked for', function (string $method, string $route): void {
        $customer = User::factory()->create();

        $this->actingAs($customer)->json($method, route($route))->assertForbidden();
        // With the password confirmed, too.
        ($this->as)($customer)->json($method, route($route))->assertForbidden();

        expect($customer->refresh()->two_factor_secret)->toBeNull();
    })->with([
        'enable' => ['POST', 'two-factor.enable'],
        'confirm' => ['POST', 'two-factor.confirm'],
        'disable' => ['DELETE', 'two-factor.disable'],
        'qr code' => ['GET', 'two-factor.qr-code'],
        'secret key' => ['GET', 'two-factor.secret-key'],
        'recovery codes' => ['GET', 'two-factor.recovery-codes'],
        'regenerate' => ['POST', 'two-factor.regenerate-recovery-codes'],
    ]);

    it('leaves a visitor who is not signed in to the login page: the challenge needs a half-finished login', function (): void {
        $this->get(route('two-factor.login'))->assertRedirectToRoute('login');
    });

    it('does not stand in the way of staff', function (): void {
        ($this->as)(User::factory()->estimator()->create())->postJson(route('two-factor.enable'))->assertOk();
    });
});

describe('both middleware are part of the web group', function (): void {
    it('are in the web group, not on routes one by one', function (): void {
        $groups = app('router')->getMiddlewareGroups();

        expect($groups['web'])
            ->toContain(PreventRequiredTwoFactorDisable::class)
            ->toContain(PreventCustomerTwoFactor::class);
    });
});

describe('the challenge at sign-in', function (): void {
    beforeEach(function (): void {
        $this->owner = User::factory()->owner()->create(['email' => 'owner@x.test']);
        $this->owner->forceFill([
            'two_factor_recovery_codes' => encrypt(json_encode(['aaaaaaaaaa-bbbbbbbbbb', 'cccccccccc-dddddddddd'])),
        ])->save();
        $this->signIn = fn () => $this->post(route('login.store'), ['email' => 'owner@x.test', 'password' => 'password']);
    });

    it('sends staff with a confirmed second factor to the challenge, not into the app', function (): void {
        ($this->signIn)()->assertRedirectToRoute('two-factor.login');

        $this->assertGuest();
        $this->get(route('two-factor.login'))->assertOk()->assertInertia(fn (Assert $page) => $page->component('Auth/TwoFactorChallenge'));
    });

    it('lets a recovery code in once', function (): void {
        ($this->signIn)();
        $this->post(route('two-factor.login.store'), ['recovery_code' => 'aaaaaaaaaa-bbbbbbbbbb'])->assertRedirectToRoute('admin.dashboard');

        $this->assertAuthenticatedAs($this->owner);

        $this->post(route('logout'));
        $this->assertGuest();

        ($this->signIn)()->assertRedirectToRoute('two-factor.login');
        $this->post(route('two-factor.login.store'), ['recovery_code' => 'aaaaaaaaaa-bbbbbbbbbb'])
            ->assertRedirect()
            ->assertSessionHasErrors('recovery_code');

        $this->assertGuest();
        // The other one is untouched.
        $this->post(route('two-factor.login.store'), ['recovery_code' => 'cccccccccc-dddddddddd'])->assertRedirectToRoute('admin.dashboard');
    });

    it('audits the recovery code that was used, and not its value', function (): void {
        ($this->signIn)();
        $this->post(route('two-factor.login.store'), ['recovery_code' => 'aaaaaaaaaa-bbbbbbbbbb']);

        $audit = Activity::query()->where('event', 'auth.recovery_code_used')->sole();

        expect($audit->log_name)->toBe('security')
            ->and($audit->subject_id)->toBe($this->owner->id)
            ->and($audit->causer_id)->toBe($this->owner->id)
            ->and(json_encode($audit->properties))->not->toContain('aaaaaaaaaa');
    });

    it('lets a code from the authenticator in, as the password login it started as', function (): void {
        ($this->signIn)();
        $this->post(route('two-factor.login.store'), ['code' => currentCode()])->assertRedirectToRoute('admin.dashboard');

        $this->assertAuthenticatedAs($this->owner);

        $login = Activity::query()->where('event', 'auth.login')->sole();
        expect($login->properties['method'])->toBe('password')
            ->and(session('auth.method'))->toBe('password')
            ->and(session('auth.remember'))->toBeFalse()
            ->and(session('auth.login_at'))->toBeInt();
    });

    it('turns a wrong code away and says so on the code field', function (): void {
        ($this->signIn)();
        $this->post(route('two-factor.login.store'), ['code' => '000000'])->assertRedirect()->assertSessionHasErrors('code');

        $this->assertGuest();
        expect(Activity::query()->where('event', 'auth.login')->count())->toBe(0);
    });

    it('keeps the remember cookie from staff whatever they asked for', function (): void {
        $this->post(route('login.store'), ['email' => 'owner@x.test', 'password' => 'password', 'remember' => 'on']);
        $response = $this->post(route('two-factor.login.store'), ['recovery_code' => 'aaaaaaaaaa-bbbbbbbbbb']);

        $recaller = collect($response->headers->getCookies())->first(fn ($cookie): bool => str_starts_with($cookie->getName(), 'remember_web'));
        expect($recaller)->toBeNull();
    });

    it('allows five tries a minute and answers the sixth with 429', function (): void {
        ($this->signIn)();

        foreach (range(1, 5) as $_) {
            $this->postJson(route('two-factor.login.store'), ['code' => '000000'])->assertUnprocessable();
        }

        $this->postJson(route('two-factor.login.store'), ['code' => currentCode()])
            ->assertTooManyRequests()
            ->assertJsonPath('code', 'rate_limited');
        $this->assertGuest();
    });

    it('sends the wait back to the challenge page as the rate_limited error, to count down there', function (): void {
        expect(RateLimitedResponse::INLINE_ROUTES)->toContain('two-factor.login.store');

        ($this->signIn)();

        foreach (range(1, 5) as $_) {
            $this->post(route('two-factor.login.store'), ['code' => '000000']);
        }

        $this->from(route('two-factor.login'))
            ->post(route('two-factor.login.store'), ['code' => '000000'], InertiaRequest::headers())
            ->assertRedirect(route('two-factor.login'))
            ->assertSessionHasErrors('rate_limited');
    });
});

describe('the audit of the second factor (13 section 17)', function (): void {
    it('records auth.2fa_enabled when the secret is confirmed, with the user as subject and causer', function (): void {
        $owner = User::factory()->owner()->withoutTwoFactor()->create();

        ($this->as)($owner)->postJson(route('two-factor.enable'))->assertOk();

        // Starting the setup is not yet being enabled.
        expect(Activity::query()->where('event', 'auth.2fa_enabled')->count())->toBe(0);

        $this->postJson(route('two-factor.confirm'), ['code' => currentCode(decrypt($owner->refresh()->two_factor_secret))])->assertOk();

        $audit = Activity::query()->where('event', 'auth.2fa_enabled')->sole();
        expect($audit->log_name)->toBe('security')
            ->and($audit->subject_id)->toBe($owner->id)
            ->and($audit->causer_id)->toBe($owner->id)
            ->and($audit->properties->all())->toBe([]);
    });

    it('records nothing for a code that did not confirm', function (): void {
        $owner = User::factory()->owner()->withoutTwoFactor()->create();

        ($this->as)($owner)->postJson(route('two-factor.enable'));
        $this->postJson(route('two-factor.confirm'), ['code' => '000000']);

        expect(Activity::query()->where('event', 'auth.2fa_enabled')->count())->toBe(0);
    });
});

describe('furny:reset-two-factor (13 section 5.10, break-glass)', function (): void {
    it('clears the columns of the sole owner, signs them out and audits it as the console', function (): void {
        $owner = User::factory()->owner()->create(['email' => 'owner@x.test']);
        $id = Str::random(40);
        Session::getHandler()->write($id, '[]');
        app(SessionRegistry::class)->register($owner, $id, request(), 'password', false);

        $this->artisan('furny:reset-two-factor', ['email' => 'owner@x.test'])->assertSuccessful();

        $owner->refresh();
        expect($owner->two_factor_secret)->toBeNull()
            ->and($owner->two_factor_recovery_codes)->toBeNull()
            ->and($owner->two_factor_confirmed_at)->toBeNull()
            ->and(Session::getHandler()->read($id))->toBe('');

        $reset = Activity::query()->where('event', 'auth.2fa_reset')->sole();
        expect($reset->log_name)->toBe('security')
            ->and($reset->subject_id)->toBe($owner->id)
            ->and($reset->causer_id)->toBeNull()
            ->and($reset->properties->all())->toBe(['via' => 'console']);

        $this->actingAs($owner->fresh())->get(route('admin.dashboard'))->assertRedirectToRoute('admin.security.two-factor');
    });

    it('finds the address however it is written', function (): void {
        $owner = User::factory()->owner()->create(['email' => 'owner@x.test']);

        $this->artisan('furny:reset-two-factor', ['email' => '  Owner@X.test '])->assertSuccessful();

        expect($owner->refresh()->two_factor_confirmed_at)->toBeNull();
    });

    it('fails for an address nobody has, and changes nothing', function (): void {
        $this->artisan('furny:reset-two-factor', ['email' => 'nobody@x.test'])->assertFailed();

        expect(Activity::query()->where('event', 'auth.2fa_reset')->count())->toBe(0);
    });

    it('fails for a customer: they have no second factor to reset', function (): void {
        $customer = User::factory()->create(['email' => 'asha@x.test']);

        $this->artisan('furny:reset-two-factor', ['email' => 'asha@x.test'])->assertFailed();

        expect(Activity::query()->where('event', 'auth.2fa_reset')->count())->toBe(0)
            ->and($customer->refresh()->is_active)->toBeTrue();
    });

    it('resets a deactivated owner too: the lock-out may be why they are in trouble', function (): void {
        $owner = User::factory()->owner()->inactive()->create(['email' => 'gone@x.test']);

        $this->artisan('furny:reset-two-factor', ['email' => 'gone@x.test'])->assertSuccessful();

        expect($owner->refresh()->two_factor_confirmed_at)->toBeNull();
    });
});
