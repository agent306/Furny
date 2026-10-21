import AdminLayout from '@/layouts/AdminLayout.vue';
import AuthLayout from '@/layouts/AuthLayout.vue';
import CustomerLayout from '@/layouts/CustomerLayout.vue';
import EditorLayout from '@/layouts/EditorLayout.vue';

type LayoutUser = { type: string } | null | undefined;

/**
 * The pages that use the full-viewport EditorLayout (10 §8.2, §9.3, §10.3; 11 and 14 route tables): the plan,
 * import-review and furniture editors, and the admin proposal-item and preset builders.
 * Later editor pages are added here; a page never wraps itself in the layout.
 */
export const EDITOR_PAGES: readonly string[] = [
    'Customer/Plans/Edit',
    'Customer/Imports/Review',
    'Customer/Furniture/Edit',
    'Admin/Plans/Edit',
    'Admin/Furniture/Edit',
    'Admin/Orders/ProposalItemEdit',
    'Admin/Presets/Builder',
];

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

    // Before the area prefixes: editor pages live under `Customer/` and `Admin/`.
    if (EDITOR_PAGES.includes(name)) {
        return EditorLayout;
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
