<?php

declare(strict_types=1);

use App\Domain\Identity\Enums\StaffRole;
use App\Domain\Identity\Events\ContactVerified;
use App\Domain\Identity\Models\StaffInvitation;
use App\Domain\Identity\Models\User;
use App\Support\Settings\Settings;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Facades\URL;
use Inertia\Testing\AssertableInertia as Assert;
use Spatie\Activitylog\Models\Activity;

beforeEach(function (): void {
    $this->freezeSecond();
    $this->invitation = StaffInvitation::factory()->role(StaffRole::Estimator)->create(['email' => 'nina@example.com', 'name' => 'Nina Hire']);
    $this->linkTo = fn (StaffInvitation $invitation): string => URL::temporarySignedRoute('staff.invitations.show', $invitation->expires_at, ['invitation' => $invitation->id]);
    $this->link = ($this->linkTo)($this->invitation);
    $this->payload = ['name' => 'Nina Hire', 'password' => 'a-long-secret-1', 'password_confirmation' => 'a-long-secret-1'];
    $this->accept = fn (array $overrides = [], ?string $link = null) => $this->post($link ?? $this->link, [...$this->payload, ...$overrides]);
});

afterEach(function (): void {
    $redis = Redis::connection('sessions');

    foreach (User::query()->where('type', 'staff')->get() as $user) {
        $key = 'sess:user:'.$user->getKey();

        foreach ($redis->zrange($key, 0, -1) as $id) {
            $redis->del('sess:meta:'.$id, 'sess:revoked:'.$id);
        }

        $redis->del($key);
    }
});

describe('opening the link (13 section 5.9 step 3, 20.8)', function (): void {
    it('shows the form for a valid link', function (): void {
        $this->get($this->link)
            ->assertOk()
            ->assertInertia(fn (Assert $page) => $page
                ->component('Auth/AcceptInvitation')
                ->where('invitation.email', 'nina@example.com')
                ->where('invitation.name', 'Nina Hire')
                ->where('invitation.roleLabel', trans_icu('roles.names.estimator'))
                ->where('invitation.expiresAt', $this->invitation->expires_at->toIso8601String())
                ->where('googleEnabled', true)
                ->where('prefillName', null)
                ->where('googleConnected', false)
                ->has('passwordRules'));
    });

    it('keeps the invitation and its link in the session for the Google option', function (): void {
        $this->get($this->link)->assertOk()
            ->assertSessionHas('invitation.id', $this->invitation->id)
            ->assertSessionHas('invitation.url', $this->link);
    });

    it('prefills the name with the one Google gave, when the invitee chose Google', function (): void {
        $this->withSession(['invitation.google.'.$this->invitation->id => ['id' => 'g-1', 'name' => 'Nina Google']])
            ->get($this->link)
            ->assertInertia(fn (Assert $page) => $page->where('prefillName', 'Nina Google')->where('googleConnected', true));
    });

    it('ignores the Google choice made for another invitation', function (): void {
        $this->withSession(['invitation.google.01JZZZZZZZZZZZZZZZZZZZZZZZ' => ['id' => 'g-1', 'name' => 'Somebody Else']])
            ->get($this->link)
            ->assertInertia(fn (Assert $page) => $page->where('prefillName', null)->where('googleConnected', false));
    });

    it('does not offer Google while the feature is off', function (): void {
        config(['features.google_login' => false]);

        $this->get($this->link)->assertInertia(fn (Assert $page) => $page->where('googleEnabled', false));
    });

    it('says invalid for a link whose signature was tampered with', function (): void {
        $this->get(substr($this->link, 0, -1).(str_ends_with($this->link, 'a') ? 'b' : 'a'))
            ->assertOk()
            ->assertInertia(fn (Assert $page) => $page->component('Auth/InvitationInvalid')->where('reason', 'invalid'));

        $this->get($this->link.'&extra=1')
            ->assertInertia(fn (Assert $page) => $page->component('Auth/InvitationInvalid')->where('reason', 'invalid'));
    });

    it('says invalid for a link without a signature', function (): void {
        $this->get(route('staff.invitations.show', $this->invitation))
            ->assertInertia(fn (Assert $page) => $page->component('Auth/InvitationInvalid')->where('reason', 'invalid'));
    });

    it('says invalid for a link to an invitation that does not exist', function (): void {
        $link = URL::temporarySignedRoute('staff.invitations.show', now()->addHours(72), ['invitation' => '01JZZZZZZZZZZZZZZZZZZZZZZZ']);

        $this->get($link)->assertOk()->assertInertia(fn (Assert $page) => $page->component('Auth/InvitationInvalid')->where('reason', 'invalid'));
    });

    it('is a 404 for an id that cannot be one (14 section 1.6), before any lookup', function (): void {
        $this->get('/staff/invitations/not-an-id')->assertNotFound();
    });

    it('says expired after 73 hours', function (): void {
        $this->travel(73)->hours();

        $this->get($this->link)->assertInertia(fn (Assert $page) => $page->component('Auth/InvitationInvalid')->where('reason', 'expired'));
    });

    it('says expired when the invitation ran out but the link would still be good', function (): void {
        $expired = StaffInvitation::factory()->expired()->create();
        $link = URL::temporarySignedRoute('staff.invitations.show', now()->addHours(72), ['invitation' => $expired->id]);

        $this->get($link)->assertInertia(fn (Assert $page) => $page->component('Auth/InvitationInvalid')->where('reason', 'expired'));
    });

    it('says revoked', function (): void {
        $this->invitation->forceFill(['revoked_at' => now()])->save();

        $this->get($this->link)->assertInertia(fn (Assert $page) => $page->component('Auth/InvitationInvalid')->where('reason', 'revoked'));
    });

    it('says accepted', function (): void {
        $this->invitation->forceFill(['accepted_at' => now()])->save();

        $this->get($this->link)->assertInertia(fn (Assert $page) => $page->component('Auth/InvitationInvalid')->where('reason', 'accepted'));
    });

    it('asks somebody who is signed in to sign out first', function (string $type): void {
        $user = $type === 'staff' ? User::factory()->support()->create() : User::factory()->create();

        $this->actingAs($user)->get($this->link)
            ->assertOk()
            ->assertInertia(fn (Assert $page) => $page->component('Auth/InvitationInvalid')->where('reason', 'signed_in'));
    })->with(['staff', 'customer']);

    it('does not put the invitation in the session when it shows no form', function (): void {
        $this->invitation->forceFill(['revoked_at' => now()])->save();

        $this->get($this->link)->assertSessionMissing('invitation.id');
    });

    it('is reachable by everybody: no login, no sign-in redirect', function (): void {
        $this->get($this->link)->assertOk();
        expect(Auth::check())->toBeFalse();
    });
});

describe('accepting (13 section 5.9 step 5)', function (): void {
    it('creates the staff member, signs them in without remember and sends them to the admin area', function (): void {
        Event::fake([ContactVerified::class]);

        $response = ($this->accept)()->assertRedirect(route('admin.dashboard'));

        $user = User::query()->where('email', 'nina@example.com')->sole();

        expect($user->isStaff())->toBeTrue()
            ->and($user->name)->toBe('Nina Hire')
            ->and($user->hasRole('estimator'))->toBeTrue()
            ->and($user->roles->pluck('name')->all())->toBe(['estimator'])
            ->and($user->is_active)->toBeTrue()
            ->and($user->email_verified_at?->equalTo(now()))->toBeTrue()
            ->and($user->first_contact_verified_at)->not->toBeNull()
            ->and($user->terms_accepted_at?->equalTo(now()))->toBeTrue()
            ->and($user->timezone)->toBe('Asia/Kolkata')
            ->and($user->google_id)->toBeNull()
            ->and($user->password)->not->toBe('a-long-secret-1')
            ->and(password_verify('a-long-secret-1', (string) $user->password))->toBeTrue();

        $this->assertAuthenticatedAs($user);
        $response->assertCookieMissing(Auth::guard()->getRecallerName());
        Event::assertDispatchedTimes(ContactVerified::class, 1);
        Event::assertDispatched(ContactVerified::class, fn (ContactVerified $event): bool => $event->user->is($user));

        expect($this->invitation->refresh()->accepted_at?->equalTo(now()))->toBeTrue()
            ->and($this->invitation->user_id)->toBe($user->id);
    });

    it('gives the new member the business defaults for time zone and units, as a customer gets them', function (): void {
        ($this->accept)()->assertRedirect();

        $user = User::query()->where('email', 'nina@example.com')->sole();
        $business = app(Settings::class)->business();
        $units = app(Settings::class)->units();

        expect($user->timezone)->toBe($business->timezone)
            ->and($user->unit_system->value)->toBe($units->defaultSystem)
            ->and($user->length_unit->value)->toBe($units->defaultLengthUnit)
            ->and($user->locale)->toBe((string) config('app.locale'));
    });

    it('records the sign-in as a password login and starts the staff session clock', function (): void {
        ($this->accept)();

        $user = User::query()->where('email', 'nina@example.com')->sole();
        $login = Activity::query()->where('event', 'auth.login')->sole();

        expect($login->causer_id)->toBe($user->id)
            ->and($login->properties['method'])->toBe('password')
            ->and(session('auth.login_at'))->toBe(now()->getTimestamp())
            ->and($user->last_login_at)->not->toBeNull();
    });

    it('audits staff.invitation_accepted on the invitation, with the new member as the causer', function (): void {
        ($this->accept)();

        $user = User::query()->where('email', 'nina@example.com')->sole();
        $activity = Activity::query()->where('event', 'staff.invitation_accepted')->sole();

        expect($activity->log_name)->toBe('staff')
            ->and($activity->subject_id)->toBe($this->invitation->id)
            ->and($activity->causer_id)->toBe($user->id)
            ->and($activity->properties->all())->toBe(['email' => 'n**a@e******.com', 'role' => 'estimator']);
    });

    it('takes the name from the form, not from the invitation', function (): void {
        ($this->accept)(['name' => 'Nina H. Hire'])->assertRedirect();

        expect(User::query()->where('email', 'nina@example.com')->sole()->name)->toBe('Nina H. Hire');
    });

    it('gives every role it was invited as', function (StaffRole $role): void {
        $invitation = StaffInvitation::factory()->role($role)->create(['email' => $role->value.'@example.com']);

        ($this->accept)([], ($this->linkTo)($invitation))->assertRedirect(route('admin.dashboard'));

        $user = User::query()->where('email', $role->value.'@example.com')->sole();
        expect($user->roles->pluck('name')->all())->toBe([$role->value]);
    })->with(StaffRole::cases());

    it('clears the invitation from the session', function (): void {
        $this->withSession(['invitation.id' => $this->invitation->id, 'invitation.url' => $this->link, 'invitation.google.'.$this->invitation->id => ['id' => 'g-1', 'name' => 'Nina Google']]);

        ($this->accept)()->assertRedirect()
            ->assertSessionMissing('invitation.id')
            ->assertSessionMissing('invitation.url')
            ->assertSessionMissing('invitation.google');
    });

    it('regenerates the session id on sign-in', function (): void {
        $this->get($this->link);
        $before = session()->getId();

        ($this->accept)();

        expect(session()->getId())->not->toBe($before);
    });

    describe('with the Google account the invitee chose', function (): void {
        beforeEach(function (): void {
            $this->google = ['invitation.google.'.$this->invitation->id => ['id' => 'google-616', 'name' => 'Nina Google']];
        });

        it('links it and records the sign-in as Google', function (): void {
            $this->withSession($this->google);

            ($this->accept)()->assertRedirect(route('admin.dashboard'));

            $user = User::query()->where('email', 'nina@example.com')->sole();

            expect($user->google_id)->toBe('google-616')
                ->and(Activity::query()->where('event', 'auth.login')->sole()->properties['method'])->toBe('google');
        });

        it('still needs a password', function (): void {
            $this->withSession($this->google);

            ($this->accept)(['password' => '', 'password_confirmation' => ''])->assertSessionHasErrors('password');

            expect(User::query()->where('email', 'nina@example.com')->exists())->toBeFalse();
        });

        it('leaves Google out when another account has it', function (): void {
            User::factory()->create(['google_id' => 'google-616']);
            $this->withSession($this->google);

            ($this->accept)()->assertRedirect(route('admin.dashboard'));

            expect(User::query()->where('email', 'nina@example.com')->sole()->google_id)->toBeNull();
        });

        it('leaves Google out when an account in the deletion period has it', function (): void {
            User::factory()->pendingDeletion()->create(['google_id' => 'google-616']);
            $this->withSession($this->google);

            ($this->accept)()->assertRedirect(route('admin.dashboard'));

            expect(User::query()->where('email', 'nina@example.com')->sole()->google_id)->toBeNull();
        });

        it('ignores a Google choice made for another invitation', function (): void {
            $this->withSession(['invitation.google.01JZZZZZZZZZZZZZZZZZZZZZZZ' => ['id' => 'google-717', 'name' => 'Somebody Else']]);

            ($this->accept)()->assertRedirect();

            $user = User::query()->where('email', 'nina@example.com')->sole();
            expect($user->google_id)->toBeNull()
                ->and(Activity::query()->where('event', 'auth.login')->sole()->properties['method'])->toBe('password');
        });
    });

    describe('refusing the form', function (): void {
        it('needs a name of 2 to 120 characters', function (string $name): void {
            ($this->accept)(['name' => $name])->assertSessionHasErrors('name');

            expect(User::query()->where('email', 'nina@example.com')->exists())->toBeFalse();
        })->with(['', 'N', 'overlong' => str_repeat('n', 121)]);

        it('needs the password to follow the defaults and be confirmed', function (array $payload): void {
            ($this->accept)($payload)->assertSessionHasErrors('password');

            expect(User::query()->where('email', 'nina@example.com')->exists())->toBeFalse();
            $this->assertGuest();
        })->with([
            'too short' => [['password' => 'short', 'password_confirmation' => 'short']],
            'not confirmed' => [['password_confirmation' => 'something-else-1']],
            'empty' => [['password' => '', 'password_confirmation' => '']],
        ]);

        it('does not flash the password back', function (): void {
            ($this->accept)(['password_confirmation' => 'something-else-1'])->assertSessionHasErrors('password');

            expect(session()->getOldInput())->not->toHaveKey('password')->not->toHaveKey('password_confirmation');
        });

        it('keeps the invitation open after a refused form', function (): void {
            ($this->accept)(['name' => ''])->assertSessionHasErrors('name');

            expect($this->invitation->refresh()->accepted_at)->toBeNull();
            ($this->accept)()->assertRedirect(route('admin.dashboard'));
        });
    });

    describe('refusing the link', function (): void {
        it('refuses a tampered signature and creates nobody', function (): void {
            ($this->accept)([], substr($this->link, 0, -1).(str_ends_with($this->link, 'a') ? 'b' : 'a'))
                ->assertInertia(fn (Assert $page) => $page->component('Auth/InvitationInvalid')->where('reason', 'invalid'));

            expect(User::query()->where('email', 'nina@example.com')->exists())->toBeFalse();
            $this->assertGuest();
        });

        it('refuses a link that ran out', function (): void {
            $this->travel(73)->hours();

            ($this->accept)()->assertInertia(fn (Assert $page) => $page->component('Auth/InvitationInvalid')->where('reason', 'expired'));

            expect(User::query()->where('email', 'nina@example.com')->exists())->toBeFalse();
        });

        it('refuses an invitation that expired in the meantime although the link is good', function (): void {
            $this->invitation->forceFill(['expires_at' => now()->subMinute()])->save();

            ($this->accept)()->assertInertia(fn (Assert $page) => $page->component('Auth/InvitationInvalid')->where('reason', 'expired'));

            expect(User::query()->where('email', 'nina@example.com')->exists())->toBeFalse();
        });

        it('refuses an invitation that was revoked after the form was opened', function (): void {
            $this->get($this->link)->assertOk();
            $this->invitation->forceFill(['revoked_at' => now()])->save();

            ($this->accept)()->assertInertia(fn (Assert $page) => $page->component('Auth/InvitationInvalid')->where('reason', 'revoked'));

            expect(User::query()->where('email', 'nina@example.com')->exists())->toBeFalse();
            $this->assertGuest();
        });

        it('refuses somebody who is signed in', function (): void {
            $this->actingAs(User::factory()->support()->create());

            ($this->accept)()->assertInertia(fn (Assert $page) => $page->component('Auth/InvitationInvalid')->where('reason', 'signed_in'));

            expect(User::query()->where('email', 'nina@example.com')->exists())->toBeFalse()
                ->and($this->invitation->refresh()->accepted_at)->toBeNull();
        });

        it('refuses an address that has an account by now, soft-deleted or not', function (bool $deleted): void {
            $factory = $deleted ? User::factory()->pendingDeletion() : User::factory();
            $factory->create(['email' => 'nina@example.com']);

            ($this->accept)()
                ->assertSessionHasErrors(['email' => trans_icu('staff.errors.email_in_use'), 'code' => 'staff.email_in_use']);

            expect(User::withTrashed()->where('email', 'nina@example.com')->count())->toBe(1)
                ->and($this->invitation->refresh()->accepted_at)->toBeNull();
            $this->assertGuest();
        })->with([false, true]);
    });

    describe('using the link twice (Review Focus 5)', function (): void {
        it('refuses the same link from another browser: accepted, and still one user', function (): void {
            ($this->accept)()->assertRedirect(route('admin.dashboard'));
            $user = User::query()->where('email', 'nina@example.com')->sole();

            // Another browser: no session of the first one.
            Auth::forgetGuards();
            $this->flushSession();

            ($this->accept)(['name' => 'An Intruder', 'password' => 'intruder-secret-9', 'password_confirmation' => 'intruder-secret-9'])
                ->assertInertia(fn (Assert $page) => $page->component('Auth/InvitationInvalid')->where('reason', 'accepted'));

            $this->assertGuest();
            expect(User::query()->where('type', 'staff')->where('email', 'nina@example.com')->count())->toBe(1)
                ->and($user->refresh()->name)->toBe('Nina Hire')
                ->and(password_verify('a-long-secret-1', (string) $user->password))->toBeTrue()
                ->and(Activity::query()->where('event', 'staff.invitation_accepted')->count())->toBe(1);
        });

        it('refuses a double submit from the same browser', function (): void {
            ($this->accept)()->assertRedirect(route('admin.dashboard'));

            ($this->accept)()->assertInertia(fn (Assert $page) => $page->component('Auth/InvitationInvalid')->where('reason', 'signed_in'));

            expect(User::query()->where('email', 'nina@example.com')->count())->toBe(1);
        });

        it('shows accepted when the link is opened again', function (): void {
            ($this->accept)();
            Auth::forgetGuards();
            $this->flushSession();

            $this->get($this->link)->assertInertia(fn (Assert $page) => $page->component('Auth/InvitationInvalid')->where('reason', 'accepted'));
        });
    });
});
