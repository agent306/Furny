<?php

declare(strict_types=1);

use App\Domain\Identity\Models\User;
use Database\Seeders\OwnerSeeder;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Spatie\Permission\Models\Role;

beforeEach(function (): void {
    // Pristine state regardless of any baseline seeding (16 §2).
    User::withTrashed()->forceDelete();
    RolesAndPermissionsSeeder::ensureSeeded();
});

function ownerSeederConfigure(?string $email = 'Founder@Furny.test', ?string $password = 'a-long-owner-password', string $name = 'Asha Rao'): void
{
    config(['seed.owner' => ['name' => $name, 'email' => $email, 'password' => $password]]);
}

function ownerSeederRun(): void
{
    app(OwnerSeeder::class)->run();
}

it('creates the onboarded, verified owner with the configured credentials', function (): void {
    ownerSeederConfigure();

    ownerSeederRun();

    $owner = User::query()->sole();
    expect($owner->name)->toBe('Asha Rao')
        ->and($owner->email)->toBe('founder@furny.test')
        ->and($owner->isStaff())->toBeTrue()
        ->and($owner->is_active)->toBeTrue()
        ->and($owner->hasRole('owner'))->toBeTrue()
        ->and($owner->roles)->toHaveCount(1)
        ->and($owner->onboarded_at)->not->toBeNull()
        ->and($owner->email_verified_at)->not->toBeNull()
        ->and($owner->terms_accepted_at)->not->toBeNull()
        ->and($owner->timezone)->toBe('Asia/Kolkata')
        ->and(Hash::check('a-long-owner-password', (string) $owner->password))->toBeTrue();
});

it('seeds the roles itself when they do not exist yet', function (): void {
    Role::query()->delete();
    ownerSeederConfigure();

    ownerSeederRun();

    expect(User::query()->sole()->hasRole('owner'))->toBeTrue();
});

it('creates nothing on the second run and leaves the owner untouched', function (): void {
    ownerSeederConfigure();
    ownerSeederRun();
    $before = User::query()->sole();
    $before->forceFill(['name' => 'Renamed'])->save();

    ownerSeederConfigure(password: 'another-password-entirely');
    ownerSeederRun();

    $after = User::query()->sole();
    expect($after->id)->toBe($before->id)
        ->and($after->name)->toBe('Renamed')
        ->and(Hash::check('a-long-owner-password', (string) $after->password))->toBeTrue();
});

it('never promotes an existing customer holding the configured email outside production', function (): void {
    Log::spy();
    ownerSeederConfigure();
    User::factory()->create(['email' => 'founder@furny.test']);

    ownerSeederRun();

    $user = User::query()->sole();
    expect($user->isStaff())->toBeFalse()->and($user->roles)->toHaveCount(0);
    Log::shouldHaveReceived('warning')->once();
});

it('fails loudly in production when a customer holds the configured email', function (): void {
    app()->detectEnvironment(static fn (): string => 'production');
    ownerSeederConfigure();
    User::factory()->create(['email' => 'founder@furny.test']);

    expect(fn () => ownerSeederRun())->toThrow(RuntimeException::class);
    expect(User::query()->sole()->isStaff())->toBeFalse();
});

it('treats an inactive owner holding the configured email like any other existing user', function (): void {
    app()->detectEnvironment(static fn (): string => 'production');
    ownerSeederConfigure();
    User::factory()->owner()->inactive()->create(['email' => 'founder@furny.test']);

    expect(fn () => ownerSeederRun())->toThrow(RuntimeException::class);
    expect(User::query()->count())->toBe(1);
});

it('skips with an info log, before anything else, when any active owner exists', function (): void {
    Log::spy();
    app()->detectEnvironment(static fn (): string => 'production');
    User::factory()->owner()->create();
    // Even a conflicting customer and weak credentials cannot make the seeder fail once an owner exists.
    User::factory()->create(['email' => 'founder@furny.test']);
    ownerSeederConfigure(password: 'short');

    ownerSeederRun();

    expect(User::query()->count())->toBe(2);
    Log::shouldHaveReceived('info')->once();
});

it('creates a new owner when the only owner is inactive and the email is free', function (): void {
    User::factory()->owner()->inactive()->create();
    ownerSeederConfigure();

    ownerSeederRun();

    expect(User::query()->where('email', 'founder@furny.test')->sole()->hasRole('owner'))->toBeTrue();
});

dataset('weak production passwords', [
    'too short' => ['fifteen-chars-x'],
    'empty' => [''],
    'the word password' => ['password'],
    'the email itself' => ['long.owner.address@furny.test'],
]);

it('rejects weak owner passwords in production before writing anything', function (string $password): void {
    app()->detectEnvironment(static fn (): string => 'production');
    ownerSeederConfigure(email: $password === 'long.owner.address@furny.test' ? $password : 'founder@furny.test', password: $password);

    expect(fn () => ownerSeederRun())->toThrow(RuntimeException::class);
    expect(User::query()->count())->toBe(0);
})->with('weak production passwords');

it('accepts a 16 character password in production', function (): void {
    app()->detectEnvironment(static fn (): string => 'production');
    ownerSeederConfigure(password: 'sixteen-chars-ok!');

    ownerSeederRun();

    expect(User::query()->sole()->hasRole('owner'))->toBeTrue();
});

it('does not apply the production password rules in other environments', function (): void {
    ownerSeederConfigure(password: 'short');

    ownerSeederRun();

    expect(User::query()->sole()->hasRole('owner'))->toBeTrue();
});

it('fails loudly in production when the email is missing and there is no owner', function (): void {
    app()->detectEnvironment(static fn (): string => 'production');
    ownerSeederConfigure(email: null, password: null);

    expect(fn () => ownerSeederRun())->toThrow(RuntimeException::class);
    expect(User::query()->count())->toBe(0);
});

it('fails loudly in production when the password is missing and there is no owner', function (): void {
    app()->detectEnvironment(static fn (): string => 'production');
    ownerSeederConfigure(password: '');

    expect(fn () => ownerSeederRun())->toThrow(RuntimeException::class);
    expect(User::query()->count())->toBe(0);
});

it('does not fail in production when the email is empty but an owner exists', function (): void {
    app()->detectEnvironment(static fn (): string => 'production');
    User::factory()->owner()->create();
    ownerSeederConfigure(email: null, password: null);

    ownerSeederRun();

    expect(User::query()->count())->toBe(1);
});

it('skips quietly outside production when no email is configured', function (): void {
    ownerSeederConfigure(email: null, password: null);

    ownerSeederRun();

    expect(User::query()->count())->toBe(0);
});
