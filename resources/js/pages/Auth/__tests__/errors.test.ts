import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';

// A stand-in for the Inertia <Form>: it hands the slot `errors` we set, and emits `error` when we say so, which is
// what the real component does after a response with validation errors.
vi.mock('@inertiajs/vue3', async (importOriginal) => {
    const { page: testPage } = await import('@/test/inertiaPage');
    const { defineComponent: define, h, reactive } = await import('vue');

    return {
        ...(await importOriginal<typeof import('@inertiajs/vue3')>()),
        usePage: () => testPage,
        Head: define({
            name: 'Head',
            props: { title: String },
            render: () => null,
        }),
        Form: define({
            name: 'Form',
            emits: ['error'],
            setup(_, { slots, expose }) {
                const errors = reactive<Record<string, string>>({});

                expose({
                    fail(next: Record<string, string>) {
                        Object.assign(errors, next);
                    },
                });

                return () =>
                    h('form', slots.default?.({ errors, processing: false }));
            },
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

import { Form } from '@inertiajs/vue3';
import ConfirmPassword from '@/pages/Auth/ConfirmPassword.vue';
import ForgotPassword from '@/pages/Auth/ForgotPassword.vue';
import Login from '@/pages/Auth/Login.vue';
import Register from '@/pages/Auth/Register.vue';
import ResetPassword from '@/pages/Auth/ResetPassword.vue';
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

const loginProps = {
    status: null,
    canResetPassword: true,
    canRegister: true,
    features,
    turnstileSiteKey: null,
};
const registerProps = {
    canRegister: true,
    features,
    turnstileSiteKey: null,
    passwordRules: 'minlength: 8; maxlength: 128;',
};

const recoveryProps = { canRegister: true, features, turnstileSiteKey: null };

type FailingForm = { fail: (errors: Record<string, string>) => void };

/** What the Inertia form does after a response with errors: set them, then tell the page. */
async function fail(
    wrapper: ReturnType<typeof mount>,
    errors: Record<string, string>,
) {
    const form = wrapper.findComponent(Form);

    (form.vm as unknown as FailingForm).fail(errors);
    form.vm.$emit('error', errors);
    await flushPromises();
}

beforeEach(() => {
    turnstile.reset.mockClear();
    window.turnstile = turnstile;
    resetPage({ auth: { user: null }, features });
});

describe('Login after a failed submit (15 §10.1)', () => {
    it('focuses the first invalid field and marks it', async () => {
        const wrapper = mount(Login, {
            props: loginProps,
            attachTo: document.body,
        });

        await fail(wrapper, { email: 'These credentials do not match.' });

        const email = wrapper.get('#email');

        expect(email.attributes('aria-invalid')).toBe('true');
        expect(email.attributes('aria-describedby')).toBe('email-error');
        expect(document.activeElement).toBe(email.element);
        expect(wrapper.get('#email-error').text()).toBe(
            'These credentials do not match.',
        );
    });

    it('focuses the first of several invalid fields, in page order', async () => {
        const wrapper = mount(Login, {
            props: loginProps,
            attachTo: document.body,
        });

        await fail(wrapper, { password: 'Required.', email: 'Required.' });

        expect(document.activeElement).toBe(wrapper.get('#email').element);
    });
});

describe('Register after a failed submit (15 §10.1)', () => {
    it('focuses the first invalid field and gets a new captcha token', async () => {
        const wrapper = mount(Register, {
            props: registerProps,
            attachTo: document.body,
        });

        await fail(wrapper, {
            email: 'This email can not be used.',
            terms: 'Accept the terms.',
        });

        expect(document.activeElement).toBe(wrapper.get('#email').element);
        expect(wrapper.get('#terms').attributes('aria-invalid')).toBe('true');
    });

    it('resets the Turnstile widget', async () => {
        resetPage({
            auth: { user: null },
            features: { ...features, captcha: true },
        });
        const wrapper = mount(Register, {
            props: { ...registerProps, turnstileSiteKey: 'site-key' },
            attachTo: document.body,
        });
        await flushPromises();

        await fail(wrapper, { name: 'Required.' });

        expect(turnstile.reset).toHaveBeenCalledWith('widget-1');
        expect(document.activeElement).toBe(wrapper.get('#name').element);
    });

    it('describes the password field by the hint, and by its error when it has one', async () => {
        const wrapper = mount(Register, {
            props: registerProps,
            attachTo: document.body,
        });

        expect(wrapper.get('#password').attributes('aria-describedby')).toBe(
            'password-hint',
        );

        await fail(wrapper, { password: 'Too short.' });

        expect(wrapper.get('#password').attributes('aria-describedby')).toBe(
            'password-error password-hint',
        );
        expect(wrapper.find('#password-error').exists()).toBe(true);
        expect(wrapper.find('#password-hint').exists()).toBe(true);
    });

    it('does not point at a hint that is not there', () => {
        const wrapper = mount(Register, {
            props: { ...registerProps, passwordRules: '' },
            attachTo: document.body,
        });

        expect(wrapper.find('#password-hint').exists()).toBe(false);
        expect(
            wrapper.get('#password').attributes('aria-describedby'),
        ).toBeUndefined();
    });

    it('links the captcha error to the widget', async () => {
        resetPage({
            auth: { user: null },
            features: { ...features, captcha: true },
        });
        const wrapper = mount(Register, {
            props: { ...registerProps, turnstileSiteKey: 'site-key' },
            attachTo: document.body,
        });
        await flushPromises();

        expect(
            wrapper
                .get('[data-test="turnstile"]')
                .attributes('aria-describedby'),
        ).toBeUndefined();

        await fail(wrapper, { cf_turnstile_response: 'Not confirmed.' });

        const widget = wrapper.get('[data-test="turnstile"]');
        const describedBy = widget.attributes('aria-describedby');

        expect(describedBy).toBe('captcha-error');
        expect(wrapper.get(`#${describedBy}`).text()).toBe('Not confirmed.');
        expect(widget.attributes('role')).toBe('group');
        expect(widget.attributes('aria-label')).toBe(
            'Check that you are human',
        );
    });
});

describe('required fields (15 §10.1)', () => {
    it('marks the required fields of the login form with a visual asterisk', () => {
        const wrapper = mount(Login, {
            props: loginProps,
            attachTo: document.body,
        });

        for (const id of ['email', 'password']) {
            const label = wrapper.get(`label[for="${id}"]`);

            expect(label.get('[aria-hidden="true"]').text()).toBe('*');
            expect(wrapper.get(`#${id}`).attributes('aria-required')).toBe(
                'true',
            );
        }

        expect(wrapper.get('label[for="remember"]').text()).not.toContain('*');
    });

    it('marks the required fields of the registration form, not the marketing choice', () => {
        const wrapper = mount(Register, {
            props: registerProps,
            attachTo: document.body,
        });

        for (const id of [
            'name',
            'email',
            'password',
            'password_confirmation',
            'terms',
        ]) {
            expect(
                wrapper.get(`label[for="${id}"] [aria-hidden="true"]`).text(),
            ).toBe('*');
        }

        expect(
            wrapper.get('label[for="marketing_opt_in"]').text(),
        ).not.toContain('*');
    });
});

describe('too many attempts (10 §4)', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it.each([
        [
            'Login',
            () => mount(Login, { props: loginProps, attachTo: document.body }),
            'login-button',
        ],
        [
            'Register',
            () =>
                mount(Register, {
                    props: registerProps,
                    attachTo: document.body,
                }),
            'register-button',
        ],
    ])(
        '%s shows the wait as a countdown, disables the button, and enables it at zero',
        async (_name, mountPage, button) => {
            page.props = {
                auth: { user: null },
                features,
                errors: { rate_limited: '3' },
            };

            const wrapper = mountPage();
            const notice = '[data-test="throttle-notice"]';

            expect(wrapper.get(notice).text()).toContain(
                'Too many attempts. Try again in 3 seconds.',
            );
            expect(
                wrapper.get(`[data-test="${button}"]`).attributes('disabled'),
            ).toBeDefined();

            await vi.advanceTimersByTimeAsync(1000);
            await nextTick();

            expect(wrapper.get(notice).text()).toContain('in 2 seconds');

            await vi.advanceTimersByTimeAsync(2000);
            await nextTick();

            expect(wrapper.find(notice).exists()).toBe(false);
            expect(
                wrapper.get(`[data-test="${button}"]`).attributes('disabled'),
            ).toBeUndefined();
        },
    );

    it('shows nothing without a refusal', () => {
        const wrapper = mount(Login, {
            props: loginProps,
            attachTo: document.body,
        });

        expect(wrapper.find('[data-test="throttle-notice"]').exists()).toBe(
            false,
        );
    });
});

describe('ForgotPassword after a failed submit (15 §10.1)', () => {
    it('focuses the email field', async () => {
        const wrapper = mount(ForgotPassword, {
            props: { status: null, ...recoveryProps },
            attachTo: document.body,
        });

        await fail(wrapper, { email: 'Enter a valid email address.' });

        expect(document.activeElement).toBe(wrapper.get('#email').element);
        expect(wrapper.get('#email').attributes('aria-describedby')).toBe(
            'email-error',
        );
    });

    it('resets the Turnstile widget and links the captcha error to it', async () => {
        resetPage({
            auth: { user: null },
            features: { ...features, captcha: true },
        });
        const wrapper = mount(ForgotPassword, {
            props: {
                status: null,
                ...recoveryProps,
                turnstileSiteKey: 'site-key',
            },
            attachTo: document.body,
        });
        await flushPromises();

        await fail(wrapper, { cf_turnstile_response: 'Not confirmed.' });

        expect(turnstile.reset).toHaveBeenCalledWith('widget-1');
        expect(wrapper.get('#captcha-error').text()).toBe('Not confirmed.');
    });
});

describe('ResetPassword after a failed submit (15 §10.1)', () => {
    const props = {
        email: 'asha@example.com',
        token: 'the-token',
        passwordRules: 'minlength: 8; maxlength: 128;',
        ...recoveryProps,
    };

    it('focuses the password field and describes it by the error and the hint', async () => {
        const wrapper = mount(ResetPassword, {
            props,
            attachTo: document.body,
        });

        await fail(wrapper, { password: 'Too short.' });

        expect(document.activeElement).toBe(wrapper.get('#password').element);
        expect(wrapper.get('#password').attributes('aria-describedby')).toBe(
            'password-error password-hint',
        );
    });

    it('shows a used-up link as an error of the email, with the way to ask again', async () => {
        const wrapper = mount(ResetPassword, {
            props,
            attachTo: document.body,
        });

        await fail(wrapper, { email: 'This password reset token is invalid.' });

        expect(wrapper.get('#email-error').text()).toBe(
            'This password reset token is invalid.',
        );
        expect(
            wrapper.get('[data-test="request-new-link"]').attributes('href'),
        ).toBe('/forgot-password');
        expect(document.activeElement).toBe(wrapper.get('#email').element);
    });
});

describe('ConfirmPassword after a failed submit (15 §10.1)', () => {
    it('focuses the password field', async () => {
        const wrapper = mount(ConfirmPassword, {
            props: recoveryProps,
            attachTo: document.body,
        });

        await fail(wrapper, {
            password: 'The provided password was incorrect.',
        });

        expect(document.activeElement).toBe(wrapper.get('#password').element);
        expect(wrapper.get('#password-error').text()).toBe(
            'The provided password was incorrect.',
        );
    });
});
