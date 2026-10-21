<?php

declare(strict_types=1);

use App\Domain\Identity\Enums\LengthUnit;
use App\Domain\Identity\Enums\OtpChannel;
use App\Domain\Identity\Enums\OtpPurpose;
use App\Domain\Identity\Enums\StaffRole;
use App\Domain\Identity\Enums\UnitSystem;
use App\Domain\Identity\Enums\UserType;
use App\Domain\Identity\Models\Address;
use App\Domain\Identity\Models\NotificationPreference;
use App\Domain\Identity\Models\OtpCode;
use App\Domain\Identity\Models\StaffInvitation;
use App\Domain\Identity\Models\User;
use App\Domain\Shared\Enums\NotificationChannel;
use Illuminate\Support\Facades\Hash;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\Models\Role;

dataset('user states', [
    'customer' => ['customer', []],
    'staff' => ['staff', []],
    'staff with role' => ['staff', ['estimator']],
    'owner' => ['owner', []],
    'admin' => ['admin', []],
    'estimator' => ['estimator', []],
    'production' => ['production', []],
    'support' => ['support', []],
    'unverified' => ['unverified', []],
    'emailVerified' => ['emailVerified', []],
    'phoneVerified' => ['phoneVerified', []],
    'phoneOnly' => ['phoneOnly', []],
    'withPhone' => ['withPhone', []],
    'withPhone number' => ['withPhone', ['+919812345678']],
    'passwordless' => ['passwordless', []],
    'googleLinked' => ['googleLinked', []],
    'inactive' => ['inactive', []],
    'notOnboarded' => ['notOnboarded', []],
    'termsPending' => ['termsPending', []],
    'withTwoFactor' => ['withTwoFactor', []],
    'withoutTwoFactor' => ['withoutTwoFactor', []],
    'imperial' => ['imperial', []],
    'pendingDeletion' => ['pendingDeletion', []],
    'pendingDeletion days' => ['pendingDeletion', [12]],
    'deletionExpired' => ['deletionExpired', []],
    'anonymised' => ['anonymised', []],
]);

it('creates a valid user row for every state', function (string $state, array $arguments): void {
    $user = User::factory()->{$state}(...$arguments)->create();

    $fresh = User::withTrashed()->findOrFail($user->id);

    expect($fresh->email !== null || $fresh->phone_e164 !== null)->toBeTrue();
})->with('user states');

it('defaults to an onboarded customer with a verified email and the password "password"', function (): void {
    $user = User::factory()->create();

    expect($user->type)->toBe(UserType::Customer)
        ->and($user->email_verified_at)->not->toBeNull()
        ->and($user->onboarded_at)->not->toBeNull()
        ->and($user->terms_accepted_at)->not->toBeNull()
        ->and($user->two_factor_confirmed_at)->toBeNull()
        ->and(Hash::check('password', (string) $user->password))->toBeTrue()
        ->and($user->unit_system)->toBe(UnitSystem::Metric)
        ->and($user->length_unit)->toBe(LengthUnit::Mm)
        ->and($user->is_active)->toBeTrue();
});

it('builds staff users with onboarding, a verified email and a password', function (): void {
    $staff = User::factory()->staff()->create();

    expect($staff->type)->toBe(UserType::Staff)
        ->and($staff->onboarded_at)->not->toBeNull()
        ->and($staff->email_verified_at)->not->toBeNull()
        ->and($staff->hasPassword())->toBeTrue()
        ->and($staff->two_factor_confirmed_at)->toBeNull();
});

it('gives owner and admin a confirmed TOTP unless withoutTwoFactor() (16 §5.1)', function (): void {
    expect(User::factory()->owner()->create()->two_factor_confirmed_at)->not->toBeNull()
        ->and(User::factory()->admin()->create()->two_factor_secret)->not->toBeNull()
        ->and(User::factory()->staff(StaffRole::Admin)->create()->two_factor_confirmed_at)->not->toBeNull()
        ->and(User::factory()->admin()->withoutTwoFactor()->create()->two_factor_confirmed_at)->toBeNull()
        ->and(User::factory()->estimator()->create()->two_factor_confirmed_at)->toBeNull()
        ->and(User::factory()->production()->create()->two_factor_confirmed_at)->toBeNull()
        ->and(User::factory()->support()->create()->two_factor_confirmed_at)->toBeNull();
});

it('assigns the spatie role of every staff state, seeding roles on a fresh database', function (): void {
    Role::query()->delete();
    Permission::query()->delete();

    foreach (StaffRole::cases() as $role) {
        $user = User::factory()->{$role->value}()->create();

        expect($user->getRoleNames()->all())->toBe([$role->value])
            ->and($user->permissionNames())->toHaveCount(count($role->permissions()));
    }

    expect(User::factory()->staff('support')->create()->hasRole('support'))->toBeTrue()
        ->and(User::factory()->create()->roles)->toHaveCount(0);
});

it('keeps the TOTP secrets encrypted and readable by Fortify', function (): void {
    $user = User::factory()->withTwoFactor()->create();

    expect($user->hasEnabledTwoFactorAuthentication())->toBeTrue()
        ->and($user->recoveryCodes())->toHaveCount(8)
        ->and(decrypt($user->two_factor_secret))->toBeString()->not->toBeEmpty();
});

it('models phone-only, passwordless and google-linked accounts', function (): void {
    $phoneOnly = User::factory()->phoneOnly()->create();
    $passwordless = User::factory()->passwordless()->create();
    $google = User::factory()->googleLinked()->create();

    expect($phoneOnly->email)->toBeNull()
        ->and($phoneOnly->password)->toBeNull()
        ->and($phoneOnly->phone_e164)->toStartWith('+')
        ->and($phoneOnly->phone_verified_at)->not->toBeNull()
        ->and($passwordless->password)->toBeNull()
        ->and($passwordless->email)->not->toBeNull()
        ->and($google->google_id)->not->toBeNull();
});

it('creates two phone-only users without colliding on the unique phone number', function (): void {
    User::factory()->count(5)->phoneOnly()->create();

    expect(User::query()->whereNotNull('phone_e164')->count())->toBe(5);
});

it('withPhone() uses the given E.164 number and marks it verified', function (): void {
    $user = User::factory()->withPhone('+919812345678')->create();

    expect($user->phone_e164)->toBe('+919812345678')
        ->and($user->phone_verified_at)->not->toBeNull();
});

it('models onboarding, terms and imperial preferences', function (): void {
    $notOnboarded = User::factory()->notOnboarded()->create();
    $termsPending = User::factory()->termsPending()->create();
    $imperial = User::factory()->imperial()->create();

    expect($notOnboarded->onboarded_at)->toBeNull()
        ->and($notOnboarded->terms_accepted_at)->not->toBeNull()
        ->and($termsPending->terms_accepted_at)->toBeNull()
        ->and($termsPending->onboarded_at)->toBeNull()
        ->and($imperial->unit_system)->toBe(UnitSystem::Imperial)
        ->and($imperial->length_unit->allowedFor(UnitSystem::Imperial))->toBeTrue();
});

it('models deactivation, deletion and anonymisation', function (): void {
    $this->freezeTime();

    $inactive = User::factory()->inactive()->create();
    $pending = User::factory()->pendingDeletion()->create();
    $expired = User::factory()->deletionExpired()->create();
    $anonymised = User::factory()->anonymised()->create();

    expect($inactive->is_active)->toBeFalse()
        ->and($pending->trashed())->toBeTrue()
        ->and($pending->deleted_at?->toIso8601String())->toBe(now()->subDays(5)->toIso8601String())
        ->and($expired->deleted_at?->toIso8601String())->toBe(now()->subDays(31)->toIso8601String())
        ->and(User::query()->whereKey($pending->id)->exists())->toBeFalse()
        ->and($anonymised->anonymised_at)->not->toBeNull()
        ->and($anonymised->trashed())->toBeTrue()
        ->and($anonymised->email)->toBe('deleted+'.$anonymised->id.'@invalid.invalid')
        ->and($anonymised->name)->toBe('Deleted customer '.substr($anonymised->id, -6))
        ->and($anonymised->phone_e164)->toBeNull()
        ->and($anonymised->password)->toBeNull();
});

it('creates addresses for a user, including international ones', function (): void {
    $user = User::factory()->create();

    $home = Address::factory()->forUser($user)->create();
    $abroad = Address::factory()->forUser($user)->international('AE')->create();

    expect(Address::factory()->create()->user)->toBeInstanceOf(User::class)
        ->and($home->user_id)->toBe($user->id)
        ->and($home->country_code)->toBe('IN')
        ->and($abroad->country_code)->toBe('AE')
        ->and($user->addresses()->count())->toBe(2);
});

dataset('otp states', [
    'default' => ['forPhone', ['+919812345678']],
    'verifyPhone' => ['verifyPhone', []],
    'sms' => ['sms', []],
    'expired' => ['expired', []],
    'consumed' => ['consumed', []],
    'attempts' => ['attempts', [3]],
    'withCode' => ['withCode', ['654321']],
]);

it('creates a valid otp code row for every state', function (string $state, array $arguments): void {
    $otp = OtpCode::factory()->{$state}(...$arguments)->create();

    expect($otp->fresh())->not->toBeNull();
})->with('otp states');

it('hashes the otp code and models its lifecycle states', function (): void {
    $otp = OtpCode::factory()->forPhone('+919812345678', code: '123456')->create();
    $custom = OtpCode::factory()->withCode('654321')->create();

    expect($otp->phone_e164)->toBe('+919812345678')
        ->and($otp->purpose)->toBe(OtpPurpose::Login)
        ->and($otp->channel)->toBe(OtpChannel::Whatsapp)
        ->and($otp->attempts)->toBe(0)
        ->and($otp->consumed_at)->toBeNull()
        ->and($otp->expires_at->isFuture())->toBeTrue()
        ->and(Hash::check('123456', $otp->code_hash))->toBeTrue()
        ->and(Hash::check('654321', $custom->code_hash))->toBeTrue()
        ->and(OtpCode::factory()->verifyPhone()->create()->purpose)->toBe(OtpPurpose::VerifyPhone)
        ->and(OtpCode::factory()->sms()->create()->channel)->toBe(OtpChannel::Sms)
        ->and(OtpCode::factory()->expired()->create()->expires_at->isPast())->toBeTrue()
        ->and(OtpCode::factory()->consumed()->create()->consumed_at)->not->toBeNull()
        ->and(OtpCode::factory()->attempts(4)->create()->attempts)->toBe(4)
        ->and($otp->toArray())->not->toHaveKey('code_hash');
});

it('creates notification preferences', function (): void {
    $default = NotificationPreference::factory()->create();
    $disabled = NotificationPreference::factory()->for($default->user)->for('orders.quote_sent', NotificationChannel::Whatsapp)->disabled()->create();

    expect($default->enabled)->toBeTrue()
        ->and($default->channel)->toBeInstanceOf(NotificationChannel::class)
        ->and($disabled->event_key)->toBe('orders.quote_sent')
        ->and($disabled->channel)->toBe(NotificationChannel::Whatsapp)
        ->and($disabled->enabled)->toBeFalse();
});

dataset('invitation states', [
    'default' => ['pending', []],
    'accepted' => ['accepted', []],
    'revoked' => ['revoked', []],
    'expired' => ['expired', []],
    'role' => ['role', [StaffRole::Production]],
]);

it('creates a valid staff invitation row for every state', function (string $state, array $arguments): void {
    $invitation = StaffInvitation::factory()->{$state}(...$arguments)->create();

    expect($invitation->fresh())->not->toBeNull();
})->with('invitation states');

it('models the staff invitation lifecycle', function (): void {
    $pending = StaffInvitation::factory()->create();
    $accepted = StaffInvitation::factory()->accepted()->create();
    $revoked = StaffInvitation::factory()->revoked()->create();
    $expired = StaffInvitation::factory()->expired()->create();

    expect($pending->accepted_at)->toBeNull()
        ->and($pending->revoked_at)->toBeNull()
        ->and($pending->expires_at->isFuture())->toBeTrue()
        ->and($pending->email)->toBe(strtolower($pending->email))
        ->and($pending->invitedBy)->toBeInstanceOf(User::class)
        ->and($accepted->accepted_at)->not->toBeNull()
        ->and($accepted->user)->toBeInstanceOf(User::class)
        ->and($revoked->revoked_at)->not->toBeNull()
        ->and($expired->expires_at->isPast())->toBeTrue()
        ->and($expired->accepted_at)->toBeNull()
        ->and(StaffInvitation::factory()->role(StaffRole::Support)->create()->role)->toBe(StaffRole::Support);
});
