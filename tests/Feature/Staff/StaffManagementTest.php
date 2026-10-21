<?php

declare(strict_types=1);

use App\Domain\Identity\Actions\ActivateUser;
use App\Domain\Identity\Actions\DeactivateUser;
use App\Domain\Identity\Actions\InviteStaff;
use App\Domain\Identity\Actions\ResetTwoFactor;
use App\Domain\Identity\Actions\UpdateStaffMember;
use App\Domain\Identity\Enums\StaffRole;
use App\Domain\Identity\Models\StaffInvitation;
use App\Domain\Identity\Models\User;
use App\Support\Auth\SessionRegistry;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Facades\Session;
use Illuminate\Support\Str;
use Inertia\Testing\AssertableInertia as Assert;
use Spatie\Activitylog\Models\Activity;
use Tests\Support\InertiaRequest;

/**
 * @return list<string> the ids of the sessions opened, kept for the cleanup
 */
function staffSessionIds(?string $add = null, bool $forget = false): array
{
    static $ids = [];

    if ($add !== null) {
        $ids[] = $add;
    }

    $all = $ids;

    if ($forget) {
        $ids = [];
    }

    return $all;
}

/** Opens a session for `$user` in the handler and the registry and returns its id. */
function openStaffSession(User $user): string
{
    $id = Str::random(40);
    staffSessionIds($id);
    Session::getHandler()->write($id, '[]');
    app(SessionRegistry::class)->register($user, $id, Request::create('/', server: ['REMOTE_ADDR' => '203.0.113.45']), 'password', false);

    return $id;
}

/**
 * Runs `$change` once, right after the next owners lock is taken: what another request that held the lock before has
 * committed by the time this one gets it. The change is made through the query builder, so no model of the test sees it.
 */
function afterOwnersLock(Closure $change): void
{
    $done = false;

    DB::listen(static function (QueryExecuted $query) use (&$done, $change): void {
        if (! $done && str_contains($query->sql, 'pg_advisory_xact_lock')) {
            $done = true;
            $change();
        }
    });
}

/** Gives `$user` exactly the role `$role` in the database, behind the back of every model in memory. */
function setRoleBehindTheBack(User $user, StaffRole $role): void
{
    $roleId = DB::table(config('permission.table_names.roles'))->where('name', $role->value)->value('id');

    DB::table(config('permission.table_names.model_has_roles'))->where('model_id', $user->getKey())->delete();
    DB::table(config('permission.table_names.model_has_roles'))->insert(['role_id' => $roleId, 'model_type' => $user->getMorphClass(), 'model_id' => $user->getKey()]);
}

beforeEach(function (): void {
    $this->owner = User::factory()->owner()->create(['name' => 'Olga Owner']);
    $this->admin = User::factory()->admin()->create(['name' => 'Ada Admin']);
    $this->estimator = User::factory()->estimator()->create(['name' => 'Eli Estimator']);
    $this->as = fn (User $user) => $this->actingAs($user);
});

afterEach(function (): void {
    $redis = Redis::connection('sessions');

    foreach (staffSessionIds(forget: true) as $id) {
        $redis->del('sess:meta:'.$id, 'sess:revoked:'.$id);
    }

    foreach (User::withTrashed()->get() as $user) {
        $redis->del('sess:user:'.$user->getKey());
    }
});

describe('the staff page (11 section 7)', function (): void {
    beforeEach(function (): void {
        $this->props = fn (User $as, string $key) => $this->actingAs($as)->get(route('admin.staff.index'), InertiaRequest::headers())->assertOk()->json("props.{$key}");
    });

    it('renders Admin/Staff/Index with the four props', function (): void {
        $this->actingAs($this->admin)->get(route('admin.staff.index'))
            ->assertOk()
            ->assertInertia(fn (Assert $page) => $page
                ->component('Admin/Staff/Index')
                ->where('currentUserId', $this->admin->id)
                ->has('staff', 3)
                ->has('invitations', 0)
                ->has('roles', 5));
    });

    it('lists the staff, deactivated ones included, by name, and no customers', function (): void {
        User::factory()->create(['name' => 'Cora Customer']);
        $gone = User::factory()->support()->inactive()->create(['name' => 'Gus Gone']);

        $staff = ($this->props)($this->admin, 'staff');

        expect(array_column($staff, 'name'))->toBe(['Ada Admin', 'Eli Estimator', 'Gus Gone', 'Olga Owner'])
            ->and(collect($staff)->firstWhere('id', $gone->id)['isActive'])->toBeFalse();
    });

    it('describes each row', function (): void {
        $this->estimator->forceFill(['last_login_at' => now()->subDay()->startOfSecond(), 'google_id' => 'g-1'])->save();

        $rows = collect(($this->props)($this->owner, 'staff'))->keyBy('id');

        expect($rows[$this->estimator->id])->toBe([
            'id' => $this->estimator->id,
            'name' => 'Eli Estimator',
            'email' => $this->estimator->email,
            'role' => 'estimator',
            'twoFactorEnabled' => false,
            'twoFactorRequired' => false,
            'isActive' => true,
            'lastLoginAt' => $this->estimator->refresh()->last_login_at->toIso8601String(),
            'googleLinked' => true,
            'can' => ['edit' => true, 'deactivate' => true, 'activate' => false, 'resetTwoFactor' => false],
        ])->and($rows[$this->admin->id]['lastLoginAt'])->toBeNull()
            ->and($rows[$this->admin->id]['googleLinked'])->toBeFalse();
    });

    it('says which roles need two-factor authentication and who has it', function (): void {
        $rows = collect(($this->props)($this->owner, 'staff'))->keyBy('id');

        expect($rows[$this->owner->id])->toMatchArray(['twoFactorRequired' => true, 'twoFactorEnabled' => true])
            ->and($rows[$this->admin->id])->toMatchArray(['twoFactorRequired' => true, 'twoFactorEnabled' => true])
            ->and($rows[$this->estimator->id])->toMatchArray(['twoFactorRequired' => false, 'twoFactorEnabled' => false]);

        $this->admin->forceFill(['two_factor_secret' => null, 'two_factor_recovery_codes' => null, 'two_factor_confirmed_at' => null])->save();
        $unenrolled = collect(($this->props)($this->owner, 'staff'))->keyBy('id')[$this->admin->id];

        expect($unenrolled)->toMatchArray(['twoFactorRequired' => true, 'twoFactorEnabled' => false]);
    });

    it('offers an owner every action on others and none on themselves', function (): void {
        $rows = collect(($this->props)($this->owner, 'staff'))->keyBy('id');

        expect($rows[$this->admin->id]['can'])->toBe(['edit' => true, 'deactivate' => true, 'activate' => false, 'resetTwoFactor' => true])
            ->and($rows[$this->owner->id]['can'])->toBe(['edit' => false, 'deactivate' => false, 'activate' => false, 'resetTwoFactor' => false]);
    });

    it('offers an admin nothing on an owner, nothing on themselves, and activation on the deactivated', function (): void {
        $gone = User::factory()->support()->inactive()->create();
        $rows = collect(($this->props)($this->admin, 'staff'))->keyBy('id');
        $none = ['edit' => false, 'deactivate' => false, 'activate' => false, 'resetTwoFactor' => false];

        expect($rows[$this->owner->id]['can'])->toBe($none)
            ->and($rows[$this->admin->id]['can'])->toBe($none)
            ->and($rows[$gone->id]['can'])->toBe(['edit' => true, 'deactivate' => false, 'activate' => true, 'resetTwoFactor' => false]);
    });

    it('lists the pending invitations and the ones that expired within 30 days, newest first', function (): void {
        $pending = StaffInvitation::factory()->create(['email' => 'pending@example.com', 'name' => 'Pat Pending', 'invited_by' => $this->admin->id, 'created_at' => now()->subDay()]);
        $recent = StaffInvitation::factory()->create(['email' => 'recent@example.com', 'expires_at' => now()->subDays(10), 'invited_by' => null, 'created_at' => now()->subDays(13)]);
        StaffInvitation::factory()->create(['email' => 'old@example.com', 'expires_at' => now()->subDays(31)]);
        StaffInvitation::factory()->revoked()->create(['email' => 'revoked@example.com']);
        StaffInvitation::factory()->accepted()->create(['email' => 'accepted@example.com']);

        $invitations = ($this->props)($this->admin, 'invitations');

        expect(array_column($invitations, 'email'))->toBe(['pending@example.com', 'recent@example.com'])
            ->and($invitations[0])->toBe([
                'id' => $pending->id,
                'email' => 'pending@example.com',
                'name' => 'Pat Pending',
                'role' => 'estimator',
                'invitedBy' => ['id' => $this->admin->id, 'name' => 'Ada Admin', 'avatarUrl' => null, 'isStaff' => true],
                'expiresAt' => $pending->expires_at->toIso8601String(),
                'expired' => false,
                'createdAt' => $pending->created_at->toIso8601String(),
            ])
            ->and($invitations[1])->toMatchArray(['id' => $recent->id, 'expired' => true, 'invitedBy' => null]);
    });

    it('lists the five roles with a label and a description; owner is assignable only with the gate', function (): void {
        $forOwner = collect(($this->props)($this->owner, 'roles'));
        $forAdmin = collect(($this->props)($this->admin, 'roles'));

        expect($forAdmin->pluck('name')->all())->toBe(['owner', 'admin', 'estimator', 'production', 'support'])
            ->and($forAdmin->firstWhere('name', 'estimator'))->toBe([
                'name' => 'estimator',
                'label' => trans_icu('roles.names.estimator'),
                'description' => trans_icu('roles.descriptions.estimator'),
                'assignable' => true,
            ])
            ->and($forOwner->pluck('assignable')->all())->toBe([true, true, true, true, true])
            ->and($forAdmin->pluck('assignable')->all())->toBe([false, true, true, true, true]);
    });

    it('is for staff.manage only', function (string $role): void {
        $this->actingAs(User::factory()->staff($role)->create())->get(route('admin.staff.index'))->assertForbidden();
    })->with(['estimator', 'production', 'support']);

    it('is not for customers or guests', function (): void {
        $this->actingAs(User::factory()->create())->get(route('admin.staff.index'))->assertForbidden();
        auth()->forgetGuards();
        $this->flushSession();
        $this->get(route('admin.staff.index'))->assertRedirect(route('login'));
    });
});

describe('changing a role or a name (13 section 7.3)', function (): void {
    beforeEach(function (): void {
        $this->update = fn (User $target, array $body, ?User $as = null) => $this->actingAs($as ?? $this->admin)->putJson(route('admin.staff.update', $target), $body);
    });

    it('syncs exactly one role and audits from and to', function (): void {
        ($this->update)($this->estimator, ['name' => 'Eli Estimator', 'role' => 'production'])->assertRedirect();

        $activity = Activity::query()->where('event', 'staff.role_changed')->sole();

        expect($this->estimator->refresh()->roles->pluck('name')->all())->toBe(['production'])
            ->and($activity->log_name)->toBe('staff')
            ->and($activity->subject_id)->toBe($this->estimator->id)
            ->and($activity->causer_id)->toBe($this->admin->id)
            ->and($activity->properties->all())->toBe(['from' => 'estimator', 'to' => 'production']);
    });

    it('removes a stray second role', function (): void {
        $this->estimator->assignRole('support');
        expect($this->estimator->refresh()->roles)->toHaveCount(2);

        ($this->update)($this->estimator, ['name' => 'Eli Estimator', 'role' => 'estimator'])->assertRedirect();

        expect($this->estimator->refresh()->roles->pluck('name')->all())->toBe(['estimator']);
    });

    it('changes the name without an audit entry when the role stays', function (): void {
        ($this->update)($this->estimator, ['name' => 'Eli E. Estimator', 'role' => 'estimator'])->assertRedirect();

        expect($this->estimator->refresh()->name)->toBe('Eli E. Estimator')
            ->and(Activity::query()->where('event', 'staff.role_changed')->count())->toBe(0);
    });

    it('applies the new role at once: a promotion to admin requires two-factor authentication', function (): void {
        expect($this->estimator->requiresTwoFactor())->toBeFalse();

        ($this->update)($this->estimator, ['name' => 'Eli Estimator', 'role' => 'admin'])->assertRedirect();

        expect($this->estimator->refresh()->requiresTwoFactor())->toBeTrue();
    });

    it('flashes success on a page request', function (): void {
        $this->actingAs($this->admin)->put(route('admin.staff.update', $this->estimator), ['name' => 'Eli Estimator', 'role' => 'support'])
            ->assertRedirect()
            ->assertInertiaFlash('success', trans_icu('staff.toasts.updated', ['name' => 'Eli Estimator']));
    });

    it('validates the fields', function (array $body, string $field): void {
        ($this->update)($this->estimator, $body)->assertUnprocessable()->assertJsonValidationErrors($field);
    })->with([
        'no name' => [['name' => '', 'role' => 'support'], 'name'],
        'short name' => [['name' => 'E', 'role' => 'support'], 'name'],
        'long name' => [['name' => str_repeat('e', 121), 'role' => 'support'], 'name'],
        'no role' => [['name' => 'Eli Estimator'], 'role'],
        'unknown role' => [['name' => 'Eli Estimator', 'role' => 'janitor'], 'role'],
    ]);

    it('does not let an admin change their own role', function (): void {
        ($this->update)($this->admin, ['name' => 'Ada Admin', 'role' => 'support'])
            ->assertUnprocessable()
            ->assertJsonPath('code', 'staff.errors.self')
            ->assertJsonValidationErrors(['role' => trans_icu('staff.errors.self')]);

        expect($this->admin->refresh()->roles->pluck('name')->all())->toBe(['admin']);
    });

    it('does not let an owner change their own role while another owner exists', function (): void {
        $second = User::factory()->owner()->create();

        ($this->update)($this->owner, ['name' => 'Olga Owner', 'role' => 'admin'], $this->owner)
            ->assertUnprocessable()
            ->assertJsonPath('code', 'staff.errors.self');

        expect($second->refresh()->hasRole('owner'))->toBeTrue()
            ->and($this->owner->refresh()->hasRole('owner'))->toBeTrue();
    });

    it('refuses to demote the last active owner', function (): void {
        ($this->update)($this->owner, ['name' => 'Olga Owner', 'role' => 'admin'], $this->owner)
            ->assertUnprocessable()
            ->assertJsonPath('code', 'staff.last_owner')
            ->assertJsonValidationErrors(['role' => trans_icu('staff.errors.last_owner')]);

        expect($this->owner->refresh()->hasRole('owner'))->toBeTrue();
    });

    it('counts only active owners: a deactivated owner does not make the other one demotable', function (): void {
        User::factory()->owner()->inactive()->create();

        ($this->update)($this->owner, ['name' => 'Olga Owner', 'role' => 'admin'], $this->owner)
            ->assertUnprocessable()
            ->assertJsonPath('code', 'staff.last_owner');
    });

    it('lets an owner demote another owner', function (): void {
        $second = User::factory()->owner()->create();

        ($this->update)($second, ['name' => $second->name, 'role' => 'admin'], $this->owner)->assertRedirect();

        expect($second->refresh()->roles->pluck('name')->all())->toBe(['admin']);
    });

    it('lets an owner promote to owner', function (): void {
        ($this->update)($this->admin, ['name' => 'Ada Admin', 'role' => 'owner'], $this->owner)->assertRedirect();

        expect($this->admin->refresh()->roles->pluck('name')->all())->toBe(['owner']);
    });

    it('does not let an admin edit an owner, not even the name', function (): void {
        ($this->update)($this->owner, ['name' => 'Olga Owner', 'role' => 'owner'])->assertForbidden();
        ($this->update)($this->owner, ['name' => 'Hacked Owner', 'role' => 'support'])->assertForbidden();

        expect($this->owner->refresh()->name)->toBe('Olga Owner')
            ->and($this->owner->roles->pluck('name')->all())->toBe(['owner']);
    });

    it('does not let an admin make anyone an owner', function (): void {
        ($this->update)($this->estimator, ['name' => 'Eli Estimator', 'role' => 'owner'])->assertForbidden();

        expect($this->estimator->refresh()->roles->pluck('name')->all())->toBe(['estimator']);
    });

    it('is for staff.manage only', function (): void {
        ($this->update)($this->admin, ['name' => 'Ada Admin', 'role' => 'admin'], $this->estimator)->assertForbidden();
        ($this->update)($this->estimator, ['name' => 'Eli', 'role' => 'estimator'], User::factory()->create())->assertForbidden();
    });

    it('is not there for a customer', function (): void {
        $customer = User::factory()->create();

        ($this->update)($customer, ['name' => 'Cora Customer', 'role' => 'support'], $this->owner)->assertNotFound();

        expect($customer->refresh()->roles)->toHaveCount(0);
    });

    it('is not there for a user that does not exist', function (): void {
        $this->actingAs($this->owner)->putJson('/admin/staff/01JZZZZZZZZZZZZZZZZZZZZZZZ', ['name' => 'Nobody', 'role' => 'support'])->assertNotFound();
    });
});

describe('deactivating and reactivating (13 section 5.9)', function (): void {
    beforeEach(function (): void {
        $this->deactivate = fn (User $target, ?User $as = null) => $this->actingAs($as ?? $this->admin)->postJson(route('admin.staff.deactivate', $target));
        $this->activate = fn (User $target, ?User $as = null) => $this->actingAs($as ?? $this->admin)->postJson(route('admin.staff.activate', $target));
    });

    it('deactivates, destroys the sessions and rotates the remember token', function (): void {
        $first = openStaffSession($this->estimator);
        $second = openStaffSession($this->estimator);
        $this->estimator->forceFill(['remember_token' => 'old-remember-token'])->save();

        ($this->deactivate)($this->estimator)->assertRedirect();

        expect($this->estimator->refresh()->is_active)->toBeFalse()
            ->and($this->estimator->remember_token)->not->toBe('old-remember-token')->not->toBeNull()
            ->and(Session::getHandler()->read($first))->toBe('')
            ->and(Session::getHandler()->read($second))->toBe('')
            ->and(app(SessionRegistry::class)->list($this->estimator, null))->toBe([]);
    });

    it('audits staff.deactivated and the revocation of the sessions', function (): void {
        openStaffSession($this->estimator);

        ($this->deactivate)($this->estimator)->assertRedirect();

        $deactivated = Activity::query()->where('event', 'staff.deactivated')->sole();
        $revoked = Activity::query()->where('event', 'auth.sessions_revoked')->sole();

        expect($deactivated->log_name)->toBe('staff')
            ->and($deactivated->subject_id)->toBe($this->estimator->id)
            ->and($deactivated->causer_id)->toBe($this->admin->id)
            ->and($deactivated->properties->all())->toBe(['fields' => ['is_active']])
            ->and($revoked->subject_id)->toBe($this->estimator->id)
            ->and($revoked->causer_id)->toBe($this->admin->id)
            ->and($revoked->properties->all())->toBe(['count' => 1, 'reason' => 'deactivated']);
    });

    it('rotates the remember token even when no session was open', function (): void {
        $this->estimator->forceFill(['remember_token' => 'old-remember-token'])->save();

        ($this->deactivate)($this->estimator)->assertRedirect();

        expect($this->estimator->refresh()->remember_token)->not->toBe('old-remember-token');
    });

    it('signs the deactivated member out on their next request', function (): void {
        ($this->deactivate)($this->estimator)->assertRedirect();
        auth()->forgetGuards();

        $this->actingAs($this->estimator->refresh())->get(route('admin.dashboard'))->assertRedirect(route('login'));
        $this->assertGuest();
    });

    it('flashes success on a page request', function (): void {
        $this->actingAs($this->admin)->post(route('admin.staff.deactivate', $this->estimator))
            ->assertRedirect()
            ->assertInertiaFlash('success', trans_icu('staff.toasts.deactivated', ['name' => 'Eli Estimator']));
    });

    it('does nothing, and audits nothing, for a member who is deactivated already', function (): void {
        $gone = User::factory()->support()->inactive()->create();

        ($this->deactivate)($gone)->assertRedirect();

        expect(Activity::query()->where('event', 'staff.deactivated')->count())->toBe(0);
    });

    it('does not let an admin deactivate themselves', function (): void {
        ($this->deactivate)($this->admin)
            ->assertUnprocessable()
            ->assertJsonPath('code', 'staff.errors.self')
            ->assertJsonValidationErrors(['_error' => trans_icu('staff.errors.self')]);

        expect($this->admin->refresh()->is_active)->toBeTrue();
    });

    it('does not let an owner deactivate themselves while another owner exists', function (): void {
        User::factory()->owner()->create();

        ($this->deactivate)($this->owner, $this->owner)->assertUnprocessable()->assertJsonPath('code', 'staff.errors.self');
    });

    it('refuses to deactivate the last active owner', function (): void {
        ($this->deactivate)($this->owner, $this->owner)
            ->assertUnprocessable()
            ->assertJsonPath('code', 'staff.last_owner')
            ->assertJsonValidationErrors(['_error' => trans_icu('staff.errors.last_owner')]);

        expect($this->owner->refresh()->is_active)->toBeTrue();
    });

    it('lets an owner deactivate another owner', function (): void {
        $second = User::factory()->owner()->create();

        ($this->deactivate)($second, $this->owner)->assertRedirect();

        expect($second->refresh()->is_active)->toBeFalse();
    });

    it('does not let an admin deactivate or reactivate an owner', function (): void {
        ($this->deactivate)($this->owner)->assertForbidden();
        $second = User::factory()->owner()->inactive()->create();
        ($this->activate)($second)->assertForbidden();

        expect($this->owner->refresh()->is_active)->toBeTrue()
            ->and($second->refresh()->is_active)->toBeFalse();
    });

    it('reactivates and audits staff.reactivated', function (): void {
        $gone = User::factory()->support()->inactive()->create();

        $this->actingAs($this->admin)->post(route('admin.staff.activate', $gone))
            ->assertRedirect()
            ->assertInertiaFlash('success', trans_icu('staff.toasts.activated', ['name' => $gone->name]));

        $activity = Activity::query()->where('event', 'staff.reactivated')->sole();

        expect($gone->refresh()->is_active)->toBeTrue()
            ->and($activity->log_name)->toBe('staff')
            ->and($activity->subject_id)->toBe($gone->id)
            ->and($activity->causer_id)->toBe($this->admin->id)
            ->and($activity->properties->all())->toBe(['fields' => ['is_active']]);
    });

    it('does nothing, and audits nothing, for a member who is active already', function (): void {
        ($this->activate)($this->estimator)->assertRedirect();

        expect(Activity::query()->where('event', 'staff.reactivated')->count())->toBe(0);
    });

    it('is for staff.manage only', function (): void {
        ($this->deactivate)($this->admin, $this->estimator)->assertForbidden();
        ($this->activate)($this->admin, $this->estimator)->assertForbidden();
    });

    it('is not there for a customer', function (): void {
        $customer = User::factory()->create();

        ($this->deactivate)($customer, $this->owner)->assertNotFound();
        ($this->activate)($customer, $this->owner)->assertNotFound();

        expect($customer->refresh()->is_active)->toBeTrue();
    });
});

describe('resetting two-factor authentication (13 section 5.10)', function (): void {
    beforeEach(function (): void {
        $this->reset = fn (User $target, ?User $as = null) => $this->actingAs($as ?? $this->admin)->deleteJson(route('admin.staff.two-factor.reset', $target));
        $this->target = User::factory()->admin()->create();
    });

    it('clears the two-factor columns and destroys the sessions', function (): void {
        $session = openStaffSession($this->target);
        expect($this->target->two_factor_confirmed_at)->not->toBeNull();

        ($this->reset)($this->target)->assertRedirect();

        $this->target->refresh();

        expect($this->target->two_factor_secret)->toBeNull()
            ->and($this->target->two_factor_recovery_codes)->toBeNull()
            ->and($this->target->two_factor_confirmed_at)->toBeNull()
            ->and($this->target->hasEnabledTwoFactorAuthentication())->toBeFalse()
            ->and(Session::getHandler()->read($session))->toBe('')
            ->and(app(SessionRegistry::class)->list($this->target, null))->toBe([]);
    });

    it('audits auth.2fa_reset in the security log, with the revocation', function (): void {
        openStaffSession($this->target);

        ($this->reset)($this->target)->assertRedirect();

        $reset = Activity::query()->where('event', 'auth.2fa_reset')->sole();
        $revoked = Activity::query()->where('event', 'auth.sessions_revoked')->sole();

        expect($reset->log_name)->toBe('security')
            ->and($reset->subject_id)->toBe($this->target->id)
            ->and($reset->causer_id)->toBe($this->admin->id)
            ->and($reset->properties->all())->toBe(['via' => 'web'])
            ->and($revoked->properties->all())->toBe(['count' => 1, 'reason' => '2fa_reset']);
    });

    it('rotates the remember token', function (): void {
        $this->target->forceFill(['remember_token' => 'old-remember-token'])->save();

        ($this->reset)($this->target)->assertRedirect();

        expect($this->target->refresh()->remember_token)->not->toBe('old-remember-token');
    });

    it('sends an admin to enrol again', function (): void {
        ($this->reset)($this->target)->assertRedirect();

        expect($this->target->refresh()->requiresTwoFactor())->toBeTrue()
            ->and($this->target->two_factor_confirmed_at)->toBeNull();
    });

    it('flashes success on a page request', function (): void {
        $this->actingAs($this->admin)->delete(route('admin.staff.two-factor.reset', $this->target))
            ->assertRedirect()
            ->assertInertiaFlash('success', trans_icu('staff.toasts.two_factor_reset', ['name' => $this->target->name]));
    });

    it('does not let an admin reset the two-factor authentication of an owner, but lets an owner', function (): void {
        ($this->reset)($this->owner)->assertForbidden();
        expect($this->owner->refresh()->two_factor_confirmed_at)->not->toBeNull();

        $second = User::factory()->owner()->create();
        ($this->reset)($second, $this->owner)->assertRedirect();
        expect($second->refresh()->two_factor_confirmed_at)->toBeNull();
    });

    it('does not let anybody reset their own', function (): void {
        ($this->reset)($this->admin)->assertUnprocessable()->assertJsonPath('code', 'staff.errors.self');

        expect($this->admin->refresh()->two_factor_confirmed_at)->not->toBeNull();
    });

    it('is for staff.manage only', function (): void {
        ($this->reset)($this->target, $this->estimator)->assertForbidden();
    });

    it('is not there for a customer', function (): void {
        ($this->reset)(User::factory()->create(), $this->owner)->assertNotFound();
    });
});

describe('the actions outside a request', function (): void {
    it('lets the console reset two-factor authentication without an actor and audits the way', function (): void {
        $target = User::factory()->owner()->create();

        app(ResetTwoFactor::class)->handle(null, $target, 'console');

        $reset = Activity::query()->where('event', 'auth.2fa_reset')->sole();

        expect($target->refresh()->two_factor_confirmed_at)->toBeNull()
            ->and($reset->causer_id)->toBeNull()
            ->and($reset->properties->all())->toBe(['via' => 'console']);
    });

    it('does not deactivate a customer: that is the customers actions', function (): void {
        expect(fn () => app(DeactivateUser::class)->handle($this->owner, User::factory()->create()))
            ->toThrow(LogicException::class);
    });

    it('checks the owner gate itself, whoever calls it', function (): void {
        expect(fn () => app(UpdateStaffMember::class)->handle($this->admin, $this->estimator, 'Eli Estimator', StaffRole::Owner))
            ->toThrow(AuthorizationException::class);

        expect(fn () => app(InviteStaff::class)->handle($this->admin, 'x@example.com', 'Xavier Ex', StaffRole::Owner))
            ->toThrow(AuthorizationException::class);
    });
});

describe('the owner gate of the target, asked by the actions themselves', function (): void {
    it('refuses an admin on an owner in every action, whoever calls them', function (string $action): void {
        $inactiveOwner = User::factory()->owner()->inactive()->create();

        $call = match ($action) {
            'update' => fn () => app(UpdateStaffMember::class)->handle($this->admin, $this->owner, 'Olga Owner', StaffRole::Admin),
            'deactivate' => fn () => app(DeactivateUser::class)->handle($this->admin, $this->owner),
            'activate' => fn () => app(ActivateUser::class)->handle($this->admin, $inactiveOwner),
            'reset' => fn () => app(ResetTwoFactor::class)->handle($this->admin, $this->owner),
        };

        expect($call)->toThrow(AuthorizationException::class);

        expect($this->owner->refresh()->is_active)->toBeTrue()
            ->and($this->owner->two_factor_confirmed_at)->not->toBeNull()
            ->and($this->owner->hasRole('owner'))->toBeTrue()
            ->and($inactiveOwner->refresh()->is_active)->toBeFalse();
    })->with(['update', 'deactivate', 'activate', 'reset']);

    it('lets an owner act on an owner in every action', function (): void {
        $second = User::factory()->owner()->create();
        $gone = User::factory()->owner()->inactive()->create();

        app(UpdateStaffMember::class)->handle($this->owner, $second, 'Renamed Owner', StaffRole::Owner);
        app(ActivateUser::class)->handle($this->owner, $gone);

        expect($second->refresh()->name)->toBe('Renamed Owner')
            ->and($gone->refresh()->is_active)->toBeTrue();
    });
});

describe('authorization is asked again once the owners lock is held (13 section 5.9)', function (): void {
    it('refuses to edit a member who was made an owner while the request waited', function (): void {
        afterOwnersLock(fn () => setRoleBehindTheBack($this->estimator, StaffRole::Owner));

        expect(fn () => app(UpdateStaffMember::class)->handle($this->admin, $this->estimator, 'Eli Renamed', StaffRole::Estimator))
            ->toThrow(AuthorizationException::class);

        expect($this->estimator->refresh()->name)->toBe('Eli Estimator');
    });

    it('refuses to deactivate a member who was made an owner while the request waited', function (): void {
        afterOwnersLock(fn () => setRoleBehindTheBack($this->estimator, StaffRole::Owner));

        expect(fn () => app(DeactivateUser::class)->handle($this->admin, $this->estimator))->toThrow(AuthorizationException::class);

        expect($this->estimator->refresh()->is_active)->toBeTrue();
    });

    it('refuses to reactivate a member who was made an owner while the request waited', function (): void {
        $gone = User::factory()->support()->inactive()->create();
        afterOwnersLock(fn () => setRoleBehindTheBack($gone, StaffRole::Owner));

        expect(fn () => app(ActivateUser::class)->handle($this->admin, $gone))->toThrow(AuthorizationException::class);

        expect($gone->refresh()->is_active)->toBeFalse();
    });

    it('refuses to reset the two-factor authentication of a member who was made an owner while the request waited', function (): void {
        afterOwnersLock(fn () => setRoleBehindTheBack($this->estimator, StaffRole::Owner));

        expect(fn () => app(ResetTwoFactor::class)->handle($this->admin, $this->estimator))->toThrow(AuthorizationException::class);

        expect(Activity::query()->where('event', 'auth.2fa_reset')->count())->toBe(0);
    });

    it('refuses an actor who lost the owner role while the request waited', function (string $action): void {
        $actor = User::factory()->owner()->create();
        $target = User::factory()->owner()->create(['name' => 'Target Owner']);
        $gone = User::factory()->owner()->inactive()->create();
        // The gate has been asked once already, so the actor's roles are in memory.
        expect(app(UpdateStaffMember::class)->handle($actor, $this->estimator, 'Eli Estimator', StaffRole::Estimator))->toBeInstanceOf(User::class);

        afterOwnersLock(fn () => setRoleBehindTheBack($actor, StaffRole::Admin));

        $call = match ($action) {
            'update' => fn () => app(UpdateStaffMember::class)->handle($actor, $target, 'Taken Over', StaffRole::Owner),
            'grant' => fn () => app(UpdateStaffMember::class)->handle($actor, $this->estimator, 'Eli Estimator', StaffRole::Owner),
            'deactivate' => fn () => app(DeactivateUser::class)->handle($actor, $target),
            'activate' => fn () => app(ActivateUser::class)->handle($actor, $gone),
            'reset' => fn () => app(ResetTwoFactor::class)->handle($actor, $target),
        };

        expect($call)->toThrow(AuthorizationException::class);

        expect($target->refresh()->name)->toBe('Target Owner')
            ->and($target->two_factor_confirmed_at)->not->toBeNull()
            ->and($target->is_active)->toBeTrue()
            ->and($gone->refresh()->is_active)->toBeFalse()
            ->and($this->estimator->refresh()->hasRole('estimator'))->toBeTrue();
    })->with(['update', 'grant', 'deactivate', 'activate', 'reset']);

    it('refuses an actor who was deactivated while the request waited', function (): void {
        $actor = User::factory()->admin()->create();
        afterOwnersLock(fn () => User::query()->whereKey($actor->getKey())->update(['is_active' => false]));

        expect(fn () => app(DeactivateUser::class)->handle($actor, $this->estimator))->toThrow(AuthorizationException::class);

        expect($this->estimator->refresh()->is_active)->toBeTrue();
    });
});

describe('reactivating also signs the member out everywhere (13 section 5.9)', function (): void {
    beforeEach(function (): void {
        $this->gone = User::factory()->support()->inactive()->create();
    });

    it('destroys what sessions are left and rotates the remember token', function (): void {
        $session = openStaffSession($this->gone);
        $this->gone->forceFill(['remember_token' => 'old-remember-token'])->save();

        $this->actingAs($this->admin)->postJson(route('admin.staff.activate', $this->gone))->assertRedirect();

        $revoked = Activity::query()->where('event', 'auth.sessions_revoked')->sole();

        expect($this->gone->refresh()->is_active)->toBeTrue()
            ->and($this->gone->remember_token)->not->toBe('old-remember-token')->not->toBeNull()
            ->and(Session::getHandler()->read($session))->toBe('')
            ->and($revoked->properties->all())->toBe(['count' => 1, 'reason' => 'reactivated']);
    });

    it('rotates the remember token even when no session is left', function (): void {
        $this->gone->forceFill(['remember_token' => 'old-remember-token'])->save();

        app(ActivateUser::class)->handle($this->admin, $this->gone);

        expect($this->gone->refresh()->remember_token)->not->toBe('old-remember-token');
    });

    it('leaves a member who is active already alone', function (): void {
        $session = openStaffSession($this->estimator);
        $this->estimator->forceFill(['remember_token' => 'old-remember-token'])->save();

        app(ActivateUser::class)->handle($this->admin, $this->estimator);

        expect($this->estimator->refresh()->remember_token)->toBe('old-remember-token')
            ->and(Session::getHandler()->read($session))->not->toBe('');
    });
});

describe('resetting two-factor authentication of a member who has none (13 section 5.10)', function (): void {
    it('resets all the same: the sessions go and the reset is audited, as the spec has no exception', function (): void {
        $target = User::factory()->admin()->withoutTwoFactor()->create();
        $session = openStaffSession($target);

        app(ResetTwoFactor::class)->handle($this->owner, $target);

        expect(Session::getHandler()->read($session))->toBe('')
            ->and(Activity::query()->where('event', 'auth.2fa_reset')->sole()->subject_id)->toBe($target->id);
    });

    it('clears an enrolment that was started and never confirmed', function (): void {
        $target = User::factory()->admin()->withoutTwoFactor()->create();
        $target->forceFill(['two_factor_secret' => encrypt('SECRET'), 'two_factor_recovery_codes' => encrypt('[]')])->save();

        app(ResetTwoFactor::class)->handle($this->owner, $target);

        expect($target->refresh()->two_factor_secret)->toBeNull()
            ->and($target->two_factor_recovery_codes)->toBeNull();
    });
});
