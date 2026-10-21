<?php

declare(strict_types=1);

use App\Domain\Identity\Models\User;
use Database\Seeders\OwnerSeeder;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Support\Facades\Hash;
use Spatie\Permission\Models\Role;

beforeEach(function (): void {
    // Pristine state regardless of any baseline seeding (16 §2).
    User::withTrashed()->forceDelete();
    RolesAndPermissionsSeeder::ensureSeeded();
});

function configureOwner(?string $email = 'Founder@Furny.test', ?string $password = 'a-long-owner-password', string $name = 'Asha Rao'): void
{
    config(['seed.owner' => ['name' => $name, 'email' => $email, 'password' => $password]]);
}

function seedOwner(): void
{
    app(OwnerSeeder::class)->run();
}

it('creates the onboarded, verified owner with the configured credentials', function (): void {
    configureOwner();

    seedOwner();

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
    configureOwner();

    seedOwner();

    expect(User::query()->sole()->hasRole('owner'))->toBeTrue();
});

it('creates nothing on the second run and leaves the owner untouched', function (): void {
    configureOwner();
    seedOwner();
    $before = User::query()->sole();
    $before->forceFill(['name' => 'Renamed'])->save();

    configureOwner(password: 'another-password-entirely');
    seedOwner();

    $after = User::query()->sole();
    expect($after->id)->toBe($before->id)
        ->and($after->name)->toBe('Renamed')
        ->and(Hash::check('a-long-owner-password', (string) $after->password))->toBeTrue();
});

it('does nothing when a user with the configured email exists, whatever its type', function (): void {
    configureOwner();
    User::factory()->create(['email' => 'founder@furny.test']);

    seedOwner();

    expect(User::query()->count())->toBe(1)->and(User::query()->sole()->isStaff())->toBeFalse();
});

it('fails loudly in production when the email is missing and there is no owner', function (): void {
    app()->detectEnvironment(static fn (): string => 'production');
    configureOwner(email: null, password: null);

    expect(fn () => seedOwner())->toThrow(RuntimeException::class);
    expect(User::query()->count())->toBe(0);
});

it('fails loudly in production when the password is missing and there is no owner', function (): void {
    app()->detectEnvironment(static fn (): string => 'production');
    configureOwner(password: '');

    expect(fn () => seedOwner())->toThrow(RuntimeException::class);
    expect(User::query()->count())->toBe(0);
});

it('does not fail in production when the email is empty but an owner exists', function (): void {
    app()->detectEnvironment(static fn (): string => 'production');
    User::factory()->owner()->create();
    configureOwner(email: null, password: null);

    seedOwner();

    expect(User::query()->count())->toBe(1);
});

it('skips quietly outside production when no email is configured', function (): void {
    configureOwner(email: null, password: null);

    seedOwner();

    expect(User::query()->count())->toBe(0);
});
