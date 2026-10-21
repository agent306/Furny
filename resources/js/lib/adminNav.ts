import { dashboard } from '@/routes/admin';
import { index as staff } from '@/routes/admin/staff';
import type { NavGroup } from '@/types';

/**
 * The admin sidebar (15 §7.2). Items carry the permissions or owner gates that
 * reveal them (`anyOf`); a group whose items are all hidden is hidden. Later
 * milestones append their groups (Orders, Customers, Catalog, …). Administration so far holds Staff.
 */
export const adminNav: readonly NavGroup[] = [
    {
        key: 'main',
        items: [
            {
                key: 'dashboard',
                labelKey: 'common.nav.dashboard',
                href: dashboard.url(),
                icon: 'layout-dashboard',
                exact: true,
            },
        ],
    },
    {
        key: 'administration',
        labelKey: 'common.nav.groups.administration',
        items: [
            {
                key: 'staff',
                labelKey: 'common.nav.staff',
                href: staff.url(),
                icon: 'user-cog',
                anyOf: ['staff.manage'],
            },
        ],
    },
];

/**
 * The groups and items the user may see. A display filter only (13 §7.4): every
 * route is authorised on the server.
 */
export function visibleNav(
    groups: readonly NavGroup[],
    can: (nameOrGate: string) => boolean,
): NavGroup[] {
    return groups
        .map((group) => ({
            ...group,
            items: group.items.filter(
                (item) =>
                    item.anyOf === undefined ||
                    item.anyOf.some((name) => can(name)),
            ),
        }))
        .filter((group) => group.items.length > 0);
}
