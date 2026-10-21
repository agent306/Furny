<?php

declare(strict_types=1);

namespace Database\Seeders;

use App\Domain\Identity\Enums\StaffRole;
use App\Domain\Identity\Enums\UserType;
use App\Domain\Identity\Models\User;
use App\Support\Settings\Settings;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * Creates the first owner from `config('seed.owner')` (`SEED_OWNER_*`, 02 §14 item 5). Idempotent: a user
 * with the configured email, of any type or state, is left untouched. Production fails loudly when the
 * credentials are missing and no owner exists; elsewhere a missing email just skips the step.
 */
final class OwnerSeeder extends Seeder
{
    public function run(): void
    {
        $email = mb_strtolower(trim((string) config('seed.owner.email')));
        $password = (string) config('seed.owner.password');

        if ($email === '') {
            $this->failInProductionWithoutOwner('SEED_OWNER_EMAIL is not set');

            return;
        }

        if (User::withTrashed()->where('email', $email)->exists()) {
            return;
        }

        if ($password === '' && app()->environment('production')) {
            throw new RuntimeException('SEED_OWNER_PASSWORD is not set and the owner "'.$email.'" does not exist yet.');
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
                'terms_accepted_at' => now(),
                'onboarded_at' => now(),
            ])->save();

            $owner->assignRole(StaffRole::Owner->value);
        });
    }

    private function failInProductionWithoutOwner(string $reason): void
    {
        if (app()->environment('production') && ! User::role(StaffRole::Owner->value)->exists()) {
            throw new RuntimeException($reason.' and no owner exists; set SEED_OWNER_NAME, SEED_OWNER_EMAIL and SEED_OWNER_PASSWORD for the first deploy.');
        }
    }
}
