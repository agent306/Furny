<?php

declare(strict_types=1);

use App\Domain\Identity\Enums\LengthUnit;
use App\Domain\Identity\Enums\UnitSystem;
use App\Domain\Identity\Enums\UserType;
use App\Domain\Identity\Models\Address;
use App\Domain\Identity\Models\NotificationPreference;
use App\Domain\Identity\Models\StaffInvitation;
use App\Domain\Identity\Models\User;
use Illuminate\Contracts\Auth\MustVerifyEmail;
use Illuminate\Contracts\Translation\HasLocalePreference;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

it('trims and lower-cases the email', function (): void {
    $user = User::factory()->create(['email' => '  Asha.K@Example.COM ']);

    expect($user->email)->toBe('asha.k@example.com')
        ->and(DB::table('users')->where('id', $user->id)->value('email'))->toBe('asha.k@example.com');
});

it('stores an empty email as null', function (): void {
    $user = User::factory()->phoneOnly()->create(['email' => '']);

    expect($user->email)->toBeNull()
        ->and(DB::table('users')->where('id', $user->id)->value('email'))->toBeNull();
});

it('applies the database defaults on a minimal insert', function (): void {
    $id = (string) Str::ulid();
    DB::table('users')->insert([
        'id' => $id, 'type' => 'customer', 'name' => 'Minimal', 'email' => 'minimal@example.com',
        'created_at' => now(), 'updated_at' => now(),
    ]);

    $user = User::query()->findOrFail($id);

    expect($user->unit_system)->toBe(UnitSystem::Metric)
        ->and($user->length_unit)->toBe(LengthUnit::Mm)
        ->and($user->type)->toBe(UserType::Customer)
        ->and($user->locale)->toBe('en')
        ->and($user->timezone)->toBe('Asia/Kolkata')
        ->and($user->is_active)->toBeTrue()
        ->and($user->marketing_opt_in)->toBeFalse();
});

it('is an authenticatable that verifies email and prefers its own locale', function (): void {
    $user = User::factory()->create(['locale' => 'hi']);

    expect($user)->toBeInstanceOf(MustVerifyEmail::class)
        ->toBeInstanceOf(HasLocalePreference::class)
        ->and($user->preferredLocale())->toBe('hi')
        ->and($user->receivesBroadcastNotificationsOn())->toBe('users.'.$user->id)
        ->and($user->getKey())->toHaveLength(26);
});

it('casts the typed attributes', function (): void {
    $user = User::factory()->create()->fresh();

    expect($user->type)->toBe(UserType::Customer)
        ->and($user->email_verified_at)->toBeInstanceOf(DateTimeImmutable::class)
        ->and($user->created_at)->toBeInstanceOf(DateTimeImmutable::class)
        ->and($user->is_active)->toBeBool()
        ->and($user->marketing_opt_in)->toBeBool()
        ->and($user->password)->not->toBe('password');
});

it('hides secrets when serialised', function (): void {
    $array = User::factory()->withTwoFactor()->create()->toArray();

    expect($array)->not->toHaveKeys(['password', 'remember_token', 'two_factor_secret', 'two_factor_recovery_codes']);
});

it('reports type and contact state', function (): void {
    expect(User::factory()->create()->isCustomer())->toBeTrue()
        ->and(User::factory()->create()->isStaff())->toBeFalse()
        ->and(User::factory()->staff()->create()->isStaff())->toBeTrue()
        ->and(User::factory()->staff()->create()->isCustomer())->toBeFalse()
        ->and(User::factory()->phoneOnly()->create()->hasVerifiedContact())->toBeTrue()
        ->and(User::factory()->unverified()->create()->hasVerifiedContact())->toBeFalse()
        ->and(User::factory()->unverified()->withPhone()->create()->hasVerifiedContact())->toBeTrue()
        ->and(User::factory()->create()->hasPassword())->toBeTrue()
        ->and(User::factory()->passwordless()->create()->hasPassword())->toBeFalse();
});

it('cascades addresses and notification preferences and nulls invitation links when force-deleted', function (): void {
    $user = User::factory()->create();
    $address = Address::factory()->forUser($user)->create();
    $preference = NotificationPreference::factory()->for($user)->create();
    $invitedBy = StaffInvitation::factory()->create(['invited_by' => $user->id]);
    $accepted = StaffInvitation::factory()->accepted()->create(['user_id' => $user->id]);

    expect($user->addresses)->toHaveCount(1);

    $user->forceDelete();

    expect(Address::query()->whereKey($address->id)->exists())->toBeFalse()
        ->and(NotificationPreference::query()->whereKey($preference->id)->exists())->toBeFalse()
        ->and($invitedBy->fresh()->invited_by)->toBeNull()
        ->and($accepted->fresh()->user_id)->toBeNull();
});

it('keeps related rows when a user is only soft-deleted', function (): void {
    $user = User::factory()->create();
    $address = Address::factory()->forUser($user)->create();

    $user->delete();

    expect(User::withTrashed()->find($user->id)?->trashed())->toBeTrue()
        ->and(Address::query()->whereKey($address->id)->exists())->toBeTrue();
});

it('allows a length unit only for the matching unit system', function (): void {
    expect(LengthUnit::Ftin->allowedFor(UnitSystem::Metric))->toBeFalse()
        ->and(LengthUnit::Ftin->allowedFor(UnitSystem::Imperial))->toBeTrue()
        ->and(LengthUnit::In->allowedFor(UnitSystem::Imperial))->toBeTrue()
        ->and(LengthUnit::In->allowedFor(UnitSystem::Metric))->toBeFalse()
        ->and(LengthUnit::Mm->allowedFor(UnitSystem::Metric))->toBeTrue()
        ->and(LengthUnit::Cm->allowedFor(UnitSystem::Imperial))->toBeFalse()
        ->and(LengthUnit::M->allowedFor(UnitSystem::Metric))->toBeTrue();
});
