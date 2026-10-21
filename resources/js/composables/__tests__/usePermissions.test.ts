import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';

type TestUser = {
    type: 'customer' | 'staff';
    roles?: string[];
    permissions?: string[];
    abilities?: string[];
};

const page = reactive<{ props: { auth: { user: TestUser | null } } }>({
    props: { auth: { user: null } },
});

vi.mock('@inertiajs/vue3', () => ({ usePage: () => page }));

import { usePermissions } from '@/composables/usePermissions';

function signIn(user: TestUser | null): void {
    page.props.auth.user = user;
}

beforeEach(() => signIn(null));

describe('usePermissions (15 §8) - display only, the server authorises', () => {
    const staff: TestUser = {
        type: 'staff',
        roles: ['owner'],
        permissions: ['orders.view'],
        abilities: ['settings.manage_restricted'],
    };

    it('can() reads permissions and abilities', () => {
        signIn(staff);
        const { can } = usePermissions();

        expect(can('orders.view')).toBe(true);
        expect(can('settings.manage_restricted')).toBe(true);
        expect(can('catalog.manage')).toBe(false);
    });

    it('canAny() is true when at least one name is held', () => {
        signIn(staff);
        const { canAny } = usePermissions();

        expect(canAny('catalog.manage', 'orders.view')).toBe(true);
        expect(canAny('catalog.manage', 'staff.manage')).toBe(false);
        expect(canAny()).toBe(false);
    });

    it('isStaff comes from the user type', () => {
        signIn(staff);
        expect(usePermissions().isStaff).toBe(true);

        signIn({ type: 'customer', roles: [], permissions: [], abilities: [] });
        expect(usePermissions().isStaff).toBe(false);
    });

    it('hasRole() matches the role names', () => {
        signIn(staff);
        const { hasRole } = usePermissions();

        expect(hasRole('owner')).toBe(true);
        expect(hasRole('admin')).toBe(false);
    });

    it('customers hold nothing', () => {
        signIn({ type: 'customer', roles: [], permissions: [], abilities: [] });
        const permissions = usePermissions();

        expect(permissions.can('orders.view')).toBe(false);
        expect(permissions.canAny('orders.view', 'data.delete')).toBe(false);
        expect(permissions.hasRole('owner')).toBe(false);
    });

    it('guests hold nothing', () => {
        const permissions = usePermissions();

        expect(permissions.can('orders.view')).toBe(false);
        expect(permissions.isStaff).toBe(false);
        expect(permissions.hasRole('owner')).toBe(false);
    });

    it('tolerates a user object that does not carry the lists (before the typed shared props)', () => {
        signIn({ type: 'staff' });
        const permissions = usePermissions();

        expect(permissions.can('orders.view')).toBe(false);
        expect(permissions.hasRole('owner')).toBe(false);
        expect(permissions.isStaff).toBe(true);
    });

    it('is reactive to the shared page props', () => {
        const permissions = usePermissions();

        expect(permissions.can('orders.view')).toBe(false);

        signIn(staff);

        expect(permissions.can('orders.view')).toBe(true);
        expect(permissions.isStaff).toBe(true);
    });
});
