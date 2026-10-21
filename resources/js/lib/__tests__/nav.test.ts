import { describe, expect, it } from 'vitest';
import { adminNav, visibleNav } from '@/lib/adminNav';
import { customerNav } from '@/lib/customerNav';
import { ICONS } from '@/lib/icons';
import type { NavGroup } from '@/types';

describe('navigation data', () => {
    it('customerNav is the dashboard, a tab, from Wayfinder', () => {
        expect(customerNav).toHaveLength(1);
        expect(customerNav[0]).toMatchObject({
            key: 'dashboard',
            href: '/dashboard',
            exact: true,
            tab: true,
            tabLabelKey: 'common.nav.home',
        });
    });

    it('adminNav is the dashboard for every staff member, and Staff for staff.manage', () => {
        expect(adminNav).toHaveLength(2);
        expect(adminNav[0]?.items).toHaveLength(1);
        expect(adminNav[0]?.items[0]).toMatchObject({
            href: '/admin',
            exact: true,
        });
        expect(adminNav[0]?.items[0]?.anyOf).toBeUndefined();
        expect(adminNav[1]).toMatchObject({
            key: 'administration',
            labelKey: 'common.nav.groups.administration',
        });
        expect(adminNav[1]?.items).toHaveLength(1);
        expect(adminNav[1]?.items[0]).toMatchObject({
            key: 'staff',
            labelKey: 'common.nav.staff',
            href: '/admin/staff',
            icon: 'user-cog',
            anyOf: ['staff.manage'],
        });
    });

    it('uses only registered icons', () => {
        for (const item of [
            ...customerNav,
            ...adminNav.flatMap((group) => group.items),
        ]) {
            expect(ICONS[item.icon], item.key).toBeDefined();
        }
    });
});

describe('visibleNav', () => {
    const groups: NavGroup[] = [
        {
            key: 'top',
            items: [{ key: 'home', labelKey: 'a', href: '/a', icon: 'house' }],
        },
        {
            key: 'orders',
            labelKey: 'g.orders',
            items: [
                {
                    key: 'board',
                    labelKey: 'b',
                    href: '/b',
                    icon: 'package',
                    anyOf: ['orders.view'],
                },
                {
                    key: 'call',
                    labelKey: 'c',
                    href: '/c',
                    icon: 'phone',
                    anyOf: ['orders.confirm'],
                },
            ],
        },
        {
            key: 'admin',
            items: [
                {
                    key: 'settings',
                    labelKey: 's',
                    href: '/s',
                    icon: 'wrench',
                    anyOf: ['settings.manage', 'settings.manage_restricted'],
                },
            ],
        },
    ];
    const granting =
        (...names: string[]) =>
        (name: string) =>
            names.includes(name);

    it('keeps items without a requirement for everyone', () => {
        expect(
            visibleNav(groups, granting()).map((group) => group.key),
        ).toEqual(['top']);
    });

    it('shows an item when any one of its permissions or gates is held', () => {
        const visible = visibleNav(
            groups,
            granting('orders.confirm', 'settings.manage_restricted'),
        );

        expect(visible.map((group) => group.key)).toEqual([
            'top',
            'orders',
            'admin',
        ]);
        expect(visible[1]?.items.map((item) => item.key)).toEqual(['call']);
        expect(visible[2]?.items.map((item) => item.key)).toEqual(['settings']);
    });

    it('hides a group whose items are all hidden', () => {
        expect(
            visibleNav(groups, granting('settings.manage')).map(
                (group) => group.key,
            ),
        ).toEqual(['top', 'admin']);
    });

    it('does not mutate the source groups', () => {
        visibleNav(groups, granting());

        expect(groups[1]?.items).toHaveLength(2);
    });
});
