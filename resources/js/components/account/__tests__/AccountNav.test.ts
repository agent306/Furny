import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@inertiajs/vue3', async (importOriginal) => {
    const { page: testPage } = await import('@/test/inertiaPage');

    return {
        ...(await importOriginal<typeof import('@inertiajs/vue3')>()),
        usePage: () => testPage,
    };
});

import AccountNav from '@/components/account/AccountNav.vue';
import { page, resetPage } from '@/test/inertiaPage';

enableAutoUnmount(afterEach);

beforeEach(() => {
    resetPage();
});

function labels(wrapper: ReturnType<typeof mount>): string[] {
    return wrapper.findAll('a').map((link) => link.text());
}

describe('AccountNav (10 §13.1, 11 §18)', () => {
    it('lists the customer sections', () => {
        const wrapper = mount(AccountNav, { props: { audience: 'customer' } });

        expect(labels(wrapper)).toEqual(['Profile', 'Security', 'Preferences']);
        expect(
            wrapper.findAll('a').map((link) => link.attributes('href')),
        ).toEqual([
            '/account/profile',
            '/account/security',
            '/account/preferences',
        ]);
    });

    it('lists the staff sections, with the two-factor page of Task 31 between security and preferences', () => {
        const wrapper = mount(AccountNav, { props: { audience: 'admin' } });

        expect(labels(wrapper)).toEqual([
            'Profile',
            'Security',
            'Two-factor',
            'Preferences',
        ]);
        expect(
            wrapper
                .get('[data-test="account-nav-two-factor"]')
                .attributes('href'),
        ).toBe('/admin/account/two-factor');
    });

    it('marks the current section with aria-current="page" and no other', () => {
        page.url = '/account/security';
        const wrapper = mount(AccountNav, { props: { audience: 'customer' } });

        const current = wrapper
            .findAll('a')
            .filter((link) => link.attributes('aria-current') === 'page');

        expect(current).toHaveLength(1);
        expect(current[0]?.text()).toBe('Security');
    });

    it('ignores the query string and marks the staff two-factor page', () => {
        page.url = '/admin/account/two-factor?confirm-password=1';
        const wrapper = mount(AccountNav, { props: { audience: 'admin' } });

        expect(
            wrapper
                .get('[data-test="account-nav-two-factor"]')
                .attributes('aria-current'),
        ).toBe('page');
    });

    it('marks nothing on another page, and is a labelled navigation landmark', () => {
        page.url = '/dashboard';
        const wrapper = mount(AccountNav, { props: { audience: 'customer' } });

        expect(wrapper.find('[aria-current]').exists()).toBe(false);
        expect(wrapper.get('nav').attributes('aria-label')).toBe(
            'Account sections',
        );
    });
});
