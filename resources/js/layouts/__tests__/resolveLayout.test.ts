import { describe, expect, it } from 'vitest';
import AdminLayout from '@/layouts/AdminLayout.vue';
import AuthLayout from '@/layouts/AuthLayout.vue';
import CustomerLayout from '@/layouts/CustomerLayout.vue';
import { resolveLayout } from '@/layouts/resolveLayout';

const customer = { type: 'customer' };
const staff = { type: 'staff' };

describe('resolveLayout (15 §7)', () => {
    it('gives each area its layout', () => {
        expect(resolveLayout('Auth/Login', null)).toBe(AuthLayout);
        expect(resolveLayout('Customer/Dashboard', customer)).toBe(
            CustomerLayout,
        );
        expect(resolveLayout('Admin/Dashboard', staff)).toBe(AdminLayout);
    });

    it('leaves Welcome to its own wide AuthLayout and unknown pages bare', () => {
        expect(resolveLayout('Welcome', null)).toBeNull();
        expect(resolveLayout('Something/Else', customer)).toBeNull();
    });

    it.each(['Legal/Terms', 'Legal/Privacy', 'Error'])(
        '%s follows the audience (10 §4.9, §4.10)',
        (name) => {
            expect(resolveLayout(name, staff)).toBe(AdminLayout);
            expect(resolveLayout(name, customer)).toBe(CustomerLayout);
            expect(resolveLayout(name, null)).toEqual({
                component: AuthLayout,
                props: { variant: 'wide' },
            });
            expect(resolveLayout(name, undefined)).toEqual({
                component: AuthLayout,
                props: { variant: 'wide' },
            });
        },
    );
});
