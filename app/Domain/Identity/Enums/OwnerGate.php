<?php

declare(strict_types=1);

namespace App\Domain\Identity\Enums;

use Spatie\TypeScriptTransformer\Attributes\TypeScript;

/**
 * Owner-only abilities (13 §7.3). Each is a gate that delegates to the `owner` gate, which checks
 * for an active staff user holding the `owner` role.
 */
#[TypeScript]
enum OwnerGate: string
{
    /** The gate every ability below delegates to. */
    public const string OWNER = 'owner';

    /** T30: cancel an order that is in production or later. */
    case OrdersCancelLate = 'orders.cancel_late';
    /** Invite with role owner; grant/revoke the owner role; deactivate, reactivate or reset 2FA of an owner. */
    case StaffManageOwners = 'staff.manage_owners';
    case SettingsChangeCurrency = 'settings.change_currency';
    /** Settings groups `ai` and `auth`, and the AI provider test. */
    case SettingsManageRestricted = 'settings.manage_restricted';
    /** Immediate anonymisation of a customer, hard deletes and purge actions. */
    case DataDelete = 'data.delete';
}
