import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
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

import { router } from '@inertiajs/vue3';
import Delete from '@/pages/Customer/Account/Delete.vue';
import { resetPage } from '@/test/inertiaPage';

enableAutoUnmount(afterEach);

const visit = vi.spyOn(router, 'visit').mockImplementation(() => undefined);

beforeEach(() => {
    visit.mockClear();
    resetPage({
        app: { name: 'Furny', logoUrl: null },
        auth: { user: { type: 'customer' } },
        errors: {},
    });
});

describe('Customer/Account/Delete (10 §13.7)', () => {
    it('offers the download as a plain link to the export', () => {
        const wrapper = mount(Delete, {
            props: { activeOrders: [], canExport: true },
        });

        const link = wrapper.get('[data-test="export-link"]');
        expect(link.attributes('href')).toBe('/account/export');
        expect(link.element.tagName).toBe('A');
        expect(wrapper.find('[data-test="export-unverified"]').exists()).toBe(
            false,
        );
    });

    it('explains that the download needs a verified contact, with a link to verify', () => {
        const wrapper = mount(Delete, {
            props: { activeOrders: [], canExport: false },
        });

        expect(wrapper.find('[data-test="export-link"]').exists()).toBe(false);
        expect(wrapper.get('[data-test="export-unverified"]').text()).toContain(
            'Verify your email or phone number to continue.',
        );
        expect(
            wrapper.get('[data-test="export-verify"]').attributes('href'),
        ).toBe('/account/profile');
    });

    it('asks to type the translated word and posts it to the deletion route', async () => {
        const wrapper = mount(Delete, {
            props: { activeOrders: [], canExport: true },
        });

        expect(wrapper.get('label[for="confirmation"]').text()).toBe(
            'Type DELETE to confirm',
        );

        await wrapper.get('input#confirmation').setValue('DELETE');
        await wrapper.get('[data-test="delete-form"]').trigger('submit');
        await flushPromises();

        expect(visit).toHaveBeenCalledTimes(1);
        expect(visit.mock.calls[0]?.[0]).toBe('/account');
        expect(visit.mock.calls[0]?.[1]).toMatchObject({
            method: 'delete',
            data: { confirmation: 'DELETE' },
        });
        expect(wrapper.get('[data-test="delete-submit"]').text()).toBe(
            'Delete my account',
        );
    });

    it('lists the Active orders instead of the form, as numbers', () => {
        const wrapper = mount(Delete, {
            props: {
                activeOrders: [
                    { id: '01A', number: 'ORD-2026-00012' },
                    { id: '01B', number: 'ORD-2026-00015' },
                ],
                canExport: true,
            },
        });

        expect(
            wrapper
                .findAll('[data-test="active-order"]')
                .map((item) => item.text()),
        ).toEqual(['ORD-2026-00012', 'ORD-2026-00015']);
        expect(wrapper.get('[data-test="active-orders"]').text()).toContain(
            'Finish or cancel these orders first:',
        );
        expect(wrapper.find('[data-test="delete-form"]').exists()).toBe(false);
    });

    it('says what is kept, what is deleted and that there are 30 days to change one’s mind', () => {
        const text = mount(Delete, {
            props: { activeOrders: [], canExport: true },
        }).text();

        expect(text).toContain('We keep your orders and quotes');
        expect(text).toContain('We delete your sign-in details');
        expect(text).toContain('For 30 days we can restore the account');
    });

    it('has the account navigation with the page marked as current', () => {
        const wrapper = mount(Delete, {
            props: { activeOrders: [], canExport: true },
        });

        expect(wrapper.get('[data-test="account-nav-delete"]').text()).toBe(
            'Delete account',
        );
    });
});
