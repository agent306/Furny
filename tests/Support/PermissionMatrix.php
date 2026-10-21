<?php

declare(strict_types=1);

namespace Tests\Support;

/** The permission matrix of 13 §7.1-§7.2, written out independently of the code under test. */
final class PermissionMatrix
{
    /** @var list<string> */
    public const array ALL = [
        'orders.view', 'orders.review', 'orders.assign', 'orders.propose_changes', 'quotes.create', 'quotes.send',
        'quotes.view_costs', 'orders.confirm', 'orders.cancel', 'orders.hold', 'orders.close', 'production.manage',
        'messages.post', 'customers.view', 'customers.manage', 'catalog.manage', 'presets.manage', 'templates.manage',
        'settings.manage', 'staff.manage', 'ai.manage', 'reports.view', 'plans.edit_any', 'audit.view',
    ];

    /** @return array<string, list<string>> role => permission names */
    public static function roles(): array
    {
        return [
            'owner' => self::ALL,
            'admin' => self::ALL,
            'estimator' => [
                'orders.view', 'orders.review', 'orders.assign', 'orders.propose_changes', 'quotes.create', 'quotes.send',
                'quotes.view_costs', 'orders.confirm', 'orders.cancel', 'orders.hold', 'messages.post', 'customers.view',
                'presets.manage', 'plans.edit_any',
            ],
            'production' => ['orders.view', 'orders.hold', 'production.manage', 'messages.post', 'customers.view'],
            'support' => ['orders.view', 'orders.confirm', 'messages.post', 'customers.view'],
        ];
    }
}
