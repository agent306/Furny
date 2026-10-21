import { dashboard } from '@/routes/customer';
import type { NavItem } from '@/types';

/**
 * The customer app's primary navigation (15 §7.1): header links on desktop, the
 * sheet menu on tablet and the bottom tab bar (`tab`) on phones. The set is
 * fixed, never permission based. Later tasks append Projects, Designs, Orders,
 * Help, Notifications and Account as their routes appear.
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
];
