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
import InvitationInvalid from '@/pages/Auth/InvitationInvalid.vue';
import { resetPage } from '@/test/inertiaPage';

enableAutoUnmount(afterEach);

function invalid(reason: string) {
    return mount(InvitationInvalid, {
        props: { reason: reason as 'invalid' },
        attachTo: document.body,
    });
}

beforeEach(() => {
    resetPage({ auth: { user: null }, errors: {} });
});

describe('InvitationInvalid (11 §7.1, 13 §5.9)', () => {
    it.each(['invalid', 'expired'])(
        'tells the invitee to ask for a new invitation when the link is %s',
        (reason) => {
            const wrapper = invalid(reason);

            expect(wrapper.get('[data-test="reason-body"]').text()).toBe(
                'This link has expired or is invalid — ask for a new invitation.',
            );
            expect(wrapper.find('[data-test="sign-out-button"]').exists()).toBe(
                false,
            );
            expect(
                wrapper.get('[data-test="login-link"]').attributes('href'),
            ).toBe('/login');
        },
    );

    it('says an accepted invitation was used', () => {
        expect(invalid('accepted').get('h1').text()).toBe(
            'This invitation was already used',
        );
    });

    it('says a revoked invitation was withdrawn', () => {
        expect(invalid('revoked').get('h1').text()).toBe(
            'This invitation was withdrawn',
        );
    });

    it('asks somebody who is signed in to sign out, with a button that posts to logout', () => {
        const wrapper = invalid('signed_in');
        const button = wrapper.get('[data-test="sign-out-button"]');

        expect(wrapper.get('h1').text()).toBe(
            'Sign out to accept the invitation',
        );
        expect(button.text()).toBe('Sign out');
        expect(button.element.tagName).toBe('BUTTON');
        expect(wrapper.find('[data-test="login-link"]').exists()).toBe(false);
    });

    it('has one h1 and sets the document title to it', () => {
        const wrapper = invalid('revoked');

        expect(wrapper.findAll('h1')).toHaveLength(1);
        expect(wrapper.findComponent(Head).props('title')).toBe(
            'This invitation was withdrawn',
        );
    });
});
