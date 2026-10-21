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
import Login from '@/pages/Auth/Login.vue';
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

function login(props: Record<string, unknown> = {}) {
    return mount(Login, {
        props: {
            status: null,
            canResetPassword: true,
            canRegister: true,
            features,
            turnstileSiteKey: null,
            ...props,
        },
        attachTo: document.body,
    });
}

beforeEach(() => {
    resetPage({ auth: { user: null }, features });
});

describe('Login (10 §4.2)', () => {
    it('has one h1 and sets the document title', () => {
        const wrapper = login();

        expect(wrapper.findAll('h1')).toHaveLength(1);
        expect(wrapper.get('h1').text()).toBe('Log in');
        expect(wrapper.findComponent(Head).props('title')).toBe('Log in');
    });

    it('posts to /login with an email field for password managers and a password field', () => {
        const wrapper = login();
        const form = wrapper.get('form');
        const email = wrapper.get('input[name="email"]');
        const password = wrapper.get('input[name="password"]');

        expect(form.attributes('action')).toBe('/login');
        expect(form.attributes('method')).toBe('post');
        expect(email.attributes('type')).toBe('email');
        expect(email.attributes('autocomplete')).toBe('username');
        expect(password.attributes('type')).toBe('password');
        expect(password.attributes('autocomplete')).toBe('current-password');
        expect(wrapper.get('label[for="email"]').text()).toBe(
            'Email address *',
        );
        expect(wrapper.get('label[for="password"]').text()).toBe('Password *');
    });

    it('shows "Keep me signed in" checked by default', () => {
        const wrapper = login();
        const remember = wrapper.get('#remember');

        expect(remember.attributes('role')).toBe('checkbox');
        expect(remember.attributes('aria-checked')).toBe('true');
        expect(remember.attributes('data-state')).toBe('checked');
        expect(wrapper.get('label[for="remember"]').text()).toBe(
            'Keep me signed in for 14 days',
        );
    });

    it('sends remember with the form while the box is ticked', async () => {
        const wrapper = login();
        await wrapper.vm.$nextTick();
        const data = new FormData(wrapper.get('form').element);

        expect(data.get('remember')).toBe('on');
    });

    it('shows and hides the password', async () => {
        const wrapper = login();
        const toggle = wrapper.get('button[aria-pressed]');

        expect(toggle.attributes('aria-label')).toBe('Show password');

        await toggle.trigger('click');

        expect(wrapper.get('input[name="password"]').attributes('type')).toBe(
            'text',
        );
        expect(toggle.attributes('aria-label')).toBe('Hide password');
        expect(toggle.attributes('aria-pressed')).toBe('true');
    });

    it('links to the password reset and to registration', () => {
        const wrapper = login();

        expect(wrapper.get('a[href="/forgot-password"]').text()).toBe(
            'Forgot password?',
        );
        expect(wrapper.get('a[href="/register"]').text()).toBe(
            'Create an account',
        );
        expect(wrapper.text()).toContain('New here?');
    });

    it('hides the links that are not available', () => {
        const wrapper = login({ canResetPassword: false, canRegister: false });

        expect(wrapper.find('a[href="/forgot-password"]').exists()).toBe(false);
        expect(wrapper.find('a[href="/register"]').exists()).toBe(false);
        expect(wrapper.text()).not.toContain('New here?');
    });

    it('offers Google under the form, with its terms caption', () => {
        const wrapper = login();

        expect(
            wrapper.get('a[data-test="google-button"]').attributes('href'),
        ).toBe('/auth/google/redirect?intent=login');
        expect(wrapper.find('[data-test="google-separator"]').exists()).toBe(
            true,
        );
        expect(wrapper.get('[data-test="google-caption"]').text()).toContain(
            'By continuing you accept the',
        );
        expect(wrapper.findAll('button[type="submit"]')).toHaveLength(1);
    });

    it('has no Google button while the feature is off', () => {
        resetPage({
            auth: { user: null },
            features: { ...features, google_login: false },
        });
        const wrapper = login({
            features: { ...features, google_login: false },
        });

        expect(wrapper.find('[data-test="google-sign-in"]').exists()).toBe(
            false,
        );
        // The way to the password reset, the registration and the phone.
        expect(
            wrapper.findAll('a').map((link) => link.attributes('href')),
        ).toEqual(['/forgot-password', '/login/phone', '/register']);
    });

    it('offers the phone sign-in under the form while a code can be sent by WhatsApp or SMS', () => {
        const wrapper = login();
        const phone = wrapper.get('a[data-test="phone-button"]');

        expect(phone.attributes('href')).toBe('/login/phone');
        expect(phone.text()).toBe('Use my phone instead');
        expect(wrapper.find('[data-test="google-separator"]').exists()).toBe(
            true,
        );
    });

    it.each([
        ['neither is on', { whatsapp: false, sms: false }, false],
        ['only WhatsApp is on', { whatsapp: true, sms: false }, true],
        ['only SMS is on', { whatsapp: false, sms: true }, true],
    ])('has the phone button when %s: %s', (_name, flags, shown) => {
        resetPage({
            auth: { user: null },
            features: { ...features, ...flags },
        });

        expect(
            login({ features: { ...features, ...flags } })
                .find('a[data-test="phone-button"]')
                .exists(),
        ).toBe(shown);
    });

    it('has no "or" line when there is nothing under the form', () => {
        const none = {
            ...features,
            whatsapp: false,
            sms: false,
            google_login: false,
        };
        resetPage({ auth: { user: null }, features: none });

        expect(
            login({ features: none })
                .find('[data-test="alternative-sign-in"]')
                .exists(),
        ).toBe(false);
    });

    it('shows the status message of the session', () => {
        const wrapper = login({ status: 'Your password has been reset.' });

        expect(wrapper.get('[data-test="login-status"]').text()).toBe(
            'Your password has been reset.',
        );
        expect(login().find('[data-test="login-status"]').exists()).toBe(false);
    });

    it('has a submit button and no captcha', () => {
        const wrapper = login();

        expect(wrapper.get('[data-test="login-button"]').text()).toBe('Log in');
        expect(wrapper.find('[data-test="turnstile"]').exists()).toBe(false);
    });
});
