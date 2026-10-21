import AdminLayout from '@/layouts/AdminLayout.vue';
import AuthLayout from '@/layouts/AuthLayout.vue';
import CustomerLayout from '@/layouts/CustomerLayout.vue';

type LayoutUser = { type: string } | null | undefined;

/**
 * The default persistent layout of a page, by its component name (15 §7). A page
 * can still declare its own with `defineOptions({ layout })`; the kit's auth pages
 * pass `title` / `description` as layout props to the `Auth/*` default.
 *
 * `Legal/*` and `Error` serve every audience (10 §4.9, §4.10): the layout follows
 * who is looking, so a signed-in customer keeps the customer chrome around a 404.
 */
export function resolveLayout(name: string, user: LayoutUser): unknown {
    if (name === 'Welcome') {
        // Declares its own wide AuthLayout.
        return null;
    }

    if (name.startsWith('Auth/')) {
        return AuthLayout;
    }

    if (name.startsWith('Customer/')) {
        return CustomerLayout;
    }

    if (name.startsWith('Admin/')) {
        return AdminLayout;
    }

    if (name.startsWith('Legal/') || name === 'Error') {
        if (user?.type === 'staff') {
            return AdminLayout;
        }

        if (user?.type === 'customer') {
            return CustomerLayout;
        }

        return { component: AuthLayout, props: { variant: 'wide' } };
    }

    return null;
}
