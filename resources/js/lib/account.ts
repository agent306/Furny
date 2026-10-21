import {
    preferences as adminPreferences,
    profile as adminProfile,
    security as adminSecurity,
} from '@/routes/admin/account';
import { update as updateAdminAvatar } from '@/routes/admin/account/avatar';
import { update as updateAdminPreferences } from '@/routes/admin/account/preferences';
import { twoFactor } from '@/routes/admin/security';
import {
    preferences as customerPreferences,
    profile as customerProfile,
    security as customerSecurity,
} from '@/routes/customer/account';
import { update as updateCustomerAvatar } from '@/routes/customer/account/avatar';
import { update as updateCustomerPreferences } from '@/routes/customer/account/preferences';

// The account area has one set of pages for each audience (10 §13, 11 §18). The components under `components/account`
// serve both, and take the routes that differ from here.
export type AccountAudience = 'customer' | 'admin';

export type AccountNavItem = {
    key: 'profile' | 'security' | 'two-factor' | 'preferences';
    labelKey: string;
    href: string;
};

/**
 * The sections of the account area, in order. The customer's Notifications, AI credits and Delete account join with the
 * tasks that build those pages; the staff member's Notifications joins with theirs (11 §18).
 */
export function accountNavItems(audience: AccountAudience): AccountNavItem[] {
    if (audience === 'admin') {
        return [
            {
                key: 'profile',
                labelKey: 'account.nav.profile',
                href: adminProfile.url(),
            },
            {
                key: 'security',
                labelKey: 'account.nav.security',
                href: adminSecurity.url(),
            },
            {
                key: 'two-factor',
                labelKey: 'account.nav.two_factor',
                href: twoFactor.url(),
            },
            {
                key: 'preferences',
                labelKey: 'account.nav.preferences',
                href: adminPreferences.url(),
            },
        ];
    }

    return [
        {
            key: 'profile',
            labelKey: 'account.nav.profile',
            href: customerProfile.url(),
        },
        {
            key: 'security',
            labelKey: 'account.nav.security',
            href: customerSecurity.url(),
        },
        {
            key: 'preferences',
            labelKey: 'account.nav.preferences',
            href: customerPreferences.url(),
        },
    ];
}

/** The URLs that differ between the audiences' account pages. */
export function accountUrls(audience: AccountAudience): {
    avatar: string;
    preferences: string;
} {
    return audience === 'admin'
        ? {
              avatar: updateAdminAvatar.url(),
              preferences: updateAdminPreferences.url(),
          }
        : {
              avatar: updateCustomerAvatar.url(),
              preferences: updateCustomerPreferences.url(),
          };
}
