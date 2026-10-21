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
import ConfirmPassword from '@/pages/Auth/ConfirmPassword.vue';
import ForgotPassword from '@/pages/Auth/ForgotPassword.vue';
import ResetPassword from '@/pages/Auth/ResetPassword.vue';
import VerifyEmail from '@/pages/Auth/VerifyEmail.vue';
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

const authProps = { canRegister: true, features, turnstileSiteKey: null };

beforeEach(() => {
    resetPage({ auth: { user: { type: 'customer' } }, features });
});

describe('ForgotPassword (10 §4.5)', () => {
    function forgot(props: Record<string, unknown> = {}) {
        return mount(ForgotPassword, {
            props: { status: null, ...authProps, ...props },
            attachTo: document.body,
        });
    }

    it('has one h1 and sets the document title', () => {
        const wrapper = forgot();

        expect(wrapper.findAll('h1')).toHaveLength(1);
        expect(wrapper.get('h1').text()).toBe('Forgot your password?');
        expect(wrapper.findComponent(Head).props('title')).toBe(
            'Forgot your password?',
        );
    });

    it('posts the email to /forgot-password, marked required', () => {
        const wrapper = forgot();
        const form = wrapper.get('form');
        const email = wrapper.get('input[name="email"]');

        expect(form.attributes('action')).toBe('/forgot-password');
        expect(form.attributes('method')).toBe('post');
        expect(email.attributes('type')).toBe('email');
        expect(email.attributes('autocomplete')).toBe('email');
        expect(email.attributes('aria-required')).toBe('true');
        expect(wrapper.get('label[for="email"]').text()).toBe(
            'Email address *',
        );
        expect(wrapper.get('[data-test="forgot-button"]').text()).toBe(
            'Email reset link',
        );
    });

    it('shows the one sentence the server answers with', () => {
        const sentence =
            "If an account exists for that email, we've sent a reset link.";

        expect(
            forgot({ status: sentence })
                .get('[data-test="forgot-status"]')
                .text(),
        ).toBe(sentence);
        expect(forgot().find('[data-test="forgot-status"]').exists()).toBe(
            false,
        );
    });

    it('links back to the login page', () => {
        expect(forgot().get('a[href="/login"]').text()).toBe('Back to log in');
    });

    it('has no captcha while it is off', () => {
        expect(forgot().find('[data-test="turnstile"]').exists()).toBe(false);
    });
});

describe('ResetPassword (10 §4.5)', () => {
    function reset(props: Record<string, unknown> = {}) {
        return mount(ResetPassword, {
            props: {
                email: 'asha@example.com',
                token: 'the-token',
                passwordRules: 'minlength: 8; maxlength: 128;',
                ...authProps,
                ...props,
            },
            attachTo: document.body,
        });
    }

    it('has one h1 and sets the document title', () => {
        const wrapper = reset();

        expect(wrapper.findAll('h1')).toHaveLength(1);
        expect(wrapper.get('h1').text()).toBe('Choose a new password');
        expect(wrapper.findComponent(Head).props('title')).toBe(
            'Choose a new password',
        );
    });

    it('posts to /reset-password with the email read-only and two new-password fields', () => {
        const wrapper = reset();
        const email = wrapper.get('input[name="email"]');
        const password = wrapper.get('input[name="password"]');
        const confirmation = wrapper.get('input[name="password_confirmation"]');

        expect(wrapper.get('form').attributes('action')).toBe(
            '/reset-password',
        );
        expect(wrapper.get('form').attributes('method')).toBe('post');
        expect((email.element as HTMLInputElement).value).toBe(
            'asha@example.com',
        );
        expect(email.attributes('readonly')).toBeDefined();
        expect(password.attributes('autocomplete')).toBe('new-password');
        expect(password.attributes('passwordrules')).toBe(
            'minlength: 8; maxlength: 128;',
        );
        expect(confirmation.attributes('autocomplete')).toBe('new-password');
        expect(wrapper.get('label[for="password"]').text()).toBe(
            'New password *',
        );
        expect(wrapper.get('label[for="password_confirmation"]').text()).toBe(
            'Confirm new password *',
        );
    });

    it('hints at the minimum length and points the field at the hint', () => {
        const wrapper = reset();

        expect(wrapper.get('#password-hint').text()).toBe(
            'At least 8 characters.',
        );
        expect(wrapper.get('#password').attributes('aria-describedby')).toBe(
            'password-hint',
        );
    });

    it('does not offer a new link until the old one failed', () => {
        expect(reset().find('[data-test="request-new-link"]').exists()).toBe(
            false,
        );
    });

    it('has a submit button', () => {
        expect(reset().get('[data-test="reset-password-button"]').text()).toBe(
            'Reset password',
        );
    });
});

describe('VerifyEmail (10 §4.6)', () => {
    function verify(props: Record<string, unknown> = {}) {
        return mount(VerifyEmail, {
            props: {
                status: null,
                email: 'asha@example.com',
                ...authProps,
                ...props,
            },
            attachTo: document.body,
        });
    }

    it('says where the link was sent', () => {
        const wrapper = verify();

        expect(wrapper.findAll('h1')).toHaveLength(1);
        expect(wrapper.get('h1').text()).toBe('Verify your email');
        expect(wrapper.text()).toContain(
            'We sent a verification link to asha@example.com.',
        );
        expect(wrapper.findComponent(Head).props('title')).toBe(
            'Verify your email',
        );
    });

    it('resends through the verification-notification route', () => {
        const wrapper = verify();

        expect(wrapper.get('form').attributes('action')).toBe(
            '/email/verification-notification',
        );
        expect(wrapper.get('form').attributes('method')).toBe('post');
        expect(wrapper.get('[data-test="resend-button"]').text()).toBe(
            'Resend email',
        );
    });

    it('confirms a resend, and only then', () => {
        expect(
            verify({ status: 'verification-link-sent' })
                .get('[data-test="verify-status"]')
                .text(),
        ).toBe('A new verification link is on its way to asha@example.com.');
        expect(verify().find('[data-test="verify-status"]').exists()).toBe(
            false,
        );
    });

    it('lets a customer on to the app, a staff member to the admin', () => {
        expect(
            verify().get('[data-test="continue-link"]').attributes('href'),
        ).toBe('/dashboard');

        page.props = { auth: { user: { type: 'staff' } }, features };

        expect(
            verify().get('[data-test="continue-link"]').attributes('href'),
        ).toBe('/admin');
    });

    it('offers to log out', () => {
        expect(verify().get('[data-test="logout-button"]').text()).toBe(
            'Log out',
        );
    });

    it('shows the wait after too many resends, and holds the button back', () => {
        page.props = {
            auth: { user: { type: 'customer' } },
            features,
            errors: { rate_limited: '120' },
        };
        const wrapper = verify();

        expect(wrapper.get('[data-test="throttle-notice"]').text()).toContain(
            'Try again in 120 seconds.',
        );
        expect(
            wrapper.get('[data-test="resend-button"]').attributes('disabled'),
        ).toBeDefined();
    });
});

describe('ConfirmPassword (10 §4.8)', () => {
    function confirm() {
        return mount(ConfirmPassword, {
            props: authProps,
            attachTo: document.body,
        });
    }

    it('has one h1 and sets the document title', () => {
        const wrapper = confirm();

        expect(wrapper.findAll('h1')).toHaveLength(1);
        expect(wrapper.get('h1').text()).toBe('Confirm your password');
        expect(wrapper.findComponent(Head).props('title')).toBe(
            'Confirm your password',
        );
    });

    it('posts the password to the confirmation route', () => {
        const wrapper = confirm();
        const password = wrapper.get('input[name="password"]');

        expect(wrapper.get('form').attributes('action')).toBe(
            '/user/confirm-password',
        );
        expect(wrapper.get('form').attributes('method')).toBe('post');
        expect(password.attributes('type')).toBe('password');
        expect(password.attributes('autocomplete')).toBe('current-password');
        expect(password.attributes('aria-required')).toBe('true');
        expect(wrapper.get('label[for="password"]').text()).toBe('Password *');
        expect(
            wrapper.get('[data-test="confirm-password-button"]').text(),
        ).toBe('Confirm');
    });
});
