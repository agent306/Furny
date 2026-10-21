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

import { Head } from '@inertiajs/vue3';
import AccountDeletionScheduled from '@/pages/Auth/AccountDeletionScheduled.vue';
import { resetPage } from '@/test/inertiaPage';

enableAutoUnmount(afterEach);

beforeEach(() => {
    resetPage({
        app: { name: 'Furny', logoUrl: null },
        auth: { user: null },
        business: {
            name: 'Acme Woodworks',
            locale: 'en-IN',
            timezone: 'Asia/Kolkata',
        },
        errors: {},
    });
});

describe('AccountDeletionScheduled (13 §9.1)', () => {
    it('names the anonymisation date and the support email', () => {
        const wrapper = mount(AccountDeletionScheduled, {
            props: {
                anonymiseOn: '2026-11-21',
                supportEmail: 'hello@acme.test',
            },
        });

        expect(wrapper.get('h1').text()).toBe(
            'Your account is scheduled for deletion',
        );
        expect(wrapper.get('[data-test="deleted-body"]').text()).toContain(
            '21',
        );
        expect(wrapper.get('[data-test="deleted-body"]').text()).toContain(
            '2026',
        );
        expect(wrapper.get('[data-test="deleted-restore"]').text()).toContain(
            'hello@acme.test',
        );
    });

    it('says it is 30 days after the request when opened without a date', () => {
        const wrapper = mount(AccountDeletionScheduled, {
            props: { anonymiseOn: null, supportEmail: 'hello@acme.test' },
        });

        expect(wrapper.get('[data-test="deleted-body"]').text()).toContain(
            '30 days after the request',
        );
    });

    it('links back to the home page, has one h1 and sets the document title', () => {
        const wrapper = mount(AccountDeletionScheduled, {
            props: { anonymiseOn: null, supportEmail: 'hello@acme.test' },
        });

        expect(wrapper.get('[data-test="home-link"]').attributes('href')).toBe(
            '/',
        );
        expect(wrapper.findAll('h1')).toHaveLength(1);
        expect(wrapper.findComponent(Head).props('title')).toBe(
            'Your account is scheduled for deletion',
        );
    });
});
