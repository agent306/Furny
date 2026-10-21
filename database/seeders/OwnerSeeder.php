<?php

declare(strict_types=1);

namespace Database\Seeders;

use App\Domain\Identity\Enums\StaffRole;
use App\Domain\Identity\Enums\UserType;
use App\Domain\Identity\Models\User;
use App\Support\Settings\Settings;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use RuntimeException;

/**
 * Creates the first owner from `config('seed.owner')` (`SEED_OWNER_*`, 02 §14 item 5, 17 §6.1).
 *
 * Idempotent: once any active staff owner exists the seeder does nothing. An existing user that holds
 * the configured email but is not an active owner (a customer, an inactive owner, a deleted account)
 * is never promoted: production fails loudly, other environments log a warning and skip. Production
 * also fails loudly on missing or weak credentials, before anything is written.
 */
final class OwnerSeeder extends Seeder
{
    private const int MIN_PRODUCTION_PASSWORD_LENGTH = 16;

    public function run(): void
    {
        if ($this->activeOwnerExists()) {
            Log::info('OwnerSeeder skipped: an active owner already exists.');

            return;
        }

        $production = app()->environment('production');
        $email = mb_strtolower(trim((string) config('seed.owner.email')));
        $password = (string) config('seed.owner.password');

        if ($email === '') {
            if ($production) {
                throw new RuntimeException('No active owner exists and SEED_OWNER_EMAIL is not set; set SEED_OWNER_NAME, SEED_OWNER_EMAIL and SEED_OWNER_PASSWORD for the first deploy.');
            }

            return;
        }

        if (User::withTrashed()->where('email', $email)->exists()) {
            $message = 'OwnerSeeder will not promote the existing user with the configured SEED_OWNER_EMAIL; it is not an active owner.';

            if ($production) {
                throw new RuntimeException($message);
            }

            Log::warning($message);

            return;
        }

        if ($production) {
            $this->assertStrongPassword($password, $email);
        }

        RolesAndPermissionsSeeder::ensureSeeded();

        DB::transaction(function () use ($email, $password): void {
            $owner = new User;
            $owner->forceFill([
                'type' => UserType::Staff,
                'name' => (string) config('seed.owner.name'),
                'email' => $email,
                'password' => $password === '' ? null : $password,
                'timezone' => app(Settings::class)->business()->timezone,
                'is_active' => true,
                'email_verified_at' => now(),
                'first_contact_verified_at' => now(),
                'terms_accepted_at' => now(),
                'onboarded_at' => now(),
            ])->save();

            $owner->assignRole(StaffRole::Owner->value);
        });
    }

    private function activeOwnerExists(): bool
    {
        return User::query()
            ->where('type', UserType::Staff)
            ->where('is_active', true)
            ->whereHas('roles', static fn (Builder $roles) => $roles->where('name', StaffRole::Owner->value))
            ->exists();
    }

    private function assertStrongPassword(string $password, string $email): void
    {
        if (mb_strlen($password) < self::MIN_PRODUCTION_PASSWORD_LENGTH) {
            throw new RuntimeException('SEED_OWNER_PASSWORD must be at least '.self::MIN_PRODUCTION_PASSWORD_LENGTH.' characters in production.');
        }

        if (mb_strtolower($password) === 'password' || mb_strtolower($password) === $email) {
            throw new RuntimeException('SEED_OWNER_PASSWORD must not be "password" or the owner email.');
        }
    }
}
