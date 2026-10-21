import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@inertiajs/vue3', async (importOriginal) => {
    const { page: testPage } = await import('@/test/inertiaPage');
    const { defineComponent: define } = await import('vue');

    return {
        ...(await importOriginal<typeof import('@inertiajs/vue3')>()),
        usePage: () => testPage,
        Head: define({
            name: 'Head',
            props: { title: String },
            render: () => null,
        }),
    };
});

import AdminSecurity from '@/pages/Admin/Account/Security.vue';
import CustomerSecurity from '@/pages/Customer/Account/Security.vue';
import { page, resetPage } from '@/test/inertiaPage';

enableAutoUnmount(afterEach);

const props = {
    hasPassword: true,
    googleLinked: false,
    googleEnabled: true,
    sessions: [],
};

beforeEach(() => {
    resetPage({
        app: { name: 'Furny', logoUrl: null },
        auth: {
            user: {
                type: 'customer',
                phoneE164: '+919876543210',
                phoneVerified: true,
            },
        },
        features: { google_login: true },
        errors: {},
    });
});

/** The sections of the page in the order they are on it. */
function sections(wrapper: ReturnType<typeof mount>): string[] {
    return wrapper.findAll('section h2').map((heading) => heading.text());
}

describe('Customer/Account/Security (10 §13.3)', () => {
    it('has Password, Google, Phone sign-in and Devices, in that order', () => {
        const wrapper = mount(CustomerSecurity, { props });

        expect(sections(wrapper)).toEqual([
            'Password',
            'Google',
            'Phone sign-in',
            'Devices',
        ]);
    });

    it('shows phone sign-in from the signed-in user, with the link to #phone', () => {
        const wrapper = mount(CustomerSecurity, { props });

        expect(wrapper.get('[data-test="phone-signin-status"]').text()).toBe(
            'On: +919876543210',
        );
        expect(
            wrapper.get('[data-test="phone-signin-link"]').attributes('href'),
        ).toBe('/account/profile#phone');
    });

    it('says it is off for a user without a verified phone', () => {
        page.props.auth = {
            user: { type: 'customer', phoneE164: null, phoneVerified: false },
        };

        expect(
            mount(CustomerSecurity, { props })
                .get('[data-test="phone-signin-status"]')
                .text(),
        ).toBe('Off');
    });
});

describe('Admin/Account/Security (11 §18)', () => {
    it('has no phone sign-in: staff sign in with their email', () => {
        page.props.auth = { user: { type: 'staff', roles: ['admin'] } };
        const wrapper = mount(AdminSecurity, { props });

        expect(sections(wrapper)).toEqual(['Password', 'Google', 'Devices']);
        expect(wrapper.find('[data-test="phone-signin-status"]').exists()).toBe(
            false,
        );
    });
});
