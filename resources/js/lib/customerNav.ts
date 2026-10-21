import { dashboard } from '@/routes/customer';
import { preferences, profile, security } from '@/routes/customer/account';
import type { NavItem } from '@/types';

/**
 * The customer app's primary navigation (15 §7.1): header links on desktop, the
 * sheet menu on tablet and the bottom tab bar (`tab`) on phones. The set is
 * fixed, never permission based. Later tasks append Projects, Designs, Orders,
 * Help and Notifications as their routes appear. Account is a tab only (15 §7.1): the header reaches it through the
 * account menu.
 */
export const customerNav: readonly NavItem[] = [
    {
        key: 'dashboard',
        labelKey: 'common.nav.dashboard',
        tabLabelKey: 'common.nav.home',
        href: dashboard.url(),
        icon: 'house',
        exact: true,
        tab: true,
    },
    {
        key: 'account',
        labelKey: 'common.nav.account',
        href: profile.url(),
        icon: 'user',
        tab: true,
        headerHidden: true,
        match: [profile.url(), security.url(), preferences.url()],
    },
];
