import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@inertiajs/vue3', async (importOriginal) => {
    const { page: testPage } = await import('@/test/inertiaPage');

    return {
        ...(await importOriginal<typeof import('@inertiajs/vue3')>()),
        usePage: () => testPage,
    };
});

import PhoneSignInCard from '@/components/account/PhoneSignInCard.vue';

enableAutoUnmount(afterEach);

describe('PhoneSignInCard (10 §13.3)', () => {
    it('says phone sign-in is on, with the number, when the phone is verified', () => {
        const wrapper = mount(PhoneSignInCard, {
            props: { phone: '+919876543210', verified: true },
        });

        expect(wrapper.get('[data-test="phone-signin-status"]').text()).toBe(
            'On: +919876543210',
        );
    });

    it('says it is off for a number nobody verified, and for no number', () => {
        const cases: { phone: string | null; verified: boolean }[] = [
            { phone: '+919876543210', verified: false },
            { phone: null, verified: false },
        ];

        for (const props of cases) {
            const wrapper = mount(PhoneSignInCard, { props });

            expect(
                wrapper.get('[data-test="phone-signin-status"]').text(),
            ).toBe('Off');
        }
    });

    it('links to the phone section of the profile', () => {
        const link = mount(PhoneSignInCard, {
            props: { phone: null, verified: false },
        }).get('a');

        expect(link.attributes('href')).toBe('/account/profile#phone');
        expect(link.text()).toBe('Manage your phone number');
    });
});
