import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A stand-in for the Inertia <Form> that keeps the real form attributes of the route (`action`, `method`), hands the
// slot the `errors` we set and emits `error` on demand, as the real component does after a response with errors.
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
            props: { action: String, method: String },
            emits: ['error'],
            setup(props, { slots, expose }) {
                const errors = reactive<Record<string, string>>({});

                expose({
                    fail(next: Record<string, string>) {
                        Object.assign(errors, next);
                    },
                });

                return () =>
                    h(
                        'form',
                        { action: props.action, method: props.method },
                        slots.default?.({ errors, processing: false }),
                    );
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

import { Form, Head } from '@inertiajs/vue3';
import PhoneLogin from '@/pages/Auth/PhoneLogin.vue';
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
    captcha: true,
};

function phoneLogin(props: Record<string, unknown> = {}) {
    return mount(PhoneLogin, {
        props: {
            intent: 'login',
            canRegister: true,
            features,
            turnstileSiteKey: '1x00000000000000000000AA',
            ...props,
        },
        attachTo: document.body,
    });
}

type FailingForm = { fail: (errors: Record<string, string>) => void };

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
    resetPage({
        auth: { user: null },
        features,
        business: { defaultCountryCode: 'IN' },
        errors: {},
    });
});

describe('PhoneLogin (10 §4.4, 13 §5.2)', () => {
    it('has one h1, a title and a form that posts to the send route', () => {
        const wrapper = phoneLogin();

        expect(wrapper.findAll('h1')).toHaveLength(1);
        expect(wrapper.get('h1').text()).toBe('Sign in with your phone');
        expect(wrapper.findComponent(Head).props('title')).toBe(
            'Sign in with your phone',
        );
        expect(wrapper.get('form').attributes('action')).toBe('/auth/otp/send');
        expect(wrapper.get('form').attributes('method')).toBe('post');
        expect(wrapper.get('[data-test="send-code-button"]').text()).toBe(
            'Send code',
        );
    });

    it('sends the intent and the number in the fields the server reads', () => {
        const wrapper = phoneLogin();

        expect(wrapper.get('input[name="intent"]').attributes('value')).toBe(
            'login',
        );
        expect(wrapper.get('input[name="phone"]').attributes('type')).toBe(
            'hidden',
        );
        expect(wrapper.get('label[for="phone"]').text()).toBe('Phone number *');
    });

    it('asks only for the number to sign in', () => {
        const wrapper = phoneLogin();

        expect(wrapper.find('input[name="name"]').exists()).toBe(false);
        expect(wrapper.find('#terms').exists()).toBe(false);
    });

    it('asks a sign-up for a name and the terms', () => {
        const wrapper = phoneLogin({ intent: 'register' });

        expect(wrapper.get('h1').text()).toBe('Sign up with your phone');
        expect(wrapper.get('input[name="intent"]').attributes('value')).toBe(
            'register',
        );
        expect(wrapper.get('label[for="name"]').text()).toBe('Full name *');
        expect(
            wrapper.get('input[name="name"]').attributes('autocomplete'),
        ).toBe('name');
        expect(wrapper.get('#terms').attributes('role')).toBe('checkbox');
        expect(wrapper.get('a[href="/terms"]').attributes('target')).toBe(
            '_blank',
        );
    });

    it('links back to the email form of its kind', () => {
        expect(
            phoneLogin().get('[data-test="use-email-link"]').attributes('href'),
        ).toBe('/login');
        expect(
            phoneLogin({ intent: 'register' })
                .get('[data-test="use-email-link"]')
                .attributes('href'),
        ).toBe('/register');
    });

    it('does not load the captcha until the server asks for it', async () => {
        const wrapper = phoneLogin();
        await flushPromises();

        expect(wrapper.find('[data-test="turnstile"]').exists()).toBe(false);
        expect(turnstile.render).not.toHaveBeenCalled();

        await fail(wrapper, {
            cf_turnstile_response: 'Complete the check below to get a code.',
            code: 'captcha_required',
        });

        expect(wrapper.find('[data-test="turnstile"]').exists()).toBe(true);
        expect(turnstile.render).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ action: 'otp_send' }),
        );
        expect(wrapper.get('#captcha-error').text()).toBe(
            'Complete the check below to get a code.',
        );
    });

    it('shows the message of a refused number under the field and focuses it', async () => {
        const wrapper = phoneLogin();

        await fail(wrapper, {
            phone: "That doesn't look like a phone number. Check it and try again.",
            code: 'phone_invalid',
        });

        expect(wrapper.get('#phone-error').text()).toBe(
            "That doesn't look like a phone number. Check it and try again.",
        );
        const input = wrapper.get('input[type="tel"]');
        expect(input.attributes('aria-invalid')).toBe('true');
        expect(document.activeElement).toBe(input.element);
    });

    it('counts the wait of a throttled send down in the page, without repeating it as a field error', async () => {
        page.props.errors = { rate_limited: '30' };
        const wrapper = phoneLogin();
        await fail(wrapper, {
            phone: 'Please wait a moment before asking for another code.',
            code: 'otp_cooldown',
        });

        expect(
            wrapper
                .get('[data-test="throttle-notice"] [aria-hidden="true"]')
                .text(),
        ).toBe('Too many attempts. Try again in 30 seconds.');
        expect(wrapper.find('#phone-error').exists()).toBe(false);
        expect(
            wrapper
                .get('[data-test="send-code-button"]')
                .attributes('disabled'),
        ).toBeDefined();
    });
});
