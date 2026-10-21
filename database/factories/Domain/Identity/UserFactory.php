<?php

declare(strict_types=1);

namespace Database\Factories\Domain\Identity;

use App\Domain\Identity\Enums\LengthUnit;
use App\Domain\Identity\Enums\StaffRole;
use App\Domain\Identity\Enums\UnitSystem;
use App\Domain\Identity\Enums\UserType;
use App\Domain\Identity\Models\User;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

/**
 * Default state: an onboarded customer with a verified email, password "password" and accepted terms (16 §5.1).
 *
 * Staff role states (`owner()`, `admin()`, ...) set the user type, assign the spatie role (seeding the
 * roles and permissions first when the database has none) and, for owner/admin, a confirmed TOTP
 * (`withoutTwoFactor()` removes it). The role is assigned after insert, so it needs `create()`, not `make()`.
 *
 * @extends Factory<User>
 */
final class UserFactory extends Factory
{
    protected $model = User::class;

    private static ?string $password = null;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'type' => UserType::Customer,
            'name' => fake()->name(),
            'email' => fake()->unique()->safeEmail(),
            'email_verified_at' => now(),
            'phone_e164' => null,
            'phone_verified_at' => null,
            'first_contact_verified_at' => now(),
            'password' => self::$password ??= Hash::make('password'),
            'google_id' => null,
            'unit_system' => UnitSystem::Metric,
            'length_unit' => LengthUnit::Mm,
            'locale' => 'en',
            'timezone' => 'Asia/Kolkata',
            'is_active' => true,
            'remember_token' => Str::random(10),
            'marketing_opt_in' => false,
            'terms_accepted_at' => now(),
            'onboarded_at' => now(),
        ];
    }

    public function customer(): static
    {
        return $this->state(['type' => UserType::Customer]);
    }

    /** Staff are created onboarded with a verified email and a password (13 S3). */
    public function staff(StaffRole|string $role = StaffRole::Support): static
    {
        $role = $role instanceof StaffRole ? $role : StaffRole::from($role);

        return $this->state([
            'type' => UserType::Staff,
            'email_verified_at' => now(),
            'terms_accepted_at' => now(),
            'onboarded_at' => now(),
        ])->state($role->requiresTwoFactor() ? $this->confirmedTwoFactor() : [])
            ->afterCreating(static function (User $user) use ($role): void {
                RolesAndPermissionsSeeder::ensureSeeded();
                $user->assignRole($role->value);
            });
    }

    public function owner(): static
    {
        return $this->staff(StaffRole::Owner);
    }

    public function admin(): static
    {
        return $this->staff(StaffRole::Admin);
    }

    public function estimator(): static
    {
        return $this->staff(StaffRole::Estimator);
    }

    public function production(): static
    {
        return $this->staff(StaffRole::Production);
    }

    public function support(): static
    {
        return $this->staff(StaffRole::Support);
    }

    public function unverified(): static
    {
        return $this->state(['email_verified_at' => null, 'first_contact_verified_at' => null]);
    }

    public function emailVerified(): static
    {
        return $this->state(fn (array $attributes): array => [
            'email_verified_at' => now(),
            'first_contact_verified_at' => $attributes['first_contact_verified_at'] ?? now(),
        ]);
    }

    /** Adds a verified phone number to the user (keeps the email). */
    public function phoneVerified(): static
    {
        return $this->withPhone();
    }

    /** A customer who signed up with a phone OTP only: no email, no password. */
    public function phoneOnly(): static
    {
        return $this->state([
            'email' => null,
            'email_verified_at' => null,
            'first_contact_verified_at' => null,
            'password' => null,
        ])->withPhone();
    }

    /** @param  ?string  $e164  generated (unique) Indian mobile number when omitted */
    public function withPhone(?string $e164 = null): static
    {
        return $this->state(fn (array $attributes): array => [
            'phone_e164' => $e164 ?? '+919'.fake()->unique()->numerify('#########'),
            'phone_verified_at' => now(),
            'first_contact_verified_at' => $attributes['first_contact_verified_at'] ?? now(),
        ]);
    }

    public function passwordless(): static
    {
        return $this->state(['password' => null]);
    }

    public function googleLinked(): static
    {
        return $this->state(fn (): array => ['google_id' => fake()->unique()->numerify('####################')]);
    }

    public function inactive(): static
    {
        return $this->state(['is_active' => false]);
    }

    public function notOnboarded(): static
    {
        return $this->state(['onboarded_at' => null]);
    }

    /** Customer created by staff who has not accepted the terms yet (02 §1.1 `terms_accepted_at`). */
    public function termsPending(): static
    {
        return $this->state(['terms_accepted_at' => null, 'onboarded_at' => null]);
    }

    public function imperial(): static
    {
        return $this->state(['unit_system' => UnitSystem::Imperial, 'length_unit' => LengthUnit::Ftin]);
    }

    /** Confirmed TOTP enrolment (Fortify stores both columns encrypted). */
    public function withTwoFactor(): static
    {
        return $this->state($this->confirmedTwoFactor());
    }

    public function withoutTwoFactor(): static
    {
        return $this->state([
            'two_factor_secret' => null,
            'two_factor_recovery_codes' => null,
            'two_factor_confirmed_at' => null,
        ]);
    }

    /** Account deletion requested `$days` ago (soft-deleted, awaiting anonymisation, 13 §9). */
    public function pendingDeletion(int $days = 5): static
    {
        return $this->state(fn (): array => ['deleted_at' => now()->subDays($days)]);
    }

    /** Past the 30-day grace period, so `users:anonymise-deleted` would pick the account up. */
    public function deletionExpired(): static
    {
        return $this->pendingDeletion(31);
    }

    /** The row `AnonymiseUser` leaves behind (13 §9.2). */
    public function anonymised(): static
    {
        return $this->state(function (): array {
            $id = strtolower((string) Str::ulid());

            return [
                'id' => $id,
                'name' => 'Deleted customer '.substr($id, -6),
                'email' => 'deleted+'.$id.'@invalid.invalid',
                'email_verified_at' => null,
                'phone_e164' => null,
                'phone_verified_at' => null,
                'password' => null,
                'google_id' => null,
                'remember_token' => null,
                'two_factor_secret' => null,
                'two_factor_recovery_codes' => null,
                'two_factor_confirmed_at' => null,
                'notes_internal' => null,
                'last_login_at' => null,
                'marketing_opt_in' => false,
                'deleted_at' => now()->subDays(31),
                'anonymised_at' => now(),
            ];
        });
    }

    /**
     * @return array<string, mixed>
     */
    private function confirmedTwoFactor(): array
    {
        return [
            'two_factor_secret' => encrypt('JBSWY3DPEHPK3PXP'),
            'two_factor_recovery_codes' => encrypt(json_encode(
                array_map(static fn (): string => Str::random(10).'-'.Str::random(10), range(1, 8)),
                JSON_THROW_ON_ERROR,
            )),
            'two_factor_confirmed_at' => now(),
        ];
    }
}
