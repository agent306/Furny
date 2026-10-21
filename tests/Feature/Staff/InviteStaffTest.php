<?php

declare(strict_types=1);

use App\Domain\Identity\Enums\StaffRole;
use App\Domain\Identity\Models\StaffInvitation;
use App\Domain\Identity\Models\User;
use App\Notifications\Staff\StaffInvited;
use Illuminate\Http\Request;
use Illuminate\Notifications\AnonymousNotifiable;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\URL;
use Spatie\Activitylog\Models\Activity;

beforeEach(function (): void {
    Notification::fake();
    $this->freezeSecond();
    $this->admin = User::factory()->admin()->create(['name' => 'Ada Admin']);
    // A day later the staff session would have run out (12 hours); the clock of the test does not mean to test that.
    $this->invite = fn (array $overrides = [], ?User $as = null) => $this->actingAs($as ?? $this->admin)->withSession(['auth.login_at' => now()->getTimestamp()])->postJson(route('admin.staff.invitations.store'), [
        'email' => 'New.Hire@Example.com',
        'name' => 'Nina Hire',
        'role' => 'estimator',
        ...$overrides,
    ]);
});

describe('inviting a staff member (13 section 5.9 step 1)', function (): void {
    it('stores the invitation with the address in lower case and 72 hours to accept', function (): void {
        ($this->invite)()->assertRedirect()->assertSessionHasNoErrors();

        $invitation = StaffInvitation::query()->sole();

        expect($invitation->email)->toBe('new.hire@example.com')
            ->and($invitation->name)->toBe('Nina Hire')
            ->and($invitation->role)->toBe(StaffRole::Estimator)
            ->and($invitation->invited_by)->toBe($this->admin->id)
            ->and($invitation->expires_at->equalTo(now()->addHours(72)))->toBeTrue()
            ->and($invitation->accepted_at)->toBeNull()
            ->and($invitation->revoked_at)->toBeNull();
    });

    it('mails the address on demand with a signed link that works until the invitation expires', function (): void {
        ($this->invite)();

        $invitation = StaffInvitation::query()->sole();

        Notification::assertSentOnDemand(StaffInvited::class, function (StaffInvited $notification, array $channels, AnonymousNotifiable $notifiable) use ($invitation): bool {
            $mail = $notification->toMail($notifiable);
            $url = $mail->actionUrl;

            expect($notifiable->routes['mail'])->toBe('new.hire@example.com')
                ->and($channels)->toBe(['mail'])
                ->and($mail)->toBeInstanceOf(MailMessage::class)
                ->and($url)->toStartWith(url('/staff/invitations/'.$invitation->id).'?')
                ->and(URL::hasValidSignature(Request::create($url)))->toBeTrue();

            parse_str((string) parse_url($url, PHP_URL_QUERY), $query);
            expect((int) $query['expires'])->toBe($invitation->expires_at->getTimestamp());

            // Dead as soon as the invitation is: the signature carries the same expiry.
            $this->travel(73)->hours();
            expect(URL::hasValidSignature(Request::create($url)))->toBeFalse();

            return true;
        });
    });

    it('says who invited, the role and the date in the mail', function (): void {
        ($this->invite)(['role' => 'production']);

        $invitation = StaffInvitation::query()->sole();
        $mail = (new StaffInvited($invitation))->toMail((new AnonymousNotifiable)->route('mail', $invitation->email));

        expect($mail->subject)->toBe(trans_icu('notifications.staff.invited.staff.title', ['appName' => config('app.name')]))
            ->and(implode(' ', $mail->introLines))->toContain('Ada Admin')
            ->and(implode(' ', $mail->introLines))->toContain(trans_icu('roles.names.production'))
            // The invitee has no time zone yet: the business's counts.
            ->and(implode(' ', $mail->introLines))->toContain($invitation->expires_at->setTimezone('Asia/Kolkata')->format('d M Y, H:i'));
    });

    it('audits staff.invited in the staff log with the address masked', function (): void {
        ($this->invite)();

        $invitation = StaffInvitation::query()->sole();
        $activity = Activity::query()->where('event', 'staff.invited')->sole();

        expect($activity->log_name)->toBe('staff')
            ->and($activity->subject_id)->toBe($invitation->id)
            ->and($activity->causer_id)->toBe($this->admin->id)
            ->and($activity->properties->all())->toBe(['email' => 'n******e@e******.com', 'role' => 'estimator'])
            ->and(json_encode($activity->properties))->not->toContain('new.hire');
    });

    it('flashes a confirmation on a page request', function (): void {
        $this->actingAs($this->admin)
            ->post(route('admin.staff.invitations.store'), ['email' => 'a.b@example.com', 'name' => 'Abe Bee', 'role' => 'support'])
            ->assertRedirect()
            ->assertInertiaFlash('success', trans_icu('staff.toasts.invited', ['email' => 'a.b@example.com']));
    });

    it('refuses an address that belongs to a customer', function (): void {
        User::factory()->create(['email' => 'new.hire@example.com']);

        ($this->invite)()
            ->assertUnprocessable()
            ->assertJsonPath('code', 'staff.email_in_use')
            ->assertJsonValidationErrors(['email' => trans_icu('staff.errors.email_in_use')]);

        expect(StaffInvitation::query()->count())->toBe(0);
        Notification::assertNothingSent();
    });

    it('refuses an address that belongs to a customer whose account was deleted', function (): void {
        User::factory()->pendingDeletion()->create(['email' => 'new.hire@example.com']);

        ($this->invite)()->assertUnprocessable()->assertJsonPath('code', 'staff.email_in_use');
    });

    it('refuses an address that belongs to a staff member, whatever the case', function (): void {
        User::factory()->support()->create(['email' => 'new.hire@example.com']);

        ($this->invite)(['email' => 'NEW.HIRE@example.com'])->assertUnprocessable()->assertJsonPath('code', 'staff.email_in_use');
    });

    it('answers a page request with the errors bag of 14 section 1.9', function (): void {
        User::factory()->create(['email' => 'new.hire@example.com']);

        $this->actingAs($this->admin)
            ->from(route('admin.staff.index'))
            ->post(route('admin.staff.invitations.store'), ['email' => 'new.hire@example.com', 'name' => 'Nina Hire', 'role' => 'estimator'])
            ->assertRedirect(route('admin.staff.index'))
            ->assertSessionHasErrors(['email' => trans_icu('staff.errors.email_in_use'), 'code' => 'staff.email_in_use']);
    });

    it('refuses a second invitation while one is pending', function (): void {
        ($this->invite)()->assertRedirect();

        ($this->invite)(['name' => 'Someone Else'])
            ->assertUnprocessable()
            ->assertJsonPath('code', 'staff.invitation_pending')
            ->assertJsonValidationErrors(['email' => trans_icu('staff.errors.invitation_pending')]);

        expect(StaffInvitation::query()->count())->toBe(1);
        Notification::assertSentOnDemandTimes(StaffInvited::class, 1);
    });

    it('treats an invitation that expired as pending no more: it is closed and a new one is sent', function (): void {
        $old = StaffInvitation::factory()->expired()->create(['email' => 'new.hire@example.com']);

        ($this->invite)()->assertRedirect();

        $new = StaffInvitation::query()->whereNull('revoked_at')->sole();

        expect($new->id)->not->toBe($old->id)
            ->and($old->refresh()->revoked_at)->not->toBeNull()
            ->and(StaffInvitation::query()->count())->toBe(2);
    });

    it('allows a new invitation after the earlier one was revoked', function (): void {
        StaffInvitation::factory()->revoked()->create(['email' => 'new.hire@example.com']);

        ($this->invite)()->assertRedirect();

        expect(StaffInvitation::query()->whereNull('revoked_at')->count())->toBe(1);
    });

    it('validates the fields', function (array $payload, string $field): void {
        ($this->invite)($payload)->assertUnprocessable()->assertJsonValidationErrors($field);
    })->with([
        'no email' => [['email' => ''], 'email'],
        'not an email' => [['email' => 'nina'], 'email'],
        'email too long' => [['email' => str_repeat('a', 250).'@example.com'], 'email'],
        'no name' => [['name' => ''], 'name'],
        'name too short' => [['name' => 'N'], 'name'],
        'name too long' => [['name' => str_repeat('n', 121)], 'name'],
        'no role' => [['role' => ''], 'role'],
        'unknown role' => [['role' => 'janitor'], 'role'],
    ]);
});

describe('who may invite (13 section 5.9, 7.3)', function (): void {
    it('lets an owner invite another owner', function (): void {
        ($this->invite)(['role' => 'owner'], User::factory()->owner()->create())->assertRedirect();

        expect(StaffInvitation::query()->sole()->role)->toBe(StaffRole::Owner);
    });

    it('does not let an admin invite an owner', function (): void {
        ($this->invite)(['role' => 'owner'])->assertForbidden();

        expect(StaffInvitation::query()->count())->toBe(0);
        Notification::assertNothingSent();
    });

    it('lets an admin invite every other role', function (string $role): void {
        ($this->invite)(['role' => $role, 'email' => $role.'@example.com'])->assertRedirect();

        expect(StaffInvitation::query()->sole()->role->value)->toBe($role);
    })->with(['admin', 'estimator', 'production', 'support']);

    it('does not let staff without staff.manage invite', function (string $role): void {
        ($this->invite)([], User::factory()->staff($role)->create())->assertForbidden();

        expect(StaffInvitation::query()->count())->toBe(0);
    })->with(['estimator', 'production', 'support']);

    it('does not let a customer invite', function (): void {
        ($this->invite)([], User::factory()->create())->assertForbidden();
    });

    it('does not let a guest invite', function (): void {
        $this->post(route('admin.staff.invitations.store'), ['email' => 'a@example.com', 'name' => 'Abe Bee', 'role' => 'support'])
            ->assertRedirect(route('login'));
    });
});

describe('the invitations limiter (13 section 10)', function (): void {
    it('allows 20 invitations a day and answers the 21st with 429', function (): void {
        foreach (range(1, 20) as $i) {
            ($this->invite)(['email' => "hire{$i}@example.com"])->assertRedirect();
        }

        ($this->invite)(['email' => 'hire21@example.com'])
            ->assertTooManyRequests()
            ->assertJsonPath('code', 'rate_limited')
            ->assertHeader('Retry-After');

        expect(StaffInvitation::query()->count())->toBe(20);

        // Counted per user and per day.
        ($this->invite)(['email' => 'hire22@example.com'], User::factory()->owner()->create())->assertRedirect();
        $this->travel(25)->hours();
        ($this->invite)(['email' => 'hire23@example.com'])->assertRedirect();
    });

    it('counts resends against the same limit', function (): void {
        $invitation = StaffInvitation::factory()->create(['invited_by' => $this->admin->id]);

        foreach (range(1, 19) as $i) {
            ($this->invite)(['email' => "hire{$i}@example.com"])->assertRedirect();
        }

        $this->actingAs($this->admin)->postJson(route('admin.staff.invitations.resend', $invitation))->assertRedirect();
        $this->actingAs($this->admin)->postJson(route('admin.staff.invitations.resend', $invitation))->assertTooManyRequests();
    });
});

describe('resending (13 section 5.9 step 2)', function (): void {
    it('extends the expiry to 72 hours from now and sends a new signed link', function (): void {
        $invitation = StaffInvitation::factory()->create(['email' => 'nina@example.com', 'invited_by' => $this->admin->id]);
        $this->travel(50)->hours();

        $this->actingAs($this->admin)->post(route('admin.staff.invitations.resend', $invitation))
            ->assertRedirect()
            ->assertInertiaFlash('success', trans_icu('staff.toasts.resent', ['email' => 'nina@example.com']));

        $invitation->refresh();

        expect($invitation->expires_at->equalTo(now()->addHours(72)))->toBeTrue()
            ->and(Activity::query()->where('event', 'staff.invitation_resent')->sole()->subject_id)->toBe($invitation->id);

        Notification::assertSentOnDemand(StaffInvited::class, function (StaffInvited $notification, array $channels, AnonymousNotifiable $notifiable) use ($invitation): bool {
            parse_str((string) parse_url((string) $notification->toMail($notifiable)->actionUrl, PHP_URL_QUERY), $query);

            return $notifiable->routes['mail'] === 'nina@example.com' && (int) $query['expires'] === $invitation->expires_at->getTimestamp();
        });
    });

    it('revives an invitation that expired', function (): void {
        $invitation = StaffInvitation::factory()->expired()->create();

        $this->actingAs($this->admin)->post(route('admin.staff.invitations.resend', $invitation))->assertRedirect();

        expect($invitation->refresh()->expires_at->equalTo(now()->addHours(72)))->toBeTrue();
    });

    it('does not resend one that was accepted or revoked', function (string $state): void {
        $invitation = StaffInvitation::factory()->{$state}()->create();

        $this->actingAs($this->admin)->postJson(route('admin.staff.invitations.resend', $invitation))
            ->assertUnprocessable()
            ->assertJsonPath('code', 'staff.invitation_closed');

        Notification::assertNothingSent();
    })->with(['accepted', 'revoked']);

    it('does not resend to an address that has an account by now', function (): void {
        $invitation = StaffInvitation::factory()->create(['email' => 'nina@example.com']);
        User::factory()->create(['email' => 'nina@example.com']);

        $this->actingAs($this->admin)->postJson(route('admin.staff.invitations.resend', $invitation))
            ->assertUnprocessable()
            ->assertJsonPath('code', 'staff.email_in_use');
    });

    it('does not let an admin resend an invitation to an owner', function (): void {
        $invitation = StaffInvitation::factory()->role(StaffRole::Owner)->create();

        $this->actingAs($this->admin)->postJson(route('admin.staff.invitations.resend', $invitation))->assertForbidden();
        $this->actingAs(User::factory()->owner()->create())->postJson(route('admin.staff.invitations.resend', $invitation))->assertRedirect();
    });

    it('does not let staff without staff.manage resend', function (): void {
        $invitation = StaffInvitation::factory()->create();

        $this->actingAs(User::factory()->estimator()->create())->postJson(route('admin.staff.invitations.resend', $invitation))->assertForbidden();
    });
});

describe('revoking (13 section 5.9 step 2)', function (): void {
    it('sets revoked_at, keeps the row and audits it', function (): void {
        $invitation = StaffInvitation::factory()->create(['email' => 'nina@example.com']);

        $this->actingAs($this->admin)->delete(route('admin.staff.invitations.revoke', $invitation))
            ->assertRedirect()
            ->assertInertiaFlash('success', trans_icu('staff.toasts.revoked', ['email' => 'nina@example.com']));

        $activity = Activity::query()->where('event', 'staff.invitation_revoked')->sole();

        expect($invitation->refresh()->revoked_at?->equalTo(now()))->toBeTrue()
            ->and($activity->log_name)->toBe('staff')
            ->and($activity->causer_id)->toBe($this->admin->id)
            ->and($activity->properties->all())->toBe(['email' => 'n**a@e******.com', 'role' => 'estimator']);
    });

    it('does not revoke one that was accepted or revoked already', function (string $state): void {
        $invitation = StaffInvitation::factory()->{$state}()->create();

        $this->actingAs($this->admin)->deleteJson(route('admin.staff.invitations.revoke', $invitation))
            ->assertUnprocessable()
            ->assertJsonPath('code', 'staff.invitation_closed');
    })->with(['accepted', 'revoked']);

    it('lets the address be invited again', function (): void {
        $invitation = StaffInvitation::factory()->create(['email' => 'new.hire@example.com']);

        $this->actingAs($this->admin)->delete(route('admin.staff.invitations.revoke', $invitation))->assertRedirect();
        ($this->invite)()->assertRedirect();

        expect(StaffInvitation::query()->count())->toBe(2);
    });

    it('does not let an admin revoke an invitation to an owner', function (): void {
        $invitation = StaffInvitation::factory()->role(StaffRole::Owner)->create();

        $this->actingAs($this->admin)->deleteJson(route('admin.staff.invitations.revoke', $invitation))->assertForbidden();
        expect($invitation->refresh()->revoked_at)->toBeNull();
    });

    it('does not let staff without staff.manage revoke', function (): void {
        $invitation = StaffInvitation::factory()->create();

        $this->actingAs(User::factory()->support()->create())->deleteJson(route('admin.staff.invitations.revoke', $invitation))->assertForbidden();
    });
});
