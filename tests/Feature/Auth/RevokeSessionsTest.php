<?php

declare(strict_types=1);

use App\Domain\Identity\Actions\RevokeSessions;
use App\Domain\Identity\Models\User;
use App\Support\Auth\SessionKey;
use App\Support\Auth\SessionRegistry;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Facades\Session;
use Illuminate\Support\Str;
use Spatie\Activitylog\Models\Activity;

beforeEach(function (): void {
    $this->user = User::factory()->create();
    $this->ids = [];
    $this->open = function (): string {
        $id = Str::random(40);
        $this->ids[] = $id;
        Session::getHandler()->write($id, '[]');
        app(SessionRegistry::class)->register($this->user, $id, Request::create('/'), 'password', false);

        return $id;
    };
});

afterEach(function (): void {
    $redis = Redis::connection('sessions');
    $redis->del('sess:user:'.$this->user->getKey());

    foreach ($this->ids as $id) {
        $redis->del('sess:meta:'.$id, 'sess:revoked:'.$id);
    }
});

it('audits the sessions that were really open, not the entries it removed', function (): void {
    $current = ($this->open)();
    ($this->open)();
    $dead = ($this->open)();
    Session::getHandler()->destroy($dead);

    $count = app(RevokeSessions::class)->others($this->user, $current);

    $activity = Activity::query()->where('event', 'auth.sessions_revoked')->sole();

    expect($count)->toBe(1)
        ->and($activity->properties->all())->toBe(['count' => 1, 'reason' => 'signed_out_others'])
        ->and(session('inertia.clear_history'))->toBeTrue();
});

it('revokes everything for an automatic reason and audits it with that reason', function (): void {
    ($this->open)();
    ($this->open)();

    $count = app(RevokeSessions::class)->all($this->user, 'password_changed');

    expect($count)->toBe(2)
        ->and(Activity::query()->where('event', 'auth.sessions_revoked')->sole()->properties->all())->toBe(['count' => 2, 'reason' => 'password_changed'])
        ->and(app(SessionRegistry::class)->list($this->user, null))->toBe([]);
});

it('attributes the audit entry to the staff member who revokes the sessions of a customer', function (): void {
    ($this->open)();
    $staff = User::factory()->owner()->create();

    $this->actingAs($staff);
    app(RevokeSessions::class)->all($this->user, 'deactivated');

    $activity = Activity::query()->where('event', 'auth.sessions_revoked')->sole();

    expect($activity->causer_id)->toBe($staff->getKey())
        ->and($activity->subject_id)->toBe($this->user->getKey())
        // The history that is cleared is the one of the person making the request only when it is their own.
        ->and(session('inertia.clear_history'))->toBeNull();
});

it('clears the history of a user who revokes their own sessions', function (): void {
    ($this->open)();

    $this->actingAs($this->user);
    app(RevokeSessions::class)->all($this->user, 'password_changed');

    expect(session('inertia.clear_history'))->toBeTrue();
});

it('says a device is unknown with null and writes nothing', function (): void {
    ($this->open)();

    expect(app(RevokeSessions::class)->device($this->user, SessionKey::for('nobody')))->toBeNull()
        ->and(Activity::query()->where('event', 'auth.sessions_revoked')->count())->toBe(0);
});
