import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';

// A stand-in for the Inertia <Form> (see errors.test.ts): it hands the slot the `errors` we set, and emits `error` when
// we say so, which is what the real component does after a response with validation errors.
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

                const clearErrors = () => {
                    for (const key of Object.keys(errors)) {
                        delete errors[key];
                    }
                };

                return () =>
                    h(
                        'form',
                        slots.default?.({
                            errors,
                            processing: false,
                            clearErrors,
                        }),
                    );
            },
        }),
    };
});

import { Form, Head } from '@inertiajs/vue3';
import TwoFactorChallenge from '@/pages/Auth/TwoFactorChallenge.vue';
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

function challenge() {
    return mount(TwoFactorChallenge, {
        props: { features, turnstileSiteKey: null, canRegister: true },
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
    resetPage({ auth: { user: null }, features });
});

describe('TwoFactorChallenge (10 §4.7, 13 §5.10)', () => {
    it('has one h1 and sets the document title', () => {
        const wrapper = challenge();

        expect(wrapper.findAll('h1')).toHaveLength(1);
        expect(wrapper.get('h1').text()).toBe('Two-factor authentication');
        expect(wrapper.findComponent(Head).props('title')).toBe(
            'Two-factor authentication',
        );
    });

    it('asks for the code of the authenticator, posted to the challenge route', () => {
        const wrapper = challenge();
        const code = wrapper.get('input[name="code"]');

        expect(wrapper.get('form').attributes('action')).toBe(
            '/two-factor-challenge',
        );
        expect(wrapper.get('form').attributes('method')).toBe('post');
        expect(code.attributes('autocomplete')).toBe('one-time-code');
        expect(code.attributes('inputmode')).toBe('numeric');
        expect(code.attributes('aria-required')).toBe('true');
        expect(wrapper.get('label[for="code"]').text()).toBe('6-digit code *');
        expect(wrapper.find('input[name="recovery_code"]').exists()).toBe(
            false,
        );
        expect(wrapper.get('[data-test="challenge-button"]').text()).toBe(
            'Continue',
        );
    });

    it('switches to a recovery code and back', async () => {
        const wrapper = challenge();

        await wrapper.get('[data-test="toggle-recovery"]').trigger('click');

        const recovery = wrapper.get('input[name="recovery_code"]');

        expect(wrapper.find('input[name="code"]').exists()).toBe(false);
        expect(recovery.attributes('aria-required')).toBe('true');
        expect(recovery.attributes('autocomplete')).toBe('off');
        expect(wrapper.get('label[for="recovery_code"]').text()).toBe(
            'Recovery code *',
        );
        expect(wrapper.get('[data-test="toggle-recovery"]').text()).toBe(
            'Use an authenticator code',
        );

        await wrapper.get('[data-test="toggle-recovery"]').trigger('click');

        expect(wrapper.find('input[name="code"]').exists()).toBe(true);
        expect(wrapper.find('input[name="recovery_code"]').exists()).toBe(
            false,
        );
    });

    it('points to an owner for someone who lost both', () => {
        expect(challenge().get('[data-test="lost-help"]').text()).toContain(
            'ask an owner to reset it',
        );
    });

    it('focuses a wrong code and marks it', async () => {
        const wrapper = challenge();

        await fail(wrapper, { code: 'The provided code was invalid.' });

        const code = wrapper.get('#code');

        expect(code.attributes('aria-invalid')).toBe('true');
        expect(code.attributes('aria-describedby')).toBe('code-error');
        expect(document.activeElement).toBe(code.element);
        expect(wrapper.get('#code-error').text()).toBe(
            'The provided code was invalid.',
        );
    });

    it('focuses a wrong recovery code and marks it', async () => {
        const wrapper = challenge();

        await wrapper.get('[data-test="toggle-recovery"]').trigger('click');
        await fail(wrapper, {
            recovery_code: 'The recovery code was invalid.',
        });

        const recovery = wrapper.get('#recovery_code');

        expect(recovery.attributes('aria-invalid')).toBe('true');
        expect(document.activeElement).toBe(recovery.element);
        expect(wrapper.get('#recovery_code-error').text()).toBe(
            'The recovery code was invalid.',
        );
    });

    describe('after too many tries', () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('shows the wait as a countdown, disables the button, and enables it at zero', async () => {
            page.props = {
                auth: { user: null },
                features,
                errors: { rate_limited: '3' },
            };

            const wrapper = challenge();
            const notice = '[data-test="throttle-notice"]';
            const button = '[data-test="challenge-button"]';

            expect(wrapper.get(notice).text()).toContain(
                'Too many attempts. Try again in 3 seconds.',
            );
            expect(wrapper.get(button).attributes('disabled')).toBeDefined();

            await vi.advanceTimersByTimeAsync(3000);
            await nextTick();

            expect(wrapper.find(notice).exists()).toBe(false);
            expect(wrapper.get(button).attributes('disabled')).toBeUndefined();
        });
    });
});
