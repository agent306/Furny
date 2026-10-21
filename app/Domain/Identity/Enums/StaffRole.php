<?php

declare(strict_types=1);

namespace App\Domain\Identity\Enums;

use Spatie\TypeScriptTransformer\Attributes\TypeScript;

/** Spatie role names for staff and `staff_invitations.role` (02 §1.5, 13 §7). */
#[TypeScript]
enum StaffRole: string
{
    case Owner = 'owner';
    case Admin = 'admin';
    case Estimator = 'estimator';
    case Production = 'production';
    case Support = 'support';

    /** TOTP two-factor authentication is mandatory for the highest-privilege roles (13 S4). */
    public function requiresTwoFactor(): bool
    {
        return $this === self::Owner || $this === self::Admin;
    }

    /**
     * This role's row of the permission matrix (13 §7.2); `RolesAndPermissionsSeeder` syncs the role to it.
     *
     * @return list<PermissionName>
     */
    public function permissions(): array
    {
        return match ($this) {
            self::Owner, self::Admin => PermissionName::cases(),
            self::Estimator => [
                PermissionName::OrdersView,
                PermissionName::OrdersReview,
                PermissionName::OrdersAssign,
                PermissionName::OrdersProposeChanges,
                PermissionName::QuotesCreate,
                PermissionName::QuotesSend,
                PermissionName::QuotesViewCosts,
                PermissionName::OrdersConfirm,
                PermissionName::OrdersCancel,
                PermissionName::OrdersHold,
                PermissionName::MessagesPost,
                PermissionName::CustomersView,
                PermissionName::PresetsManage,
                PermissionName::PlansEditAny,
            ],
            self::Production => [
                PermissionName::OrdersView,
                PermissionName::OrdersHold,
                PermissionName::ProductionManage,
                PermissionName::MessagesPost,
                PermissionName::CustomersView,
            ],
            self::Support => [
                PermissionName::OrdersView,
                PermissionName::OrdersConfirm,
                PermissionName::MessagesPost,
                PermissionName::CustomersView,
            ],
        };
    }
}
