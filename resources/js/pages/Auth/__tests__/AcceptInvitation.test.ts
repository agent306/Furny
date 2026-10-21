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
import AcceptInvitation from '@/pages/Auth/AcceptInvitation.vue';
import { page, resetPage } from '@/test/inertiaPage';
import type { FeatureFlags } from '@/types/inertia';

enableAutoUnmount(afterEach);

const features: FeatureFlags = {
    payments: false,
    whatsapp: true,
    sms: true,
    web_push: true,
    google_login: true,
    dxf_import: true,
    walkthrough_camera: true,
    captcha: false,
};

const SIGNED =
    '/staff/invitations/01JZ0000000000000000000001?expires=1&signature=abc';

function accept(props: Record<string, unknown> = {}) {
    return mount(AcceptInvitation, {
        props: {
            invitation: {
                email: 'nina@example.com',
                name: 'Nina Hire',
                roleLabel: 'Estimator',
                expiresAt: '2026-10-23T10:00:00+00:00',
            },
            googleEnabled: true,
            prefillName: null,
            googleConnected: false,
            passwordRules: 'minlength: 8; maxlength: 128;',
            ...props,
        },
        attachTo: document.body,
    });
}

beforeEach(() => {
    resetPage({
        app: { name: 'Furny', logoUrl: null },
        auth: { user: null },
        business: { timezone: 'Asia/Kolkata', locale: 'en-IN' },
        features,
        errors: {},
    });
    page.url = SIGNED;
});

describe('AcceptInvitation (11 §7.1)', () => {
    it('has one h1 naming the app, and sets the document title', () => {
        const wrapper = accept();

        expect(wrapper.findAll('h1')).toHaveLength(1);
        expect(wrapper.get('h1').text()).toBe('Join Furny');
        expect(wrapper.findComponent(Head).props('title')).toBe('Join Furny');
        expect(wrapper.text()).toContain("You've been invited as Estimator.");
    });

    it('posts to its own signed URL', () => {
        const form = accept().get('form');

        expect(form.attributes('action')).toBe(SIGNED);
        expect(form.attributes('method')).toBe('post');
    });

    it('shows the invited email read-only and sends it nowhere', () => {
        const email = accept().get('input#email');

        expect(email.element).toHaveProperty('value', 'nina@example.com');
        expect(email.attributes('readonly')).toBeDefined();
        expect(email.attributes('name')).toBeUndefined();
    });

    it('prefills the name with the invitation, or with the one Google gave', () => {
        expect(accept().get('input[name="name"]').element).toHaveProperty(
            'value',
            'Nina Hire',
        );
        expect(
            accept({ prefillName: 'Nina Google', googleConnected: true }).get(
                'input[name="name"]',
            ).element,
        ).toHaveProperty('value', 'Nina Google');
    });

    it('asks for the password twice, with the rules for the password manager', () => {
        const wrapper = accept();

        for (const name of ['password', 'password_confirmation']) {
            const input = wrapper.get(`input[name="${name}"]`);

            expect(input.attributes('autocomplete')).toBe('new-password');
            expect(input.attributes('required')).toBeDefined();
        }

        expect(
            wrapper.get('input[name="password"]').attributes('passwordrules'),
        ).toBe('minlength: 8; maxlength: 128;');
        expect(wrapper.get('#password-hint').text()).toBe(
            'At least 8 characters.',
        );
    });

    it('offers Continue with Google for the invitation intent', () => {
        const link = accept().get('[data-test="google-button"]');

        expect(link.attributes('href')).toBe(
            '/auth/google/redirect?intent=invitation',
        );
    });

    it('does not offer Google while it is off', () => {
        resetPage({
            app: { name: 'Furny', logoUrl: null },
            auth: { user: null },
            features: { ...features, google_login: false },
            errors: {},
        });
        page.url = SIGNED;

        expect(
            accept({ googleEnabled: false })
                .find('[data-test="google-button"]')
                .exists(),
        ).toBe(false);
    });

    it('says Google is connected instead of offering it again', () => {
        const wrapper = accept({
            googleConnected: true,
            prefillName: 'Nina Google',
        });

        expect(wrapper.find('[data-test="google-button"]').exists()).toBe(
            false,
        );
        expect(wrapper.get('[data-test="google-connected"]').text()).toContain(
            'Your Google account is connected.',
        );
    });

    it('links the terms and the privacy policy in a new tab', () => {
        const caption = accept().get('[data-test="terms-caption"]');

        expect(caption.text()).toBe(
            'By creating your account you accept the Terms of service and the Privacy policy.',
        );
        expect(caption.findAll('a').map((a) => a.attributes('target'))).toEqual(
            ['_blank', '_blank'],
        );
    });

    it('has the submit button', () => {
        expect(accept().get('[data-test="accept-button"]').text()).toBe(
            'Create my account',
        );
    });
});
