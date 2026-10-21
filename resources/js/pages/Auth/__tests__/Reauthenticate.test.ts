import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const post = vi.hoisted(() => vi.fn());

vi.mock('@inertiajs/vue3', async (importOriginal) => {
    const { page: testPage } = await import('@/test/inertiaPage');
    const { defineComponent: define } = await import('vue');

    return {
        ...(await importOriginal<typeof import('@inertiajs/vue3')>()),
        usePage: () => testPage,
        router: { post },
        Head: define({
            name: 'Head',
            props: { title: String },
            render: () => null,
        }),
    };
});

import Reauthenticate from '@/pages/Auth/Reauthenticate.vue';
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

type Visit = {
    onStart?: () => void;
    onFinish?: () => void;
    onSuccess?: () => void;
    onError?: (errors: Record<string, string>) => void;
};

function reauth(props: Record<string, unknown> = {}) {
    return mount(Reauthenticate, {
        props: {
            maskedPhone: '+91******3210',
            phoneAvailable: true,
            googleLinked: true,
            googleEnabled: true,
            features,
            turnstileSiteKey: null,
            ...props,
        },
        attachTo: document.body,
    });
}

beforeEach(() => {
    vi.useFakeTimers();
    post.mockReset();
    resetPage({ auth: { user: { type: 'customer' } }, features, errors: {} });
});

afterEach(() => {
    vi.useRealTimers();
});

describe('Reauthenticate (10 §4.8, 13 §6.4)', () => {
    it('offers a code to the phone and Google', () => {
        const wrapper = reauth();

        expect(wrapper.findAll('h1')).toHaveLength(1);
        expect(wrapper.get('h1').text()).toBe('Confirm it is you');
        expect(wrapper.get('[data-test="send-code-button"]').text()).toBe(
            'Send me a code',
        );
        expect(wrapper.get('[data-test="reauth-phone-hint"]').text()).toBe(
            'The code goes to +91******3210.',
        );
        expect(
            wrapper.get('a[data-test="google-button"]').attributes('href'),
        ).toBe('/auth/google/redirect?intent=reauthenticate');
        expect(wrapper.find('[data-test="google-caption"]').exists()).toBe(
            false,
        );
    });

    it('sends the code with the step, then asks for it', async () => {
        const wrapper = reauth();

        expect(wrapper.find('input[name="code"]').exists()).toBe(false);

        post.mockImplementation(
            (_url: string, _data: unknown, options: Visit) =>
                options.onSuccess?.(),
        );
        await wrapper.get('[data-test="send-code-button"]').trigger('click');
        await flushPromises();

        expect(post).toHaveBeenCalledWith(
            '/auth/reauthenticate',
            { step: 'send' },
            expect.objectContaining({ preserveScroll: true }),
        );
        expect(
            wrapper.get('input[name="code"]').attributes('autocomplete'),
        ).toBe('one-time-code');
    });

    it('holds the send button for 60 seconds after a code was sent', async () => {
        const wrapper = reauth();
        post.mockImplementation(
            (_url: string, _data: unknown, options: Visit) =>
                options.onSuccess?.(),
        );

        await wrapper.get('[data-test="send-code-button"]').trigger('click');

        expect(
            wrapper
                .get('[data-test="send-code-button"]')
                .attributes('disabled'),
        ).toBeDefined();
        expect(wrapper.get('[data-test="resend-wait"]').text()).toBe(
            'You can ask for a new code in 60 seconds.',
        );

        await vi.advanceTimersByTimeAsync(60_000);

        expect(
            wrapper
                .get('[data-test="send-code-button"]')
                .attributes('disabled'),
        ).toBeUndefined();
        expect(wrapper.find('[data-test="resend-wait"]').exists()).toBe(false);
    });

    it('confirms by itself at six digits', async () => {
        const wrapper = reauth();
        post.mockImplementation(
            (_url: string, _data: unknown, options: Visit) =>
                options.onSuccess?.(),
        );
        await wrapper.get('[data-test="send-code-button"]').trigger('click');
        post.mockReset();

        await wrapper.get('input[name="code"]').setValue('123456');

        expect(post).toHaveBeenCalledWith(
            '/auth/reauthenticate',
            { step: 'verify', code: '123456' },
            expect.objectContaining({ preserveScroll: true }),
        );
    });

    it('shows a wrong code under the field and clears it', async () => {
        const wrapper = reauth();
        post.mockImplementation(
            (_url: string, _data: unknown, options: Visit) =>
                options.onSuccess?.(),
        );
        await wrapper.get('[data-test="send-code-button"]').trigger('click');
        post.mockImplementation(
            (_url: string, _data: unknown, options: Visit) =>
                queueMicrotask(() => {
                    page.props.errors = {
                        code: "That code isn't right. 4 attempts left.",
                        reason: 'otp_invalid',
                    };
                    options.onError?.({});
                }),
        );

        await wrapper.get('input[name="code"]').setValue('123456');
        await flushPromises();

        expect(wrapper.get('#code-error').text()).toBe(
            "That code isn't right. 4 attempts left.",
        );
        expect(
            (wrapper.get('input[name="code"]').element as HTMLInputElement)
                .value,
        ).toBe('');
    });

    it('offers Google alone when the phone cannot take a code', () => {
        const wrapper = reauth({ maskedPhone: null, phoneAvailable: false });

        expect(wrapper.find('[data-test="reauth-phone"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="google-separator"]').exists()).toBe(
            false,
        );
        expect(wrapper.find('a[data-test="google-button"]').exists()).toBe(
            true,
        );
    });

    it('offers the phone alone when Google is not linked or not enabled', () => {
        expect(
            reauth({ googleLinked: false })
                .find('[data-test="google-sign-in"]')
                .exists(),
        ).toBe(false);

        resetPage({
            auth: { user: { type: 'customer' } },
            features: { ...features, google_login: false },
            errors: {},
        });
        expect(
            reauth({ googleEnabled: false })
                .find('[data-test="google-sign-in"]')
                .exists(),
        ).toBe(false);
    });

    it('says so when there is no way to confirm', () => {
        const wrapper = reauth({
            maskedPhone: null,
            phoneAvailable: false,
            googleLinked: false,
        });

        expect(wrapper.get('[data-test="reauth-nothing"]').text()).toContain(
            'There is no way to confirm your identity',
        );
    });

    it('counts a throttled send down on the page', () => {
        page.props.errors = { rate_limited: '15' };
        const wrapper = reauth();

        expect(wrapper.find('[data-test="throttle-notice"]').exists()).toBe(
            true,
        );
        expect(
            wrapper
                .get('[data-test="send-code-button"]')
                .attributes('disabled'),
        ).toBeDefined();
    });
});
