<?php

declare(strict_types=1);

namespace Database\Seeders;

use App\Domain\Identity\Enums\PermissionName;
use App\Domain\Identity\Enums\StaffRole;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\Models\Role;
use Spatie\Permission\PermissionRegistrar;

/**
 * Seeds the 24 permissions and five roles of 13 §7.1-§7.2 (02 §14 item 1). Idempotent: rows are
 * `findOrCreate`d and every role is synced back to its matrix row, so a manually added permission
 * does not survive the next `db:seed` on deploy.
 */
final class RolesAndPermissionsSeeder extends Seeder
{
    private const string GUARD = 'web';

    public function run(): void
    {
        DB::transaction(function (): void {
            foreach (PermissionName::cases() as $permission) {
                Permission::findOrCreate($permission->value, self::GUARD);
            }

            foreach (StaffRole::cases() as $role) {
                Role::findOrCreate($role->value, self::GUARD)->syncPermissions(
                    array_map(static fn (PermissionName $permission): string => $permission->value, $role->permissions()),
                );
            }
        });

        app(PermissionRegistrar::class)->forgetCachedPermissions();
    }

    /**
     * Seeds the matrix when it is not in the database yet; used by the factory role states so a fresh
     * database works without the baseline seeding. A seeded database is left alone (no writes).
     */
    public static function ensureSeeded(): void
    {
        $roles = Role::query()->where('guard_name', self::GUARD)
            ->whereIn('name', array_map(static fn (StaffRole $role): string => $role->value, StaffRole::cases()))
            ->count();
        $permissions = Permission::query()->where('guard_name', self::GUARD)
            ->whereIn('name', array_map(static fn (PermissionName $permission): string => $permission->value, PermissionName::cases()))
            ->count();

        if ($roles === count(StaffRole::cases()) && $permissions === count(PermissionName::cases())) {
            return;
        }

        (new self)->run();
    }
}
