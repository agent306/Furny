<?php

declare(strict_types=1);

use App\Domain\Identity\Models\User;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Database\Connection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Symfony\Component\Process\PhpExecutableFinder;
use Symfony\Component\Process\Process;

/*
|--------------------------------------------------------------------------
| Parallel requests (13 §5.9, §7.3)
|--------------------------------------------------------------------------
|
| Each request is its own PHP process against the real Postgres test database, started at the same instant. What the
| test process does in its own transaction is not visible to them, so the rows they work on are committed through a
| connection of their own, and removed again by it.
*/

beforeEach(function (): void {
    // Migrate (and seed) the test database lazily before the other processes use it.
    RolesAndPermissionsSeeder::ensureSeeded();
    DB::select('select 1');

    $this->committed = DB::connectUsing('staff_parallel', config('database.connections.'.config('database.default')));
    $this->users = new ArrayObject;
    $this->invitations = new ArrayObject;
});

afterEach(function (): void {
    /** @var Connection $db */
    $db = $this->committed;
    $users = $this->users->getArrayCopy();
    $invitations = $this->invitations->getArrayCopy();

    // The workers' own rows: the user an acceptance created, and what both kinds of rows left in the audit log.
    $created = $db->table('staff_invitations')->whereIn('id', $invitations)->whereNotNull('user_id')->pluck('user_id')->all();
    $everyone = [...$users, ...$created];

    $db->table('activity_log')->where(fn ($query) => $query
        ->whereIn('subject_id', [...$everyone, ...$invitations])
        ->orWhereIn('causer_id', $everyone))->delete();
    $db->table('staff_invitations')->whereIn('id', $invitations)->delete();
    $db->table('model_has_roles')->whereIn('model_id', $everyone)->delete();
    $db->table('users')->whereIn('id', $everyone)->delete();
    $db->disconnect();
});

/** A staff user, committed so that the workers see it. */
function committedStaff(string $role, string $name): string
{
    $id = strtolower((string) Str::ulid());
    test()->users[] = $id;
    $user = User::factory()->make(['name' => $name, 'email' => Str::slug($name).'-'.$id.'@example.com']);
    test()->committed->table('users')->insert([
        ...$user->getAttributes(),
        'id' => $id,
        'type' => 'staff',
        'password' => Hash::make('password'),
        'created_at' => now(),
        'updated_at' => now(),
    ]);
    test()->committed->table('model_has_roles')->insert([
        'role_id' => test()->committed->table('roles')->where('name', $role)->value('id'),
        'model_type' => (new User)->getMorphClass(),
        'model_id' => $id,
    ]);

    return $id;
}

function committedInvitation(string $email): string
{
    $id = strtolower((string) Str::ulid());
    test()->invitations[] = $id;
    test()->committed->table('staff_invitations')->insert([
        'id' => $id,
        'email' => $email,
        'name' => 'Nina Hire',
        'role' => 'estimator',
        'expires_at' => now()->addHours(72),
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    return $id;
}

/**
 * Starts the workers together and returns what each printed.
 *
 * @param  list<list<string>>  $jobs  [mode, first, second] each
 * @return list<string>
 */
function staffParallel(array $jobs): array
{
    $connection = config('database.connections.'.config('database.default'));
    $start = microtime(true) + 2.5 + 0.15 * count($jobs);

    $processes = array_map(fn (array $job): Process => new Process(
        [(new PhpExecutableFinder)->find(), base_path('tests/Support/staff-worker.php'), $job[0], (string) $start, $job[1], $job[2]],
        base_path(),
        [
            'APP_ENV' => 'testing',
            'CACHE_STORE' => 'array',
            'SESSION_DRIVER' => 'array',
            'QUEUE_CONNECTION' => 'sync',
            'MAIL_MAILER' => 'array',
            'REDIS_DB' => (string) config('database.redis.default.database'),
            'REDIS_CACHE_DB' => (string) config('database.redis.cache.database'),
            'REDIS_SESSION_DB' => (string) config('database.redis.sessions.database'),
            'DB_CONNECTION' => (string) config('database.default'),
            'DB_URL' => '',
            'DB_HOST' => (string) $connection['host'],
            'DB_PORT' => (string) $connection['port'],
            'DB_DATABASE' => (string) $connection['database'],
            'DB_USERNAME' => (string) $connection['username'],
            'DB_PASSWORD' => (string) $connection['password'],
            'BCRYPT_ROUNDS' => '4',
        ],
        timeout: 60,
    ), $jobs);

    foreach ($processes as $process) {
        $process->start();
    }

    return array_map(function (Process $process): string {
        $process->wait();

        $line = trim($process->getOutput());
        expect($line)->not->toBe('', $process->getErrorOutput());

        return (string) json_decode($line, true, flags: JSON_THROW_ON_ERROR)['result'];
    }, $processes);
}

/** @param  list<string>  $results */
function staffTally(array $results): array
{
    $tally = array_count_values($results);
    ksort($tally);

    return $tally;
}

it('creates one user when four requests accept the same invitation at once', function (): void {
    $email = 'nina-'.Str::lower(Str::random(8)).'@example.com';
    $invitation = committedInvitation($email);

    $results = staffParallel(array_map(fn (): array => ['accept', $invitation, 'a-long-secret-1'], range(1, 4)));

    /** @var Connection $db */
    $db = $this->committed;

    expect(staffTally($results))->toEqual(['accepted' => 3, 'ok' => 1])
        ->and($db->table('users')->where('email', $email)->count())->toBe(1)
        ->and($db->table('staff_invitations')->where('id', $invitation)->whereNotNull('accepted_at')->whereNotNull('user_id')->count())->toBe(1)
        ->and($db->table('activity_log')->where('event', 'staff.invitation_accepted')->where('subject_id', $invitation)->count())->toBe(1);
})->group('concurrency');

it('lets one of two owners demote the other, not both', function (): void {
    $first = committedStaff('owner', 'Olga One');
    $second = committedStaff('owner', 'Otto Two');

    // Every other owner in the test database would make both demotions legal.
    $others = User::query()->role('owner')->where('is_active', true)->whereNotIn('id', [$first, $second])->count();
    expect($others)->toBe(0);

    $results = staffParallel([['demote', $first, $second], ['demote', $second, $first]]);

    /** @var Connection $db */
    $db = $this->committed;
    $owners = $db->table('model_has_roles')
        ->join('roles', 'roles.id', '=', 'model_has_roles.role_id')
        ->where('roles.name', 'owner')
        ->whereIn('model_id', [$first, $second])
        ->count();

    // The loser was refused as the last owner, or no longer an owner when its turn came (so not allowed to demote).
    expect($results)->toContain('ok')
        ->and(array_diff($results, ['ok', 'staff.last_owner', 'forbidden']))->toBe([])
        ->and($owners)->toBe(1);
})->group('concurrency');

it('never deactivates the last active owner when four owners deactivate each other in a ring at once', function (): void {
    $owners = array_map(fn (string $name): string => committedStaff('owner', $name), ['Olga One', 'Otto Two', 'Ola Three', 'Odin Four']);

    $results = staffParallel(array_map(
        fn (int $i): array => ['deactivate', $owners[$i], $owners[($i + 1) % 4]],
        range(0, 3),
    ));

    /** @var Connection $db */
    $db = $this->committed;

    expect(array_diff($results, ['ok', 'staff.last_owner', 'forbidden']))->toBe([])
        ->and($db->table('users')->whereIn('id', $owners)->where('is_active', true)->count())->toBeGreaterThanOrEqual(1);
})->group('concurrency');
