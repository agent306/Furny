import { flushPromises, enableAutoUnmount, mount } from '@vue/test-utils';
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

const turnstile = vi.hoisted(() => ({
    render: vi.fn(() => 'widget-1'),
    reset: vi.fn(),
    remove: vi.fn(),
}));

vi.mock('@/lib/turnstile', () => ({
    loadTurnstile: () => Promise.resolve(turnstile),
}));

import { Head } from '@inertiajs/vue3';
import en from '@/lang/generated/en.json';
import Register from '@/pages/Auth/Register.vue';
import { resetPage } from '@/test/inertiaPage';
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

function register(props: Record<string, unknown> = {}) {
    return mount(Register, {
        props: {
            canRegister: true,
            features,
            turnstileSiteKey: null,
            passwordRules: 'minlength: 8; maxlength: 128;',
            ...props,
        },
        attachTo: document.body,
    });
}

beforeEach(() => {
    turnstile.render.mockClear();
    resetPage({ auth: { user: null }, features });
});

describe('Register when registration is closed', () => {
    it('renders only the registration_closed message', () => {
        const wrapper = register({ canRegister: false });

        expect(wrapper.text()).toBe(
            (en as Record<string, string>)['auth_ui.registration_closed'],
        );
        expect(wrapper.find('form').exists()).toBe(false);
        expect(wrapper.find('input').exists()).toBe(false);
        expect(wrapper.find('button').exists()).toBe(false);
        expect(wrapper.find('h1').exists()).toBe(false);
    });
});

describe('Register (10 §4.3)', () => {
    it('has one h1 and sets the document title', () => {
        const wrapper = register();

        expect(wrapper.findAll('h1')).toHaveLength(1);
        expect(wrapper.get('h1').text()).toBe('Create your account');
        expect(wrapper.findComponent(Head).props('title')).toBe(
            'Create your account',
        );
    });

    it('posts the fields of 13 §5.1 to /register', () => {
        const wrapper = register();
        const form = wrapper.get('form');

        expect(form.attributes('action')).toBe('/register');
        expect(form.attributes('method')).toBe('post');

        for (const [name, type, autocomplete] of [
            ['name', 'text', 'name'],
            ['email', 'email', 'email'],
            ['password', 'password', 'new-password'],
            ['password_confirmation', 'password', 'new-password'],
        ] as const) {
            const input = wrapper.get(`input[name="${name}"]`);

            expect(input.attributes('type')).toBe(type);
            expect(input.attributes('autocomplete')).toBe(autocomplete);
            expect(wrapper.find(`label[for="${name}"]`).exists()).toBe(true);
        }
    });

    it('gives the password manager the rules and the user the minimum', () => {
        const wrapper = register();

        expect(
            wrapper.get('input[name="password"]').attributes('passwordrules'),
        ).toBe('minlength: 8; maxlength: 128;');
        expect(wrapper.get('#password-hint').text()).toBe(
            'At least 8 characters.',
        );
        expect(
            wrapper
                .get('input[name="password"]')
                .attributes('aria-describedby'),
        ).toBe('password-hint');
        expect(
            register({ passwordRules: 'minlength: 10; maxlength: 128;' })
                .get('#password-hint')
                .text(),
        ).toBe('At least 10 characters.');
    });

    it('has the terms box unticked, with the two documents linked in a new tab', () => {
        const wrapper = register();
        const terms = wrapper.get('#terms');
        const label = wrapper.get('label[for="terms"]');

        expect(terms.attributes('aria-checked')).toBe('false');
        expect(label.text()).toBe(
            'I accept the Terms of service and the Privacy policy',
        );

        for (const [href, text] of [
            ['/terms', 'Terms of service'],
            ['/privacy', 'Privacy policy'],
        ]) {
            const link = label.get(`a[href="${href}"]`);

            expect(link.text()).toBe(text);
            expect(link.attributes('target')).toBe('_blank');
            expect(link.attributes('rel')).toContain('noopener');
        }
    });

    it('has the marketing box unticked', () => {
        const wrapper = register();

        expect(
            wrapper.get('#marketing_opt_in').attributes('aria-checked'),
        ).toBe('false');
        expect(wrapper.get('label[for="marketing_opt_in"]').text()).toBe(
            'Send me occasional updates and offers',
        );
        expect(
            new FormData(wrapper.get('form').element).get('marketing_opt_in'),
        ).toBeNull();
    });

    it('links to the login page', () => {
        const wrapper = register();

        expect(wrapper.get('a[href="/login"]').text()).toBe('Log in');
        expect(wrapper.text()).toContain('Already have an account?');
    });

    it('has a submit button and no phone or Google buttons yet', () => {
        const wrapper = register();

        expect(wrapper.get('[data-test="register-button"]').text()).toBe(
            'Create account',
        );
        expect(wrapper.findAll('button[type="submit"]')).toHaveLength(1);
    });
});

describe('Register and the captcha', () => {
    it('renders no Turnstile widget while features.captcha is off', async () => {
        const wrapper = register({ turnstileSiteKey: null });
        await flushPromises();

        expect(wrapper.find('[data-test="turnstile"]').exists()).toBe(false);
        expect(turnstile.render).not.toHaveBeenCalled();
    });

    it('renders the Turnstile widget for the register form while features.captcha is on', async () => {
        resetPage({
            auth: { user: null },
            features: { ...features, captcha: true },
        });

        const wrapper = register({ turnstileSiteKey: 'site-key' });
        await flushPromises();

        expect(wrapper.find('[data-test="turnstile"]').exists()).toBe(true);
        expect(
            wrapper
                .get('input[name="cf_turnstile_response"]')
                .attributes('type'),
        ).toBe('hidden');
        expect(turnstile.render).toHaveBeenCalledWith(
            expect.any(HTMLElement),
            expect.objectContaining({
                sitekey: 'site-key',
                action: 'register',
            }),
        );
    });
});
