import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@inertiajs/vue3', async (importOriginal) => {
    const { page: testPage } = await import('@/test/inertiaPage');

    return {
        ...(await importOriginal<typeof import('@inertiajs/vue3')>()),
        usePage: () => testPage,
    };
});

import ProfileForm from '@/components/account/ProfileForm.vue';
import type { AuthUserData } from '@/types';
import { resetPage } from '@/test/inertiaPage';

enableAutoUnmount(afterEach);

beforeEach(() => {
    resetPage({ app: { name: 'Furny', logoUrl: null }, errors: {} });
});

function form() {
    return mount(ProfileForm, {
        props: {
            audience: 'customer',
            user: {
                id: '1',
                name: 'Asha Rao',
                email: 'asha@example.test',
                emailVerified: true,
                phoneE164: null,
                phoneVerified: false,
                avatarUrl: null,
            } as AuthUserData,
            marketingOptIn: false,
            otpChannels: ['sms'],
        },
        attachTo: document.body,
    });
}

describe('ProfileForm email field (10 §13.2)', () => {
    it('is described by nothing while no hint is shown', () => {
        const wrapper = form();

        expect(wrapper.find('#email-hint').exists()).toBe(false);
        expect(wrapper.get('#email').attributes('aria-describedby')).toBe(
            undefined,
        );
    });

    it('is described by the hint once the address changed, and the hint is there', async () => {
        const wrapper = form();

        await wrapper.get('#email').setValue('new@example.test');
        await flushPromises();

        expect(wrapper.get('#email-hint').text()).toBe(
            "We'll send a verification link to the new address.",
        );
        expect(wrapper.get('#email').attributes('aria-describedby')).toBe(
            'email-hint',
        );
    });
});
